'use strict';

const mongoose = require('mongoose');
const { PayrollPeriod, PayrollLine, Payslip } = require('./models');
const { payrollFormula, payslipTotals } = require('./rules');
const { AppError, objectId, page, model, audit, notify } = require('./support');

const asDecimal = (value) => mongoose.Types.Decimal128.fromString(String(value));
function monthRange(year, month) { return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) }; }
function simplePdf(lines) {
  const escaped = lines.map((line) => String(line).replace(/([\\()])/g, '\\$1'));
  const stream = `BT /F1 12 Tf 50 760 Td ${escaped.map((line, index) => `${index ? '0 -20 Td ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

async function createPeriod(actor, input) {
  const employeeIds = [...new Set(input.employeeIds || [])];
  if (!employeeIds.length) throw new AppError('VALIDATION_ERROR', 400, 'At least one employee is required');
  const Employee = model('Employee');
  const count = await Employee.countDocuments({ _id: { $in: employeeIds.map((id) => objectId(id, 'employeeIds')) }, companyId: actor.companyId, employmentStatus: 'ACTIVE', deletedAt: null });
  if (count !== employeeIds.length) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'One or more eligible employees were not found in this company');
  try { return await PayrollPeriod.create({ companyId: actor.companyId, periodMonth: input.periodMonth, periodYear: input.periodYear, employeeIds, formulaVersion: input.formulaVersion || 'PAYROLL_V1' }); }
  catch (error) { if (error.code === 11000) throw new AppError('PAYROLL_DUPLICATE_PERIOD', 409, 'Payroll period already exists'); throw error; }
}

const componentRows = (rows = []) => rows.filter((row) => row?.label).map((row) => ({ label: row.label, amount: row.amount?.toString() || '0' }));
// Candidates who actually joined inside the period, split by the job opening's
// type. A job with no type set falls back to the candidate's own type, which is
// always present.
async function joiningCounts(actor, employeeIds, start, end) {
  const counts = new Map();
  if (!employeeIds.length) return counts;
  const rows = await model('Candidate').aggregate([
    { $match: { companyId: objectId(String(actor.companyId)), recruiterEmployeeId: { $in: employeeIds }, stage: 'JOINED', actualDoj: { $gte: start, $lt: end } } },
    { $lookup: { from: 'jobopenings', localField: 'jobOpeningId', foreignField: '_id', as: 'job' } },
    { $group: { _id: { employeeId: '$recruiterEmployeeId', type: { $ifNull: [{ $arrayElemAt: ['$job.jobType', 0] }, '$candidateType'] } }, count: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    const key = String(row._id.employeeId);
    const entry = counts.get(key) || { IT: 0, NON_IT: 0 };
    if (row._id.type === 'IT') entry.IT += row.count; else entry.NON_IT += row.count;
    counts.set(key, entry);
  }
  return counts;
}

async function calculatePeriod(actor, periodId) {
  const period = await PayrollPeriod.findOne({ _id: objectId(periodId), companyId: actor.companyId, status: { $in: ['DRAFT', 'REOPENED'] } });
  if (!period) throw new AppError('PAYROLL_ALREADY_APPROVED', 409, 'Payroll period cannot be calculated from its current state');
  const Employee = model('Employee'); const Attendance = model('AttendanceRecord'); const Company = model('Company');
  const [employees, company] = await Promise.all([
    Employee.find({ _id: { $in: period.employeeIds }, companyId: actor.companyId, employmentStatus: 'ACTIVE', deletedAt: null }).select('salaryType hourlyRate monthlyCtc itJoiningRate nonItJoiningRate salaryComponents'),
    Company.findById(actor.companyId).select('settings'),
  ]);
  const { start, end } = monthRange(period.periodYear, period.periodMonth);
  const totals = await Attendance.aggregate([{ $match: { companyId: objectId(String(actor.companyId)), employeeId: { $in: employees.map((e) => e._id) }, workDate: { $gte: start, $lt: end } } }, { $group: { _id: '$employeeId', minutes: { $sum: '$workedMinutes' } } }]);
  const byEmployee = new Map(totals.map((row) => [String(row._id), row.minutes]));
  const joiningsByEmployee = await joiningCounts(actor, employees.filter((employee) => employee.salaryType === 'PER_JOINING').map((employee) => employee._id), start, end);
  const prior = period.status === 'REOPENED' ? await PayrollLine.find({ companyId: actor.companyId, payrollPeriodId: period._id, isCurrent: true }) : [];
  if (prior.length) await PayrollLine.updateMany({ _id: { $in: prior.map((line) => line._id) } }, { $set: { isCurrent: false } });
  const oldByEmployee = new Map(prior.map((line) => [String(line.employeeId), line]));
  const lines = employees.map((employee) => {
    const priorLine = oldByEmployee.get(String(employee._id));
    const salaried = employee.salaryType === 'SALARIED';
    const earnings = salaried ? componentRows(employee.salaryComponents?.earnings) : [];
    const deductionItems = salaried ? componentRows(employee.salaryComponents?.deductions) : [];
    const joinings = joiningsByEmployee.get(String(employee._id)) || { IT: 0, NON_IT: 0 };
    const result = payrollFormula({
      salaryType: employee.salaryType, hourlyRate: employee.hourlyRate?.toString(), monthlyCtc: employee.monthlyCtc?.toString(),
      workedHours: String((byEmployee.get(String(employee._id)) || 0) / 60),
      salariedHoursBase: String(company?.settings?.payrollSalariedHoursBase || 208),
      deductionPct: String(company?.settings?.payrollDefaultDeductionPct || 10), extraDeductions: priorLine?.extraDeductions?.toString() || '0',
      earnings, deductionItems,
      itJoiningRate: employee.itJoiningRate?.toString() || '0', nonItJoiningRate: employee.nonItJoiningRate?.toString() || '0',
      itJoinings: String(joinings.IT), nonItJoinings: String(joinings.NON_IT),
    });
    return { companyId: actor.companyId, payrollPeriodId: period._id, employeeId: employee._id,
      ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, asDecimal(value)])),
      // Kept alongside the totals so a payslip can show what produced them.
      earnings: earnings.map((row) => ({ label: row.label, amount: asDecimal(row.amount) })),
      deductionItems: deductionItems.map((row) => ({ label: row.label, amount: asDecimal(row.amount) })),
      itJoinings: joinings.IT, nonItJoinings: joinings.NON_IT,
      revision: priorLine ? priorLine.revision + 1 : 1, revisionOf: priorLine?._id || null, isCurrent: true };
  });
  try { if (lines.length) await PayrollLine.insertMany(lines); }
  catch (error) { if (prior.length) await PayrollLine.updateMany({ _id: { $in: prior.map((line) => line._id) } }, { $set: { isCurrent: true } }); throw error; }
  period.status = 'CALCULATED'; await period.save();
  return getPeriod(actor, periodId);
}
async function listPeriods(actor, query) {
  const { page: current, limit } = page(query);
  const filter = { companyId: actor.companyId };
  const [items, total] = await Promise.all([
    PayrollPeriod.find(filter).sort({ periodYear: -1, periodMonth: -1 }).skip((current - 1) * limit).limit(limit),
    PayrollPeriod.countDocuments(filter),
  ]);
  return { items, page: current, limit, total, pages: Math.ceil(total / limit) };
}
async function getPeriod(actor, periodId) {
  const period = await PayrollPeriod.findOne({ _id: objectId(periodId), companyId: actor.companyId });
  if (!period) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Payroll period not found');
  const lines = await PayrollLine.find({ companyId: actor.companyId, payrollPeriodId: period._id, isCurrent: true }).lean();
  // Each line carries who it belongs to and the payslip made from it, so the
  // period view can name the employee and show where the payslip has got to.
  const [employees, slips] = await Promise.all([
    model('Employee').find({ _id: { $in: lines.map((line) => line.employeeId) }, companyId: actor.companyId }).select('firstName lastName employeeCode').lean(),
    Payslip.find({ companyId: actor.companyId, payrollLineId: { $in: lines.map((line) => line._id) } }).select('payrollLineId status publishedAt').lean(),
  ]);
  const employeeById = new Map(employees.map((employee) => [String(employee._id), employee]));
  const slipByLine = new Map(slips.map((slip) => [String(slip.payrollLineId), slip]));
  return {
    period,
    lines: lines.map((line) => {
      const employee = employeeById.get(String(line.employeeId));
      return { ...line, employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : null, employeeCode: employee?.employeeCode || null, payslip: slipByLine.get(String(line._id)) || null };
    }),
  };
}
async function updateLine(actor, lineId, input) {
  const line = await PayrollLine.findOne({ _id: objectId(lineId), companyId: actor.companyId, isCurrent: true });
  if (!line) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Payroll line not found');
  const period = await PayrollPeriod.findOne({ _id: line.payrollPeriodId, companyId: actor.companyId, status: { $in: ['CALCULATED', 'UNDER_REVIEW'] } });
  if (!period) throw new AppError('PAYROLL_ALREADY_APPROVED', 409, 'Approved payroll is immutable');
  const Company = model('Company'); const company = await Company.findById(actor.companyId).select('settings.payrollDefaultDeductionPct');
  const before = line.toObject(); line.extraDeductions = asDecimal(input.extraDeductions); line.overrideReason = input.reason; line.overriddenBy = actor.userId;
  const gross = line.grossPay.toString();
  const computed = payrollFormula({ salaryType: 'HOURLY', hourlyRate: gross, workedHours: '1', deductionPct: String(company?.settings?.payrollDefaultDeductionPct ?? 10), extraDeductions: input.extraDeductions });
  line.deductions = asDecimal(computed.deductions); line.netPay = asDecimal(computed.netPay); await line.save();
  await audit(actor, { action: 'PAYROLL_LINE_OVERRIDE', entityType: 'PayrollLine', entityId: line._id, before, after: line, reason: input.reason });
  return line;
}
async function approvePeriod(actor, periodId) {
  const period = await PayrollPeriod.findOneAndUpdate({ _id: objectId(periodId), companyId: actor.companyId, status: 'CALCULATED' }, { $set: { status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date() } }, { new: true });
  if (!period) throw new AppError('PAYROLL_ALREADY_APPROVED', 409, 'Period already approved or not calculated');
  await audit(actor, { action: 'PAYROLL_APPROVED', entityType: 'PayrollPeriod', entityId: period._id, after: { status: period.status } });
  return period;
}
async function reopenPeriod(actor, periodId, reason) {
  const period = await PayrollPeriod.findOneAndUpdate({ _id: objectId(periodId), companyId: actor.companyId, status: { $in: ['APPROVED', 'LOCKED'] } }, { $set: { status: 'REOPENED', approvedBy: null, approvedAt: null } }, { new: true });
  if (!period) throw new AppError('PAYROLL_ALREADY_APPROVED', 409, 'Only approved or locked payroll can be reopened');
  await audit(actor, { action: 'PAYROLL_REOPENED', entityType: 'PayrollPeriod', entityId: period._id, after: { status: 'REOPENED' }, reason }); return period;
}
// The correction an owner makes while approving a payslip. It rewrites the
// payroll line itself so the period totals, reports and payslip cannot disagree,
// and is refused once the payslip has gone out to the employee.
async function updateLineBreakdown(actor, lineId, input) {
  const line = await PayrollLine.findOne({ _id: objectId(lineId), companyId: actor.companyId, isCurrent: true });
  if (!line) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Payroll line not found');
  const slip = await Payslip.findOne({ payrollLineId: line._id, companyId: actor.companyId });
  if (slip?.status === 'PUBLISHED') throw new AppError('PAYSLIP_NOT_APPROVED', 409, 'A published payslip can no longer be edited');
  const earnings = componentRows(input.earnings ?? line.earnings);
  const deductionItems = componentRows(input.deductionItems ?? line.deductionItems);
  const totals = payslipTotals({
    earnings, deductionItems, extraDeductions: line.extraDeductions?.toString() || '0',
    currentGross: line.grossPay?.toString() || '0', currentDeductions: line.deductions?.toString() || '0',
  });
  const before = { workedHours: line.workedHours, grossPay: line.grossPay, deductions: line.deductions, netPay: line.netPay, earnings: line.earnings, deductionItems: line.deductionItems };
  Object.assign(line, Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, asDecimal(value)])));
  if (input.workedHours !== undefined) line.workedHours = asDecimal(String(input.workedHours));
  line.earnings = earnings.map((row) => ({ label: row.label, amount: asDecimal(row.amount) }));
  line.deductionItems = deductionItems.map((row) => ({ label: row.label, amount: asDecimal(row.amount) }));
  line.overrideReason = input.reason; line.overriddenBy = actor.userId;
  await line.save();
  await audit(actor, { action: 'PAYROLL_LINE_EDITED', entityType: 'PayrollLine', entityId: line._id, before, after: { workedHours: line.workedHours, grossPay: line.grossPay, deductions: line.deductions, netPay: line.netPay, earnings: line.earnings, deductionItems: line.deductionItems }, reason: input.reason });
  return line;
}
async function createPayslip(actor, lineId) {
  const line = await PayrollLine.findOne({ _id: objectId(lineId), companyId: actor.companyId, isCurrent: true });
  if (!line) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Payroll line not found');
  const period = await PayrollPeriod.findOne({ _id: line.payrollPeriodId, companyId: actor.companyId, status: { $in: ['APPROVED', 'LOCKED'] } });
  if (!period) throw new AppError('PAYSLIP_NOT_APPROVED', 409, 'Payroll must be approved first');
  // No file is written: a payslip is rendered from its payroll line on demand,
  // and only turned into a PDF at the moment someone downloads one.
  return Payslip.findOneAndUpdate({ payrollLineId: line._id }, { $setOnInsert: { companyId: actor.companyId, employeeId: line.employeeId, status: 'DRAFT' } }, { upsert: true, new: true });
}
async function transitionPayslip(actor, id, from, to) {
  const update = { status: to }; if (to === 'APPROVED') Object.assign(update, { approvedBy: actor.userId, approvedAt: new Date() }); if (to === 'PUBLISHED') update.publishedAt = new Date();
  const slip = await Payslip.findOneAndUpdate({ _id: objectId(id), companyId: actor.companyId, status: { $in: [].concat(from) } }, { $set: update }, { new: true });
  if (!slip) throw new AppError('PAYSLIP_NOT_APPROVED', 409, `Payslip cannot transition to ${to}`);
  await audit(actor, { action: `PAYSLIP_${to}`, entityType: 'Payslip', entityId: slip._id, after: { status: to } });
  if (to === 'PUBLISHED') {
    const Employee = model('Employee'); const employee = await Employee.findOne({ _id: slip.employeeId, companyId: actor.companyId });
    if (employee?.userId) await notify({ companyId: actor.companyId, recipientUserId: employee.userId, type: 'PAYSLIP_PUBLISHED', title: 'Your payslip is available', linkEntityType: 'Payslip', linkEntityId: slip._id }, { bestEffort: true });
  }
  return slip;
}
async function ownPayslips(actor) {
  if (!actor.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Employee profile required');
  const slips = await Payslip.find({ companyId: actor.companyId, employeeId: actor.employeeId, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).lean();
  const lines = await PayrollLine.find({ _id: { $in: slips.map((slip) => slip.payrollLineId) } }).select('payrollPeriodId netPay grossPay').lean();
  const lineById = new Map(lines.map((line) => [String(line._id), line]));
  const periods = await PayrollPeriod.find({ _id: { $in: lines.map((line) => line.payrollPeriodId) } }).select('periodMonth periodYear').lean();
  const periodById = new Map(periods.map((period) => [String(period._id), period]));
  return slips.map((slip) => {
    const line = lineById.get(String(slip.payrollLineId));
    const period = line && periodById.get(String(line.payrollPeriodId));
    return { ...slip, netPay: line?.netPay ?? null, grossPay: line?.grossPay ?? null, periodMonth: period?.periodMonth ?? null, periodYear: period?.periodYear ?? null, periodLabel: period ? `${period.periodMonth}/${period.periodYear}` : null };
  });
}
// Everything a payslip shows, read fresh from the payroll line each time. A
// recruiter may only open their own, and only once it has been published.
async function payslipView(actor, id) {
  const filter = { _id: objectId(id), companyId: actor.companyId };
  if (actor.role !== 'SUPER_ADMIN') Object.assign(filter, { employeeId: actor.employeeId, status: 'PUBLISHED' });
  const slip = await Payslip.findOne(filter).lean();
  if (!slip) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Payslip not found or not accessible');
  const line = await PayrollLine.findOne({ _id: slip.payrollLineId, companyId: actor.companyId }).lean();
  if (!line) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Payroll line for this payslip is unavailable');
  const [period, employee, company] = await Promise.all([
    PayrollPeriod.findOne({ _id: line.payrollPeriodId, companyId: actor.companyId }).select('periodMonth periodYear status').lean(),
    model('Employee').findOne({ _id: line.employeeId, companyId: actor.companyId }).select('firstName lastName employeeCode designation department salaryType').lean(),
    model('Company').findById(actor.companyId).select('name').lean(),
  ]);
  return {
    payslip: { _id: slip._id, status: slip.status, approvedAt: slip.approvedAt || null, publishedAt: slip.publishedAt || null },
    period, employee, company: { name: company?.name || 'Company' },
    line: {
      _id: line._id, workedHours: line.workedHours, grossPay: line.grossPay, basicPay: line.basicPay, allowances: line.allowances,
      deductions: line.deductions, extraDeductions: line.extraDeductions, netPay: line.netPay,
      earnings: line.earnings || [], deductionItems: line.deductionItems || [], itJoinings: line.itJoinings || 0, nonItJoinings: line.nonItJoinings || 0,
    },
  };
}
function payslipDocumentLines(view) {
  const { employee, period, line, company } = view;
  const money = (value) => Number(value || 0).toFixed(2);
  return [
    `${String(company.name).toUpperCase()} - PAYSLIP`,
    `Employee: ${[employee?.firstName, employee?.lastName].filter(Boolean).join(' ')}`,
    `Employee code: ${employee?.employeeCode || ''}`,
    ...(employee?.designation ? [`Designation: ${employee.designation}`] : []),
    `Period: ${period?.periodMonth}/${period?.periodYear}`,
    `Worked hours: ${money(line.workedHours)}`,
    ...(line.itJoinings || line.nonItJoinings ? [`Joinings paid: ${line.itJoinings} IT, ${line.nonItJoinings} non-IT`] : []),
    '',
    'EARNINGS',
    ...(line.earnings.length ? line.earnings.map((row) => `  ${row.label}: ${money(row.amount)}`) : [`  Basic: ${money(line.basicPay)}`, `  Allowances: ${money(line.allowances)}`]),
    `  Gross: ${money(line.grossPay)}`,
    '',
    'DEDUCTIONS',
    ...(line.deductionItems.length ? line.deductionItems.map((row) => `  ${row.label}: ${money(row.amount)}`) : []),
    ...(Number(line.extraDeductions) ? [`  Adjustment: ${money(line.extraDeductions)}`] : []),
    `  Total: ${money(line.deductions)}`,
    '',
    `NET PAY: ${money(line.netPay)}`,
  ];
}
async function downloadPayslip(actor, id) {
  const view = await payslipView(actor, id);
  const pdf = simplePdf(payslipDocumentLines(view));
  return {
    contentBase64: pdf.toString('base64'),
    contentType: 'application/pdf',
    filename: `payslip-${view.period?.periodYear}-${String(view.period?.periodMonth).padStart(2, '0')}-${view.employee?.employeeCode || 'employee'}.pdf`,
  };
}

module.exports = { createPeriod, listPeriods, calculatePeriod, getPeriod, updateLine, updateLineBreakdown, approvePeriod, reopenPeriod, createPayslip, transitionPayslip, ownPayslips, payslipView, downloadPayslip, monthRange, simplePdf };
