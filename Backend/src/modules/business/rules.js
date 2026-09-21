'use strict';

const mongoose = require('mongoose');

const SCALE = 1000000n;
function scaled(value) {
  const raw = String(value ?? '0').trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new TypeError(`Invalid decimal: ${raw}`);
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');
  const units = BigInt(whole) * SCALE + BigInt((fraction + '000000').slice(0, 6));
  return negative ? -units : units;
}
function decimal(units, places = 2) {
  const negative = units < 0n;
  let absolute = negative ? -units : units;
  const rounding = 10n ** BigInt(6 - places);
  absolute = ((absolute + rounding / 2n) / rounding) * rounding;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0').slice(0, places);
  return `${negative ? '-' : ''}${whole}${places ? `.${fraction}` : ''}`;
}
function multiply(left, right) { return (scaled(left) * scaled(right)) / SCALE; }
const sumComponents = (rows = []) => rows.reduce((total, row) => total + scaled(row.amount), 0n);
const findComponent = (rows = [], name) => rows.find((row) => String(row.label || '').trim().toLowerCase() === name);
// A manual correction made while approving a payslip states the final figures:
// the rows are the amounts, never re-pro-rated, since the month was already
// pro-rated when the period was calculated. Leaving a side out keeps its total.
function payslipTotals({ earnings = [], deductionItems = [], extraDeductions = '0', currentGross = '0', currentDeductions = '0' }) {
  const gross = earnings.length ? sumComponents(earnings) : scaled(currentGross);
  const basicComponent = findComponent(earnings, 'basic');
  const basic = basicComponent ? scaled(basicComponent.amount) : gross / 2n;
  const allowances = gross > basic ? gross - basic : 0n;
  const deductions = deductionItems.length ? sumComponents(deductionItems) + scaled(extraDeductions) : scaled(currentDeductions);
  const net = gross > deductions ? gross - deductions : 0n;
  return { grossPay: decimal(gross), basicPay: decimal(basic), allowances: decimal(allowances), deductions: decimal(deductions), netPay: decimal(net) };
}
function payrollFormula({
  salaryType, hourlyRate, monthlyCtc, workedHours, salariedHoursBase = '208', deductionPct = '10', extraDeductions = '0',
  earnings = [], deductionItems = [], itJoiningRate = '0', nonItJoiningRate = '0', itJoinings = '0', nonItJoinings = '0',
}) {
  const hours = scaled(workedHours);
  let gross;
  let basic;
  if (salaryType === 'HOURLY') gross = multiply(hourlyRate, workedHours);
  else if (salaryType === 'SALARIED') {
    // A configured pay structure replaces the flat CTC as the full-month gross;
    // either way the month is pro-rated by attendance and capped at one month.
    const fullMonth = earnings.length ? sumComponents(earnings) : scaled(monthlyCtc);
    const ratio = hours >= scaled(salariedHoursBase) ? SCALE : (hours * SCALE) / scaled(salariedHoursBase);
    gross = (fullMonth * ratio) / SCALE;
    const basicComponent = findComponent(earnings, 'basic');
    if (basicComponent) basic = (scaled(basicComponent.amount) * ratio) / SCALE;
  } else if (salaryType === 'PER_JOINING') {
    // Commission only: what the recruiter earned from candidates who joined in
    // this period, charged at the rate for the job opening's type.
    gross = multiply(itJoiningRate, itJoinings) + multiply(nonItJoiningRate, nonItJoinings);
    basic = gross;
  } else throw new TypeError('salaryType must be HOURLY, SALARIED or PER_JOINING');
  if (basic === undefined) basic = gross / 2n;
  const allowances = gross > basic ? gross - basic : 0n;
  // Named deduction rows are fixed amounts and are not pro-rated; without them
  // the company-wide percentage applies as before.
  const deductions = (deductionItems.length ? sumComponents(deductionItems) : (gross * scaled(deductionPct)) / (100n * SCALE)) + scaled(extraDeductions);
  const net = gross > deductions ? gross - deductions : 0n;
  return {
    workedHours: decimal(hours, 2), grossPay: decimal(gross), basicPay: decimal(basic),
    allowances: decimal(allowances), deductions: decimal(deductions), netPay: decimal(net),
    extraDeductions: decimal(scaled(extraDeductions)),
  };
}

