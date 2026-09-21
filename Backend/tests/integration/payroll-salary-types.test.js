const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const argon2 = require('argon2');
const request = require('supertest');
const app = require('../../src/app');
const Company = require('../../src/modules/company/company.model');
const { User } = require('../../src/modules/auth/user.model');
const { Employee } = require('../../src/modules/employees/employee.model');
const { AttendanceRecord } = require('../../src/modules/attendance/attendanceRecord.model');
const { JobOpening, Candidate, PayrollLine } = require('../../src/modules/business/models');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');

const PASSWORD = 'Password1234';
const YEAR = 2026;
const MONTH = 3;
let mongo;

async function createOwner(company) {
  const email = 'owner@example.com';
  return User.create({ companyId: company._id, role: 'SUPER_ADMIN', email, normalizedEmail: email, displayName: 'Owner', passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
}
async function token(email) {
  return (await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)).body.data.accessToken;
}
const auth = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

async function joinedCandidate(company, employee, { jobType, candidateType = 'NON_IT', day = 10 }) {
  const job = await JobOpening.create({ companyId: company._id, title: `Job ${jobType || 'untyped'} ${day}`, companyName: 'Acme', status: 'ACTIVE', jobType, assignedRecruiterIds: [employee._id] });
  return Candidate.create({
    companyId: company._id, jobOpeningId: job._id, recruiterEmployeeId: employee._id, name: `Candidate ${day}`,
    contact: { phone: `90000000${day}` }, candidateType, languages: ['ENGLISH'], consentGiven: true,
    stage: 'JOINED', progressionRank: 6, actualDoj: new Date(Date.UTC(YEAR, MONTH - 1, day)),
    stageHistory: [{ toStage: 'JOINED', changedBy: new mongoose.Types.ObjectId() }],
  });
}
async function runPayroll(ownerToken, employeeIds) {
  const period = (await request(app).post('/api/v1/payroll-periods').set(auth(ownerToken)).send({ periodMonth: MONTH, periodYear: YEAR, employeeIds }).expect(201)).body.data;
  await request(app).post(`/api/v1/payroll-periods/${period._id}/calculate`).set(auth(ownerToken)).expect(200);
  return period;
}
const lineFor = async (employeeId) => PayrollLine.findOne({ employeeId, isCurrent: true });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => { await disconnectDatabase(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({}))); });