const CRM_MAIN_STAGES = Object.freeze(['NEW_LEAD', 'CALLED', 'INTERESTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'JOINED']);
const CRM_TERMINAL_STAGES = Object.freeze(['NOT_INTERESTED', 'REJECTED', 'JOINED']);
const CRM_STAGE_RANK = Object.freeze(Object.fromEntries(CRM_MAIN_STAGES.map((stage, index) => [stage, index])));
function allowedCandidateStages(from, progressionRank = CRM_STAGE_RANK[from] ?? 0) {
  if (CRM_TERMINAL_STAGES.includes(from)) return [];
  const rank = Math.max(0, Number(progressionRank) || 0);
  const allowed = CRM_MAIN_STAGES.filter((stage) => (CRM_STAGE_RANK[stage] > rank || (['RNR', 'ON_HOLD'].includes(from) && CRM_STAGE_RANK[stage] >= rank)) && (stage !== 'JOINED' || rank >= CRM_STAGE_RANK.SELECTED));
  if (rank < CRM_STAGE_RANK.SHORTLISTED) allowed.push('RNR', 'NOT_INTERESTED');
  if (rank < CRM_STAGE_RANK.JOINED && from !== 'ON_HOLD') allowed.push('ON_HOLD');
  if (rank >= CRM_STAGE_RANK.SHORTLISTED && rank < CRM_STAGE_RANK.JOINED) allowed.push('REJECTED');
  return [...new Set(allowed)].filter((stage) => stage !== from);
}
function canTransitionCandidate(from, to, progressionRank) { return allowedCandidateStages(from, progressionRank).includes(to); }

function addClauseDays(actualDoj, clauseDays) {
  if (!actualDoj) return null;
  const date = new Date(actualDoj);
  if (Number.isNaN(date.getTime()) || !Number.isInteger(clauseDays) || clauseDays < 0) throw new TypeError('Invalid DOJ or clause days');
  date.setUTCDate(date.getUTCDate() + clauseDays);
  return date;
}
function deriveInvoiceState(placement, now = new Date()) {
  if (['RAISED', 'PAID', 'CANCELLED', 'GENERATED', 'READY_TO_RAISE'].includes(placement.invoiceState)) return placement.invoiceState;
  if (!placement.actualDoj || !placement.invoiceDueDate) return 'NOT_READY';
  return new Date(placement.invoiceDueDate).getTime() <= now.getTime() ? 'DUE' : 'FUTURE_DUE';
}
function canonicalParticipants(a, b) {
  const values = [String(a), String(b)];
  if (values[0] === values[1]) throw new TypeError('Conversation participants must be different');
  return values.sort();
}
function isObjectId(value) { return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value.toLowerCase(); }
function serialize(value) {
  if (value == null) return value;
  if (value instanceof mongoose.Types.Decimal128) return value.toString();
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value.toObject === 'function') return serialize(value.toObject());
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '__v').map(([key, item]) => [key, serialize(item)]));
  return value;
}
function publicJob(job) {
  const output = serialize(job);
  if (output) { delete output.internalPaymentDetails; delete output.vendorPayment; delete output.assignedRecruiterIds; delete output.clauseDaysOverride; }
  return output;
}

module.exports = { payrollFormula, payslipTotals, CRM_MAIN_STAGES, CRM_TERMINAL_STAGES, CRM_STAGE_RANK, allowedCandidateStages, canTransitionCandidate, addClauseDays, deriveInvoiceState, canonicalParticipants, isObjectId, serialize, publicJob };