describe('salary types', () => {
  it('pays a per-joining recruiter per joined candidate at the IT / non-IT rate', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const owner = await createOwner(company);
    const ownerToken = await token(owner.email);

    const created = await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({
      employeeCode: 'REC-1', workEmail: 'rec1@example.com', firstName: 'Ravi', lastName: 'K', joiningDate: '2026-01-01',
      salaryType: 'PER_JOINING', itJoiningRate: '5000', nonItJoiningRate: '3000',
    }).expect(201);
    expect(created.body.data).toMatchObject({ salaryType: 'PER_JOINING' });
    const employee = await Employee.findById(created.body.data._id);

    await joinedCandidate(company, employee, { jobType: 'IT', day: 5 });
    await joinedCandidate(company, employee, { jobType: 'IT', day: 6 });
    await joinedCandidate(company, employee, { jobType: 'NON_IT', day: 7 });
    // A job with no type falls back to the candidate's own type.
    await joinedCandidate(company, employee, { jobType: null, candidateType: 'IT', day: 8 });
    // Outside the payroll month, so it must not be paid in this period.
    const outside = await joinedCandidate(company, employee, { jobType: 'IT', day: 9 });
    await Candidate.updateOne({ _id: outside._id }, { $set: { actualDoj: new Date(Date.UTC(YEAR, MONTH, 4)) } });

    await runPayroll(ownerToken, [String(employee._id)]);
    const line = await lineFor(employee._id);
    expect(line.itJoinings).toBe(3);
    expect(line.nonItJoinings).toBe(1);
    expect(line.grossPay.toString()).toBe('18000.00'); // 3 x 5000 + 1 x 3000
    expect(line.netPay.toString()).toBe('16200.00');   // less the company 10% default
  });

  it('pays a per-joining recruiter nothing when none of their candidates joined', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const employee = await Employee.create({ companyId: company._id, workEmail: 'rec2@example.com', employeeCode: 'REC-2', firstName: 'No', lastName: 'Joins', joiningDate: new Date('2026-01-01'), salaryType: 'PER_JOINING', itJoiningRate: '5000', nonItJoiningRate: '3000' });
    await runPayroll(ownerToken, [String(employee._id)]);
    const line = await lineFor(employee._id);
    expect(line.grossPay.toString()).toBe('0.00');
    expect(line.netPay.toString()).toBe('0.00');
  });

  it('drives salaried payroll from the configured earnings and deduction rows', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const created = await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({
      employeeCode: 'EMP-1', workEmail: 'emp1@example.com', firstName: 'Meera', lastName: 'S', joiningDate: '2026-01-01',
      salaryType: 'SALARIED', monthlyCtc: '99999', takeHomeSalary: '80000',
      salaryComponents: { earnings: [{ label: 'Basic', amount: '20000' }, { label: 'HRA', amount: '8000' }, { label: 'Special Allowance', amount: '2000' }], deductions: [{ label: 'Professional Tax', amount: '200' }] },
    }).expect(201);
    const employee = await Employee.findById(created.body.data._id);
    expect(employee.salaryComponents.earnings).toHaveLength(3);

    // A full month of attendance so nothing is pro-rated away.
    await AttendanceRecord.create({ companyId: company._id, employeeId: employee._id, workDate: new Date(Date.UTC(YEAR, MONTH - 1, 10)), workedMinutes: 208 * 60 });

    await runPayroll(ownerToken, [String(employee._id)]);
    const line = await lineFor(employee._id);
    expect(line.grossPay.toString()).toBe('30000.00'); // the rows, not the 99999 CTC
    expect(line.basicPay.toString()).toBe('20000.00'); // the Basic row, not half of gross
    expect(line.deductions.toString()).toBe('200.00'); // the row, not the 10% default
    expect(line.netPay.toString()).toBe('29800.00');
    expect(line.earnings.map((row) => row.label)).toEqual(['Basic', 'HRA', 'Special Allowance']);
    expect(Number(line.deductionItems[0].amount)).toBe(200);
  });

  it('leaves salaried employees without a configured structure on the old CTC maths', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const employee = await Employee.create({ companyId: company._id, workEmail: 'emp2@example.com', employeeCode: 'EMP-2', firstName: 'Legacy', lastName: 'Row', joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '30000' });
    await AttendanceRecord.create({ companyId: company._id, employeeId: employee._id, workDate: new Date(Date.UTC(YEAR, MONTH - 1, 10)), workedMinutes: 208 * 60 });
    await runPayroll(ownerToken, [String(employee._id)]);
    const line = await lineFor(employee._id);
    expect(line.grossPay.toString()).toBe('30000.00');
    expect(line.basicPay.toString()).toBe('15000.00');
    expect(line.deductions.toString()).toBe('3000.00');
  });

  it('lists periods and returns each line with its employee name and payslip state', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const employee = await Employee.create({ companyId: company._id, workEmail: 'emp3@example.com', employeeCode: 'EMP-3', firstName: 'Asha', lastName: 'Nair', joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '30000' });
    await AttendanceRecord.create({ companyId: company._id, employeeId: employee._id, workDate: new Date(Date.UTC(YEAR, MONTH - 1, 10)), workedMinutes: 208 * 60 });
    const period = await runPayroll(ownerToken, [String(employee._id)]);

    const listed = await request(app).get('/api/v1/payroll-periods').set(auth(ownerToken)).expect(200);
    expect(listed.body.data.items.map((row) => `${row.periodMonth}/${row.periodYear}`)).toContain(`${MONTH}/${YEAR}`);

    // Before a payslip exists the line still names its employee.
    let detail = await request(app).get(`/api/v1/payroll-periods/${period._id}`).set(auth(ownerToken)).expect(200);
    expect(detail.body.data.lines[0]).toMatchObject({ employeeName: 'Asha Nair', employeeCode: 'EMP-3', payslip: null });

    const lineId = detail.body.data.lines[0]._id;
    await request(app).post(`/api/v1/payroll-periods/${period._id}/approve`).set(auth(ownerToken)).expect(200);
    await request(app).post(`/api/v1/payroll-lines/${lineId}/payslip`).set(auth(ownerToken)).expect(201);

    detail = await request(app).get(`/api/v1/payroll-periods/${period._id}`).set(auth(ownerToken)).expect(200);
    expect(detail.body.data.lines[0].payslip).toMatchObject({ status: 'DRAFT' });
    const payslipId = detail.body.data.lines[0].payslip._id;

    // Nothing is written to storage; the payslip is assembled on read.
    expect(await mongoose.model('DocumentAsset').countDocuments({ category: 'PAYSLIP' })).toBe(0);
    const view = await request(app).get(`/api/v1/payslips/${payslipId}`).set(auth(ownerToken)).expect(200);
    expect(view.body.data).toMatchObject({ employee: { employeeCode: 'EMP-3' }, period: { periodMonth: MONTH, periodYear: YEAR } });
    expect(Number(view.body.data.line.netPay)).toBe(27000);

    // The owner can render a PDF straight away, without waiting for publication.
    const download = await request(app).get(`/api/v1/payslips/${payslipId}/download`).set(auth(ownerToken)).expect(200);
    expect(download.body.data.contentType).toBe('application/pdf');
    expect(Buffer.from(download.body.data.contentBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(download.body.data.filename).toContain('EMP-3');
  });

  it('keeps a recruiter to their own published payslip', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const email = 'rec4@example.com';
    const user = await User.create({ companyId: company._id, role: 'RECRUITER', email, normalizedEmail: email, displayName: 'Rec Four', passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
    const employee = await Employee.create({ companyId: company._id, userId: user._id, workEmail: email, employeeCode: 'REC-4', firstName: 'Rec', lastName: 'Four', joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '30000' });
    const recruiterToken = await token(email);
    await AttendanceRecord.create({ companyId: company._id, employeeId: employee._id, workDate: new Date(Date.UTC(YEAR, MONTH - 1, 10)), workedMinutes: 208 * 60 });

    const period = await runPayroll(ownerToken, [String(employee._id)]);
    const detail = await request(app).get(`/api/v1/payroll-periods/${period._id}`).set(auth(ownerToken)).expect(200);
    const lineId = detail.body.data.lines[0]._id;
    await request(app).post(`/api/v1/payroll-periods/${period._id}/approve`).set(auth(ownerToken)).expect(200);
    const slipId = (await request(app).post(`/api/v1/payroll-lines/${lineId}/payslip`).set(auth(ownerToken)).expect(201)).body.data._id;

    // Still a draft, so the recruiter cannot see it yet.
    await request(app).get(`/api/v1/payslips/${slipId}`).set(auth(recruiterToken)).expect(404);
    await request(app).post(`/api/v1/payslips/${slipId}/approve`).set(auth(ownerToken)).expect(200);
    await request(app).post(`/api/v1/payslips/${slipId}/publish`).set(auth(ownerToken)).expect(200);

    const view = await request(app).get(`/api/v1/payslips/${slipId}`).set(auth(recruiterToken)).expect(200);
    expect(view.body.data.employee.employeeCode).toBe('REC-4');
    const mine = await request(app).get('/api/v1/payslips/me').set(auth(recruiterToken)).expect(200);
    expect(mine.body.data[0]).toMatchObject({ periodLabel: `${MONTH}/${YEAR}`, status: 'PUBLISHED' });
    expect(Number(mine.body.data[0].netPay)).toBe(27000);
  });

  it('lets the owner correct a payslip while approving it, and locks it once published', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const created = await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({
      employeeCode: 'EMP-9', workEmail: 'emp9@example.com', firstName: 'Nita', lastName: 'Rao', joiningDate: '2026-01-01',
      salaryType: 'SALARIED', monthlyCtc: '30000', takeHomeSalary: '28000',
      salaryComponents: { earnings: [{ label: 'Basic', amount: '20000' }, { label: 'HRA', amount: '10000' }], deductions: [{ label: 'Professional Tax', amount: '200' }] },
    }).expect(201);
    const employee = await Employee.findById(created.body.data._id);
    await AttendanceRecord.create({ companyId: company._id, employeeId: employee._id, workDate: new Date(Date.UTC(YEAR, MONTH - 1, 10)), workedMinutes: 208 * 60 });

    const period = await runPayroll(ownerToken, [String(employee._id)]);
    const lineId = (await request(app).get(`/api/v1/payroll-periods/${period._id}`).set(auth(ownerToken)).expect(200)).body.data.lines[0]._id;
    await request(app).post(`/api/v1/payroll-periods/${period._id}/approve`).set(auth(ownerToken)).expect(200);
    const slipId = (await request(app).post(`/api/v1/payroll-lines/${lineId}/payslip`).set(auth(ownerToken)).expect(201)).body.data._id;
    expect(Number((await lineFor(employee._id)).netPay)).toBe(29800); // 30000 gross less the 200 tax

    // A reason is required, and the correction rewrites the payroll line.
    await request(app).patch(`/api/v1/payroll-lines/${lineId}/breakdown`).set(auth(ownerToken)).send({ earnings: [{ label: 'Basic', amount: '20000' }, { label: 'HRA', amount: '12000' }] }).expect(400);
    await request(app).patch(`/api/v1/payroll-lines/${lineId}/breakdown`).set(auth(ownerToken)).send({
      earnings: [{ label: 'Basic', amount: '20000' }, { label: 'HRA', amount: '12000' }], deductionItems: [{ label: 'Professional Tax', amount: '200' }], workedHours: '208', reason: 'Corrected HRA for the month',
    }).expect(200);

    const corrected = await lineFor(employee._id);
    expect(Number(corrected.grossPay)).toBe(32000);
    expect(Number(corrected.netPay)).toBe(31800);
    expect(corrected.overrideReason).toBe('Corrected HRA for the month');
    // The payslip reads the corrected line, so document and payroll agree.
    const view = await request(app).get(`/api/v1/payslips/${slipId}`).set(auth(ownerToken)).expect(200);
    expect(Number(view.body.data.line.netPay)).toBe(31800);
    expect(view.body.data.line.earnings.map((row) => Number(row.amount))).toEqual([20000, 12000]);

    await request(app).post(`/api/v1/payslips/${slipId}/approve`).set(auth(ownerToken)).expect(200);
    await request(app).post(`/api/v1/payslips/${slipId}/publish`).set(auth(ownerToken)).expect(200);
    await request(app).patch(`/api/v1/payroll-lines/${lineId}/breakdown`).set(auth(ownerToken)).send({ workedHours: '100', reason: 'Too late' }).expect(409);
  });

  it('edits a payslip that has no configured rows without re-pro-rating the month', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const employee = await Employee.create({ companyId: company._id, workEmail: 'emp8@example.com', employeeCode: 'EMP-8', firstName: 'Half', lastName: 'Month', joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '30000' });
    // Half a month of attendance, so the calculated gross is already pro-rated.
    await AttendanceRecord.create({ companyId: company._id, employeeId: employee._id, workDate: new Date(Date.UTC(YEAR, MONTH - 1, 10)), workedMinutes: 104 * 60 });
    const period = await runPayroll(ownerToken, [String(employee._id)]);
    const lineId = (await request(app).get(`/api/v1/payroll-periods/${period._id}`).set(auth(ownerToken)).expect(200)).body.data.lines[0]._id;
    const original = await lineFor(employee._id);
    expect(Number(original.grossPay)).toBe(15000); // pro-rated
    expect(original.earnings).toHaveLength(0);     // nothing configured, so Basic/Allowances are derived

    // Re-sending the derived split unchanged must not shrink the gross again.
    await request(app).patch(`/api/v1/payroll-lines/${lineId}/breakdown`).set(auth(ownerToken)).send({
      earnings: [{ label: 'Basic', amount: '7500' }, { label: 'Allowances', amount: '7500' }],
      deductionItems: [{ label: 'Deduction', amount: '1500' }], workedHours: '104', reason: 'Made the split explicit',
    }).expect(200);
    let line = await lineFor(employee._id);
    expect(Number(line.grossPay)).toBe(15000);
    expect(Number(line.netPay)).toBe(13500);

    // And a real correction lands exactly as typed.
    await request(app).patch(`/api/v1/payroll-lines/${lineId}/breakdown`).set(auth(ownerToken)).send({
      earnings: [{ label: 'Basic', amount: '9000' }, { label: 'Allowances', amount: '7500' }], reason: 'Corrected basic',
    }).expect(200);
    line = await lineFor(employee._id);
    expect(Number(line.grossPay)).toBe(16500);
    expect(Number(line.basicPay)).toBe(9000);
    expect(Number(line.allowances)).toBe(7500);
    expect(Number(line.deductions)).toBe(1500); // untouched side keeps its total
    expect(Number(line.netPay)).toBe(15000);
    expect(Number(line.workedHours)).toBe(104); // hours left alone stay put
  });

  it('rejects a per-joining employee created without both rates', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const ownerToken = await token((await createOwner(company)).email);
    const response = await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({
      employeeCode: 'REC-3', workEmail: 'rec3@example.com', firstName: 'Half', lastName: 'Rate', joiningDate: '2026-01-01',
      salaryType: 'PER_JOINING', itJoiningRate: '5000',
    }).expect(400);
    expect(JSON.stringify(response.body)).toContain('nonItJoiningRate');
  });
});
