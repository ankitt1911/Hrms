const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const argon2 = require('argon2');
const request = require('supertest');
const app = require('../../src/app');
const Company = require('../../src/modules/company/company.model');
const { User } = require('../../src/modules/auth/user.model');
const { Employee } = require('../../src/modules/employees/employee.model');
const { AttendanceRecord } = require('../../src/modules/attendance/attendanceRecord.model');
const { LeaveType, LeaveRequest } = require('../../src/modules/leave/leave.model');
const { dateKeyInTimeZone, canonicalDateInTimeZone, startInstantOfDateInTimeZone } = require('../../src/common/utils/dates');
const { Vendor, JobOpening, Candidate, Placement, Invoice } = require('../../src/modules/business/models');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { backfillCandidate } = require('../../scripts/maintenance/migrate-dashboard-attribution');

const PASSWORD = 'Password1234';
let mongo;

async function createOwner(company, email = 'owner@example.com') {
  return User.create({ companyId: company._id, role: 'SUPER_ADMIN', email, normalizedEmail: email, displayName: 'Owner', passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
}

async function createRecruiter(company, suffix) {
  const email = `recruiter-${suffix}@example.com`;
  const user = await User.create({ companyId: company._id, role: 'RECRUITER', email, normalizedEmail: email, displayName: `Recruiter ${suffix}`, passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
  const employee = await Employee.create({ companyId: company._id, userId: user._id, workEmail: email, employeeCode: `REC-${suffix}`, firstName: 'Recruiter', lastName: suffix, joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '50000' });
  return { user, employee };
}

async function token(email) {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  expect(response.body.data.user).toMatchObject({ email, status: 'ACTIVE' });
  expect(response.body.data.user).not.toHaveProperty('permissions');
  expect(response.body.data.user).not.toHaveProperty('roles');
  expect(response.body.data.user).not.toHaveProperty('companyId');
  return response.body.data.accessToken;
}

const auth = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => { await disconnectDatabase(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({}))); });

describe('fixed identities', () => {
  it('accepts only the two fixed role values and permits one active owner', async () => {
    const company = await Company.create({ name: 'Primary company' });
    await createOwner(company);
    await expect(createOwner(company, 'second-owner@example.com')).rejects.toMatchObject({ code: 11000 });
    await expect(User.create({ companyId: company._id, role: 'UNKNOWN_ROLE', email: 'invalid@example.com', normalizedEmail: 'invalid@example.com', status: 'ACTIVE' })).rejects.toThrow();
  });

  it('returns an employee only for a recruiter and rejects owner/employee identity overlap', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const owner = await createOwner(company); const recruiter = await createRecruiter(company, 'A');
    const ownerLogin = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: PASSWORD }).expect(200);
    expect(ownerLogin.body.data.user.role).toBe('SUPER_ADMIN'); expect(ownerLogin.body.data.user.employee).toBeNull();
    const recruiterLogin = await request(app).post('/api/v1/auth/login').send({ email: recruiter.user.email, password: PASSWORD }).expect(200);
    expect(recruiterLogin.body.data.user.role).toBe('RECRUITER'); expect(recruiterLogin.body.data.user.employee._id).toBe(String(recruiter.employee._id));
    const unlinked = await User.create({ companyId: company._id, role: 'RECRUITER', email: 'unlinked@example.com', normalizedEmail: 'unlinked@example.com', passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
    await request(app).post('/api/v1/auth/login').send({ email: unlinked.email, password: PASSWORD }).expect(403);
    await Employee.create({ companyId: company._id, userId: owner._id, workEmail: 'bad-link@example.com', employeeCode: 'BAD', firstName: 'Bad', lastName: 'Link', joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '1' });
    await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: PASSWORD }).expect(403);
  });

  it('lets recruiters read only their own employee profile and bank details', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const first = await createRecruiter(company, 'A');
    const second = await createRecruiter(company, 'B');
    const firstToken = await token(first.user.email);

    const ownProfile = await request(app).get(`/api/v1/employees/${first.employee._id}`).set(auth(firstToken)).expect(200);
    expect(ownProfile.body.data._id).toBe(String(first.employee._id));
    await request(app).get(`/api/v1/employees/${first.employee._id}/bank-details`).set(auth(firstToken)).expect(200);

    await request(app).get(`/api/v1/employees/${second.employee._id}`).set(auth(firstToken)).expect(403);
    await request(app).get(`/api/v1/employees/${second.employee._id}/bank-details`).set(auth(firstToken)).expect(403);
  });
});

describe('company-local attendance day', () => {
  it('shows a fresh local day, closes a stale shift, and allows clock-in', async () => {
    const timeZone = 'Asia/Kolkata';
    const company = await Company.create({ name: 'India company', timezone: timeZone });
    const recruiter = await createRecruiter(company, 'MIDNIGHT');
    const recruiterToken = await token(recruiter.user.email);
    const now = new Date();
    const businessDate = dateKeyInTimeZone(now, timeZone);
    const today = canonicalDateInTimeZone(now, timeZone);
    const yesterday = new Date(today.getTime() - 86400000);
    const todayStartedAt = startInstantOfDateInTimeZone(businessDate, timeZone);
    const stale = await AttendanceRecord.create({ companyId: company._id, employeeId: recruiter.employee._id, workDate: yesterday, status: 'WORKING', segments: [{ type: 'WORK', startedAt: new Date(todayStartedAt.getTime() - 3600000) }] });

    const freshState = await request(app).get('/api/v1/attendance/me/state').set(auth(recruiterToken)).expect(200);
    expect(freshState.body.data).toMatchObject({ businessDate, timeZone, status: 'NOT_STARTED' });
    expect(freshState.body.data.workDate).toBe(today.toISOString());
    const closedStale = await AttendanceRecord.findById(stale._id);
    expect(closedStale.status).toBe('COMPLETED');
    expect(closedStale.segments[0].endedAt.toISOString()).toBe(todayStartedAt.toISOString());

    const clockedIn = await request(app).post('/api/v1/attendance/me/clock-in').set(auth(recruiterToken)).send({}).expect(201);
    expect(clockedIn.body.data.status).toBe('WORKING');
    expect(clockedIn.body.data.workDate).toBe(today.toISOString());
    const currentState = await request(app).get('/api/v1/attendance/me/state').set(auth(recruiterToken)).expect(200);
    expect(currentState.body.data).toMatchObject({ businessDate, timeZone, status: 'WORKING' });
  });
});

describe('admin overview reporting', () => {
  it('returns filtered cards, attendance rows, and historically attributed recruiter events', async () => {
    const company = await Company.create({ name: 'India dashboard company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company); const first = await createRecruiter(company, 'DASH-A'); const second = await createRecruiter(company, 'DASH-B');
    const ownerToken = await token(owner.email); const recruiterToken = await token(first.user.email);
    const workDate = new Date('2026-09-14T00:00:00.000Z');
    await AttendanceRecord.create({ companyId: company._id, employeeId: first.employee._id, workDate, status: 'COMPLETED', segments: [
      { type: 'WORK', startedAt: new Date('2026-09-14T03:30:00.000Z'), endedAt: new Date('2026-09-14T05:30:00.000Z') },
      { type: 'BREAK', startedAt: new Date('2026-09-14T05:30:00.000Z'), endedAt: new Date('2026-09-14T05:45:00.000Z') },
    ] });
    const leaveType = await LeaveType.create({ companyId: company._id, name: 'Annual' });
    await LeaveRequest.create([
      { companyId: company._id, employeeId: first.employee._id, leaveTypeId: leaveType._id, startDate: new Date('2026-09-13'), endDate: new Date('2026-09-15'), status: 'APPROVED' },
      { companyId: company._id, employeeId: second.employee._id, leaveTypeId: leaveType._id, startDate: workDate, endDate: workDate, status: 'PENDING' },
    ]);
    const vendor = await Vendor.create({ companyId: company._id, name: 'Dashboard vendor' });
    const job = await JobOpening.create({ companyId: company._id, vendorId: vendor._id, title: 'Dashboard role', status: 'ACTIVE' });
    await Candidate.create({ companyId: company._id, jobOpeningId: job._id, recruiterEmployeeId: second.employee._id, name: 'Historical owner candidate', contact: { phone: '9999999999' }, candidateType: 'IT', languages: ['ENGLISH'], consentGiven: true, stage: 'SHORTLISTED', progressionRank: 3, stageHistory: [
      { fromStage: null, toStage: 'NEW_LEAD', recruiterEmployeeId: first.employee._id, changedBy: owner._id, changedAt: new Date('2026-09-14T04:00:00.000Z') },
      { fromStage: 'INTERESTED', toStage: 'SHORTLISTED', recruiterEmployeeId: first.employee._id, changedBy: owner._id, changedAt: new Date('2026-09-14T05:00:00.000Z') },
    ] });

    const response = await request(app).get('/api/v1/reports/dashboard/admin?preset=custom&startDate=2026-09-14&endDate=2026-09-14&attendancePage=1&attendanceLimit=10').set(auth(ownerToken)).expect(200);
    expect(response.body.data.range).toEqual({ preset: 'custom', startDate: '2026-09-14', endDate: '2026-09-14', timezone: 'Asia/Kolkata' });
    expect(response.body.data.cards).toEqual({ headcount: 2, activeHeadcount: 2, working: 1, onLeave: 1, pendingLeave: 1, approvedLeave: 1 });
    expect(response.body.data.attendance).toMatchObject({ page: 1, limit: 10, total: 1, pages: 1 });
    expect(response.body.data.attendance.items[0]).toMatchObject({ employeeName: 'Recruiter DASH-A', status: 'COMPLETED', workedMinutes: 120, breakMinutes: 15 });
    expect(response.body.data.workingHours).toEqual([expect.objectContaining({ employeeName: 'Recruiter DASH-A', workedMinutes: 120, breakMinutes: 15 })]);
    expect(response.body.data.performance).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeName: 'Recruiter DASH-A', submission: 1, shortlisted: 1 }),
      expect.objectContaining({ employeeName: 'Recruiter DASH-B', submission: 0, shortlisted: 0 }),
    ]));
    await request(app).get('/api/v1/reports/dashboard/admin?preset=custom&startDate=2026-09-15&endDate=2026-09-14').set(auth(ownerToken)).expect(400);
    await request(app).get('/api/v1/reports/dashboard/admin').set(auth(recruiterToken)).expect(403);
  });

  it('returns the workforce blocks, respects the department filter, and omits punctuality until a shift start is set', async () => {
    const company = await Company.create({ name: 'Workforce company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company, 'workforce-owner@example.com');
    const engineer = await createRecruiter(company, 'WF-ENG'); const sales = await createRecruiter(company, 'WF-SALES');
    await Employee.updateOne({ _id: engineer.employee._id }, { $set: { department: 'Engineering', designation: 'Engineer' } });
    await Employee.updateOne({ _id: sales.employee._id }, { $set: { department: 'Sales', designation: 'Executive' } });
    const ownerToken = await token(owner.email);
    const workDate = new Date('2026-09-14T00:00:00.000Z');
    await AttendanceRecord.create([
      // A completed short day for Engineering, and a day left open in the past for Sales.
      { companyId: company._id, employeeId: engineer.employee._id, workDate, status: 'COMPLETED', segments: [
        { type: 'WORK', startedAt: new Date('2026-09-14T05:00:00.000Z'), endedAt: new Date('2026-09-14T07:00:00.000Z') },
        { type: 'BREAK', startedAt: new Date('2026-09-14T07:00:00.000Z'), endedAt: new Date('2026-09-14T09:00:00.000Z') },
      ] },
      { companyId: company._id, employeeId: sales.employee._id, workDate, status: 'WORKING', segments: [{ type: 'WORK', startedAt: new Date('2026-09-14T04:00:00.000Z') }] },
    ]);
    const leaveType = await LeaveType.create({ companyId: company._id, name: 'Casual', isPaid: true });
    await LeaveRequest.create({ companyId: company._id, employeeId: sales.employee._id, leaveTypeId: leaveType._id, startDate: workDate, endDate: workDate, status: 'PENDING' });

    const url = '/api/v1/reports/dashboard/admin?preset=custom&startDate=2026-09-14&endDate=2026-09-14&exclude=performance';
    const { body: { data } } = await request(app).get(url).set(auth(ownerToken)).expect(200);

    // Legacy keys keep their shape.
    expect(data.cards).toMatchObject({ headcount: 2, activeHeadcount: 2, working: 2 });
    expect(data.attendance).toMatchObject({ page: 1, total: 2 });
    expect(data.performance).toEqual([]);

    expect(data.comparisonRange).toMatchObject({ startDate: '2026-09-13', endDate: '2026-09-13' });
    expect(data.granularity).toBe('day');
    expect(data.timeseries).toHaveLength(1);
    expect(data.timeseries[0]).toMatchObject({ bucket: '2026-09-14', present: 2, absent: 0 });
    expect(data.kpis.presenceRate.unit).toBe('percent');
    expect(data.kpis.avgWorkedHours.value).toBeGreaterThan(0);
    // No shift start configured, so punctuality is unavailable rather than guessed.
    expect(data.kpis.punctualityRate).toBeNull();
    expect(data.workday.punctualityAvailable).toBe(false);
    expect(data.exceptions.counts.lateDays).toBeNull();
    expect(data.exceptions.counts.longBreak).toBe(1);
    expect(data.exceptions.counts.currentlyWorking + data.exceptions.counts.missingLogout).toBe(1);
    expect(data.composition.byDepartment.map((row) => row.label).sort()).toEqual(['Engineering', 'Sales']);
    expect(data.composition.tenureBands.reduce((sum, band) => sum + band.count, 0)).toBe(2);
    expect(data.leave.queue).toMatchObject({ pending: 1 });
    expect(data.leave.byType[0]).toMatchObject({ label: 'Casual', requests: 1 });
    expect(data.payroll).toEqual({ latest: null, history: [] });
    expect(data.leaderboard.topAttendance).toHaveLength(2);
    expect(data.filterOptions.departments).toEqual(['Engineering', 'Sales']);

    // The department filter narrows every block, not just the tiles.
    const scoped = await request(app).get(`${url}&department=Engineering`).set(auth(ownerToken)).expect(200);
    expect(scoped.body.data.scope).toMatchObject({ type: 'DEPARTMENT', name: 'Engineering' });
    expect(scoped.body.data.cards.headcount).toBe(1);
    expect(scoped.body.data.attendance.total).toBe(1);
    expect(scoped.body.data.leaderboard.topAttendance).toHaveLength(1);
    expect(scoped.body.data.composition.byDepartment).toEqual([expect.objectContaining({ label: 'Engineering', count: 1 })]);

    // Once a shift start exists, punctuality becomes a real number.
    await Company.updateOne({ _id: company._id }, { $set: { 'settings.workdayStartTime': '09:30', 'settings.workdayGraceMinutes': 10 } });
    const punctual = await request(app).get(url).set(auth(ownerToken)).expect(200);
    expect(punctual.body.data.workday).toMatchObject({ punctualityAvailable: true, lateAfter: '09:40' });
    expect(punctual.body.data.kpis.punctualityRate.unit).toBe('percent');
    expect(typeof punctual.body.data.exceptions.counts.lateDays).toBe('number');
  });

  it('reports who is working right now, independently of any reporting range', async () => {
    const company = await Company.create({ name: 'Live company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company, 'live-owner@example.com');
    const working = await createRecruiter(company, 'LIVE-W');
    const onBreak = await createRecruiter(company, 'LIVE-B');
    const away = await createRecruiter(company, 'LIVE-L');
    const idle = await createRecruiter(company, 'LIVE-I');
    const ownerToken = await token(owner.email); const recruiterToken = await token(working.user.email);

    // "Today" is the company's business date, not the server's UTC date.
    const today = canonicalDateInTimeZone(new Date(), 'Asia/Kolkata');
    const startedAt = new Date(Date.now() - 3 * 3600000);
    await AttendanceRecord.create([
      { companyId: company._id, employeeId: working.employee._id, workDate: today, status: 'WORKING', segments: [{ type: 'WORK', startedAt }] },
      { companyId: company._id, employeeId: onBreak.employee._id, workDate: today, status: 'ON_BREAK', segments: [
        { type: 'WORK', startedAt, endedAt: new Date(startedAt.getTime() + 3600000) },
        { type: 'BREAK', startedAt: new Date(startedAt.getTime() + 3600000) },
      ] },
    ]);
    const leaveType = await LeaveType.create({ companyId: company._id, name: 'Casual', isPaid: true });
    await LeaveRequest.create([
      { companyId: company._id, employeeId: away.employee._id, leaveTypeId: leaveType._id, startDate: today, endDate: today, status: 'APPROVED' },
      { companyId: company._id, employeeId: idle.employee._id, leaveTypeId: leaveType._id, startDate: today, endDate: today, status: 'PENDING' },
    ]);

    const { body: { data } } = await request(app).get('/api/v1/reports/dashboard/admin/live').set(auth(ownerToken)).expect(200);

    // The three fields the browser clock depends on.
    expect(data.timeZone).toBe('Asia/Kolkata');
    expect(data.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof data.serverNow).toBe('string');

    expect(data.counters).toMatchObject({ totalEmployees: 4, working: 1, onBreak: 1, yetToClockIn: 1, finished: 0, onLeaveToday: 1, pendingApprovals: 1 });
    const statuses = data.counters;
    expect(statuses.working + statuses.onBreak + statuses.yetToClockIn + statuses.finished + statuses.onLeaveToday).toBe(statuses.totalEmployees);

    // Ordered working -> on break -> yet to clock in -> finished -> on leave.
    expect(data.employees.map((row) => row.status)).toEqual(['WORKING', 'ON_BREAK', 'NOT_STARTED', 'ON_LEAVE']);
    const [live, resting, , absent] = data.employees;
    expect(live).toMatchObject({ employeeName: 'Recruiter LIVE-W', employeeCode: 'REC-LIVE-W' });
    expect(live.workedMinutes).toBeGreaterThanOrEqual(179);
    expect(live.segments).toHaveLength(1);
    expect(live.segments[0]).toMatchObject({ type: 'WORK', endedAt: null });
    expect(live.currentSince).toBeTruthy();
    expect(resting.breakMinutes).toBeGreaterThanOrEqual(119);
    expect(absent.leave).toMatchObject({ leaveTypeName: 'Casual' });

    await request(app).get('/api/v1/reports/dashboard/admin/live').set(auth(recruiterToken)).expect(403);
  });

  it('supports a year-to-date preset', async () => {
    const company = await Company.create({ name: 'Year company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company, 'year-owner@example.com');
    await createRecruiter(company, 'YEAR');
    const ownerToken = await token(owner.email);
    const { body: { data } } = await request(app).get('/api/v1/reports/dashboard/admin?preset=year&exclude=performance').set(auth(ownerToken)).expect(200);
    expect(data.range.startDate).toMatch(/^\d{4}-01-01$/);
    expect(data.range.preset).toBe('year');
    expect(data.granularity).toBe('month');
  });

  it('drills down into the figures behind the overview and rejects unknown dimensions', async () => {
    const company = await Company.create({ name: 'Drilldown company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company, 'drilldown-owner@example.com');
    const recruiter = await createRecruiter(company, 'DRILL');
    await Employee.updateOne({ _id: recruiter.employee._id }, { $set: { department: 'Support' } });
    const ownerToken = await token(owner.email); const recruiterToken = await token(recruiter.user.email);
    const workDate = new Date('2026-09-14T00:00:00.000Z');
    await AttendanceRecord.create({ companyId: company._id, employeeId: recruiter.employee._id, workDate, status: 'COMPLETED', segments: [{ type: 'WORK', startedAt: new Date('2026-09-14T04:00:00.000Z'), endedAt: new Date('2026-09-14T06:00:00.000Z') }] });
    const leaveType = await LeaveType.create({ companyId: company._id, name: 'Sick', isPaid: false });
    await LeaveRequest.create({ companyId: company._id, employeeId: recruiter.employee._id, leaveTypeId: leaveType._id, startDate: workDate, endDate: workDate, status: 'PENDING' });
    const base = '/api/v1/reports/dashboard/admin/drilldown?preset=custom&startDate=2026-09-14&endDate=2026-09-14';

    const present = await request(app).get(`${base}&dimension=PRESENT`).set(auth(ownerToken)).expect(200);
    expect(present.body.data).toMatchObject({ kind: 'ATTENDANCE', total: 1, page: 1 });
    expect(present.body.data.items[0]).toMatchObject({ employeeName: 'Recruiter DRILL', status: 'COMPLETED', workedHours: 2 });
    expect(present.body.data.seeAll.path).toBe('/attendance');

    const department = await request(app).get(`${base}&dimension=DEPARTMENT&value=Support`).set(auth(ownerToken)).expect(200);
    expect(department.body.data).toMatchObject({ kind: 'EMPLOYEE', total: 1 });
    expect(department.body.data.seeAll).toMatchObject({ path: '/employees', query: expect.objectContaining({ department: 'Support' }) });

    const pending = await request(app).get(`${base}&dimension=LEAVE_STATUS&value=PENDING`).set(auth(ownerToken)).expect(200);
    expect(pending.body.data).toMatchObject({ kind: 'LEAVE', total: 1 });
    expect(pending.body.data.items[0]).toMatchObject({ leaveTypeName: 'Sick', days: 1, status: 'PENDING' });

    const payroll = await request(app).get(`${base}&dimension=PAYROLL_LINES`).set(auth(ownerToken)).expect(200);
    expect(payroll.body.data).toMatchObject({ kind: 'PAYROLL', total: 0, items: [] });

    // Late arrivals cannot be listed before a shift start exists.
    await request(app).get(`${base}&dimension=LATE`).set(auth(ownerToken)).expect(400);
    await request(app).get(`${base}&dimension=NOT_A_DIMENSION`).set(auth(ownerToken)).expect(400);
    await request(app).get(`${base}&dimension=ATTENDANCE_STATUS`).set(auth(ownerToken)).expect(400);
    await request(app).get(`${base}&dimension=PRESENT`).set(auth(recruiterToken)).expect(403);
  });

  it('backfills legacy stage events without changing the candidate owner', async () => {
    const company = await Company.create({ name: 'Migration company' }); const recruiter = await createRecruiter(company, 'MIGRATION');
    const inserted = await Candidate.collection.insertOne({ companyId: company._id, recruiterEmployeeId: recruiter.employee._id, name: 'Legacy candidate', stageHistory: [{ toStage: 'NEW_LEAD', changedAt: new Date() }] });
    const legacy = await Candidate.collection.findOne({ _id: inserted.insertedId });
    expect(await backfillCandidate(legacy)).toBe(true);
    const migrated = await Candidate.collection.findOne({ _id: inserted.insertedId });
    expect(String(migrated.recruiterEmployeeId)).toBe(String(recruiter.employee._id));
    expect(String(migrated.stageHistory[0].recruiterEmployeeId)).toBe(String(recruiter.employee._id));
  });
});

describe('shared CRM activity reporting', () => {
  it('returns collective admin counts and enforces recruiter self-scoping', async () => {
    const company = await Company.create({ name: 'CRM activity company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company); const first = await createRecruiter(company, 'CRM-A'); const second = await createRecruiter(company, 'CRM-B');
    const former = await Employee.create({ companyId: company._id, workEmail: 'former-crm@example.com', employeeCode: 'FORMER-CRM', firstName: 'Former', lastName: 'Recruiter', joiningDate: new Date('2025-01-01'), terminationDate: new Date('2026-01-01'), employmentStatus: 'TERMINATED', salaryType: 'SALARIED', monthlyCtc: '40000' });
    const ownerToken = await token(owner.email); const firstToken = await token(first.user.email);
    const vendor = await Vendor.create({ companyId: company._id, name: 'CRM activity vendor' });
    const job = await JobOpening.create({ companyId: company._id, vendorId: vendor._id, title: 'CRM activity role', status: 'ACTIVE' });
    const now = new Date(); const today = dateKeyInTimeZone(now, 'Asia/Kolkata');
    await Candidate.create({ companyId: company._id, jobOpeningId: job._id, recruiterEmployeeId: first.employee._id, name: 'Activity candidate', contact: { phone: '9999999999' }, candidateType: 'IT', languages: ['ENGLISH'], consentGiven: true, stage: 'SHORTLISTED', progressionRank: 3, stageHistory: [
      { fromStage: null, toStage: 'NEW_LEAD', recruiterEmployeeId: first.employee._id, changedBy: owner._id, changedAt: now },
      { fromStage: 'INTERESTED', toStage: 'SHORTLISTED', recruiterEmployeeId: first.employee._id, changedBy: owner._id, changedAt: now },
      { fromStage: 'INTERVIEW_SCHEDULED', toStage: 'INTERVIEW_SCHEDULED', eventType: 'INTERVIEW_RESCHEDULED', recruiterEmployeeId: first.employee._id, changedBy: owner._id, changedAt: now },
      { fromStage: null, toStage: 'NEW_LEAD', recruiterEmployeeId: second.employee._id, changedBy: owner._id, changedAt: now },
      { fromStage: 'INTERVIEW_SCHEDULED', toStage: 'SELECTED', recruiterEmployeeId: former._id, changedBy: owner._id, changedAt: now },
    ] });

    const query = `preset=custom&startDate=${today}&endDate=${today}`;
    const collective = await request(app).get(`/api/v1/crm/monitoring?${query}`).set(auth(ownerToken)).expect(200);
    expect(Object.keys(collective.body.data.today.counts)).toHaveLength(11);
    expect(collective.body.data.today.counts).toMatchObject({ NEW_LEAD: 2, SHORTLISTED: 1, INTERVIEW_SCHEDULED: 0, SELECTED: 1 });
    expect(collective.body.data.period.counts).toMatchObject({ NEW_LEAD: 2, SHORTLISTED: 1, SELECTED: 1 });
    expect(collective.body.data.scope).toMatchObject({ type: 'ALL', name: 'All recruiters' });
    expect(collective.body.data.employeeOptions).toEqual(expect.arrayContaining([expect.objectContaining({ employeeId: String(former._id), status: 'FORMER' })]));

    const filtered = await request(app).get(`/api/v1/crm/monitoring?${query}&employeeId=${first.employee._id}`).set(auth(ownerToken)).expect(200);
    expect(filtered.body.data.today.counts).toMatchObject({ NEW_LEAD: 1, SHORTLISTED: 1, INTERVIEW_SCHEDULED: 0, SELECTED: 0 });
    expect(filtered.body.data.scope).toMatchObject({ type: 'EMPLOYEE', employeeId: String(first.employee._id) });

    const self = await request(app).get(`/api/v1/crm/monitoring?${query}`).set(auth(firstToken)).expect(200);
    expect(self.body.data.today.counts).toMatchObject({ NEW_LEAD: 1, SHORTLISTED: 1, SELECTED: 0 });
    expect(self.body.data.employeeOptions).toEqual([]);
    await request(app).get(`/api/v1/crm/monitoring?${query}&employeeId=${second.employee._id}`).set(auth(firstToken)).expect(403);
    await request(app).get(`/api/v1/crm/monitoring?${query}&employeeId=${new mongoose.Types.ObjectId()}`).set(auth(ownerToken)).expect(404);
  });
});

describe('owner CRM analytics and drill-down', () => {
  async function seedAnalyticsCompany() {
    const company = await Company.create({ name: 'Analytics company', timezone: 'Asia/Kolkata' });
    const owner = await createOwner(company, 'analytics-owner@example.com');
    const alpha = await createRecruiter(company, 'AN-A'); const beta = await createRecruiter(company, 'AN-B');
    const vendor = await Vendor.create({ companyId: company._id, name: 'Analytics vendor' });
    const job = await JobOpening.create({ companyId: company._id, vendorId: vendor._id, title: 'Analytics role', status: 'ACTIVE', assignedRecruiterIds: [alpha.employee._id] });
    const otherJob = await JobOpening.create({ companyId: company._id, companyName: 'Direct co', title: 'Direct role', status: 'ACTIVE', assignedRecruiterIds: [beta.employee._id] });
    const now = new Date(); const today = dateKeyInTimeZone(now, 'Asia/Kolkata');
    const history = (recruiter, stages) => stages.map(([fromStage, toStage]) => ({ fromStage, toStage, recruiterEmployeeId: recruiter, changedBy: owner._id, changedAt: now }));
    const joined = await Candidate.create({ companyId: company._id, jobOpeningId: job._id, recruiterEmployeeId: alpha.employee._id, name: 'Joined candidate', contact: { phone: '9000000001' }, candidateType: 'IT', languages: ['ENGLISH'], location: 'Bengaluru', source: 'REFERRAL', consentGiven: true, stage: 'JOINED', progressionRank: 6, actualDoj: now, stageHistory: history(alpha.employee._id, [[null, 'NEW_LEAD'], ['NEW_LEAD', 'SHORTLISTED'], ['SHORTLISTED', 'INTERVIEW_SCHEDULED'], ['INTERVIEW_SCHEDULED', 'SELECTED'], ['SELECTED', 'JOINED']]) });
    await Candidate.create({ companyId: company._id, jobOpeningId: otherJob._id, recruiterEmployeeId: beta.employee._id, name: 'Open candidate', contact: { phone: '9000000002' }, candidateType: 'NON_IT', languages: ['HINDI'], location: 'Pune', source: 'PORTAL', consentGiven: true, stage: 'SHORTLISTED', progressionRank: 3, stageHistory: history(beta.employee._id, [[null, 'NEW_LEAD'], ['NEW_LEAD', 'SHORTLISTED']]) });
    await Placement.create({ companyId: company._id, candidateId: joined._id, jobOpeningId: job._id, vendorId: vendor._id, actualDoj: now, clauseDays: 45, invoiceDueDate: now, invoiceState: 'DUE', invoiceAmount: '25000' });
    return { company, owner, alpha, beta, vendor, job, otherJob, today };
  }

  it('aggregates kpis, funnel, leaderboard, breakdowns and revenue for the owner', async () => {
    const { owner, alpha, vendor, today } = await seedAnalyticsCompany();
    const ownerToken = await token(owner.email);
    const query = `preset=custom&startDate=${today}&endDate=${today}`;
    const { body } = await request(app).get(`/api/v1/crm/monitoring/analytics?${query}`).set(auth(ownerToken)).expect(200);
    const data = body.data;

    expect(data.range).toMatchObject({ startDate: today, endDate: today, timezone: 'Asia/Kolkata' });
    expect(data.kpis.submissions.value).toBe(2);
    expect(data.kpis.joined.value).toBe(1);
    expect(data.kpis.conversionRate.value).toBe(50);
    // Two candidates, one of them terminal (JOINED), so only one is still live.
    expect(data.kpis.activePipeline.value).toBe(1);
    expect(data.kpis.placementRevenue.value).toBe(25000);
    expect(data.kpis.dueForInvoicing.value).toBe(25000);
    expect(data.kpis.invoicedPipeline.value).toBe(0);
    expect(data.kpis.paidInvoices.value).toBe(0);

    // Every stage and every bucket is zero-filled so charts never have gaps.
    expect(Object.keys(data.stageCounts.period)).toHaveLength(11);
    expect(data.timeseries).toHaveLength(1);
    expect(data.timeseries[0]).toMatchObject({ bucket: today, NEW_LEAD: 2, JOINED: 1 });

    // Cohort funnel: both candidates were submitted in the period; only the
    // joined one ever got past SHORTLISTED. It must never widen further down.
    expect(data.funnel.map((step) => [step.stage, step.count])).toEqual([['NEW_LEAD', 2], ['CALLED', 2], ['INTERESTED', 2], ['SHORTLISTED', 2], ['INTERVIEW_SCHEDULED', 1], ['SELECTED', 1], ['JOINED', 1]]);
    expect(data.funnel.every((step, index) => index === 0 || step.count <= data.funnel[index - 1].count)).toBe(true);
    expect(data.funnel.find((step) => step.stage === 'JOINED')).toMatchObject({ conversionFromTop: 50 });

    expect(data.leaderboard).toHaveLength(2);
    expect(data.leaderboard[0]).toMatchObject({ employeeId: String(alpha.employee._id), total: 5, conversionRate: 100 });

    expect(data.breakdowns.byCandidateType.map((row) => row.key).sort()).toEqual(['IT', 'NON_IT']);
    expect(data.breakdowns.byVendor).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Analytics vendor', count: 1 }), expect.objectContaining({ label: 'Direct co', count: 1 })]));
    expect(data.pipelineSnapshot.find((row) => row.stage === 'JOINED')).toMatchObject({ count: 1 });
    expect(data.revenue.byInvoiceState.find((row) => row.state === 'DUE')).toMatchObject({ count: 1, amount: 25000 });
    expect(data.revenue.upcomingDue[0]).toMatchObject({ candidateName: 'Joined candidate', client: 'Analytics vendor' });
    expect(data.filterOptions.vendors).toEqual([{ key: String(vendor._id), label: 'Analytics vendor' }]);
  });

  it('narrows every aggregation when a slice filter is applied', async () => {
    const { owner, vendor, today } = await seedAnalyticsCompany();
    const ownerToken = await token(owner.email);
    const query = `preset=custom&startDate=${today}&endDate=${today}&vendorId=${vendor._id}`;
    const { body } = await request(app).get(`/api/v1/crm/monitoring/analytics?${query}`).set(auth(ownerToken)).expect(200);
    expect(body.data.kpis.submissions.value).toBe(1);
    expect(body.data.leaderboard).toHaveLength(1);
    expect(body.data.breakdowns.byCandidateType).toEqual([{ key: 'IT', label: 'IT', count: 1 }]);
  });

  it('resolves a quarter preset and keeps an empty company fully zero-filled', async () => {
    const company = await Company.create({ name: 'Empty analytics company', timezone: 'UTC' });
    const owner = await createOwner(company, 'empty-analytics@example.com');
    const { body } = await request(app).get('/api/v1/crm/monitoring/analytics?preset=quarter').set(auth(await token(owner.email))).expect(200);
    const month = Number(body.data.range.startDate.slice(5, 7));
    expect([1, 4, 7, 10]).toContain(month);
    expect(body.data.range.startDate.endsWith('-01')).toBe(true);
    expect(Object.values(body.data.stageCounts.period).every((count) => count === 0)).toBe(true);
    expect(body.data.funnel).toHaveLength(7);
    expect(body.data.timeseries.every((bucket) => bucket.total === 0)).toBe(true);
    expect(body.data.revenue.totalInvoiced).toBe(0);
  });

  it('drills a stage down to its candidate rows and a nested summary', async () => {
    const { owner, alpha, today } = await seedAnalyticsCompany();
    const ownerToken = await token(owner.email);
    const range = `preset=custom&startDate=${today}&endDate=${today}`;
    const { body } = await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=STAGE&value=NEW_LEAD`).set(auth(ownerToken)).expect(200);
    // The drill-down total must reconcile with the KPI it was opened from.
    expect(body.data.summary).toMatchObject({ dimension: 'STAGE', value: 'NEW_LEAD', total: 2 });
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]).toHaveProperty('recruiterName');
    expect(body.data.items.map((item) => item.client).sort()).toEqual(['Analytics vendor', 'Direct co']);

    const byRecruiter = await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=RECRUITER&value=${alpha.employee._id}`).set(auth(ownerToken)).expect(200);
    expect(byRecruiter.body.data.summary.total).toBe(1);
    expect(byRecruiter.body.data.items[0].name).toBe('Joined candidate');

    // Snapshot dimensions describe the present, so they ignore the reporting range.
    const byInvoice = await request(app).get('/api/v1/crm/monitoring/drilldown?preset=today&dimension=INVOICE_STATE&value=DUE').set(auth(ownerToken)).expect(200);
    expect(byInvoice.body.data.summary.total).toBe(1);

    await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=STAGE`).set(auth(ownerToken)).expect(400);
  });

  it('scopes every aggregation to the tenant', async () => {
    const { alpha, job, owner, today } = await seedAnalyticsCompany();

    // Company is a singleton in this app, so a foreign tenant can only be forged
    // at the document level. Nothing carrying a stray companyId may surface.
    const foreignCompanyId = new mongoose.Types.ObjectId();
    const now = new Date();
    await Candidate.create({ companyId: foreignCompanyId, jobOpeningId: job._id, recruiterEmployeeId: alpha.employee._id, name: 'Foreign candidate', contact: { phone: '9000000009' }, candidateType: 'IT', languages: ['ENGLISH'], consentGiven: true, stage: 'NEW_LEAD', progressionRank: 0, stageHistory: [{ fromStage: null, toStage: 'NEW_LEAD', recruiterEmployeeId: alpha.employee._id, changedBy: owner._id, changedAt: now }] });

    const range = `preset=custom&startDate=${today}&endDate=${today}`;
    const { body } = await request(app).get(`/api/v1/crm/monitoring/analytics?${range}`).set(auth(await token(owner.email))).expect(200);
    expect(body.data.kpis.submissions.value).toBe(2);
    expect(body.data.pipelineSnapshot.find((row) => row.stage === 'NEW_LEAD')).toMatchObject({ count: 0 });

    const drilled = await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=STAGE&value=NEW_LEAD`).set(auth(await token(owner.email))).expect(200);
    expect(drilled.body.data.summary.total).toBe(2);
    expect(drilled.body.data.items.map((item) => item.name)).not.toContain('Foreign candidate');
  });

  it('gives a recruiter the same dashboard scoped to their own candidates', async () => {
    const { alpha, beta, today } = await seedAnalyticsCompany();
    const alphaToken = await token(alpha.user.email);
    const range = `preset=custom&startDate=${today}&endDate=${today}`;
    const { body } = await request(app).get(`/api/v1/crm/monitoring/analytics?${range}`).set(auth(alphaToken)).expect(200);
    const data = body.data;

    // Alpha owns one candidate (the joined one); beta's must not appear anywhere.
    expect(data.scope).toMatchObject({ type: 'SELF' });
    expect(data.viewer).toMatchObject({ owner: false });
    expect(data.kpis.submissions.value).toBe(1);
    expect(data.kpis.joined.value).toBe(1);
    expect(data.funnel.map((step) => step.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(data.breakdowns.byCandidateType).toEqual([{ key: 'IT', label: 'IT', count: 1 }]);
    expect(data.pipelineSnapshot.find((row) => row.stage === 'SHORTLISTED')).toMatchObject({ count: 0 });

    // Owner-only sections are absent from the payload, not merely hidden in the UI.
    expect(data.leaderboard).toBeUndefined();
    expect(data.revenue).toBeUndefined();
    expect(data.kpis.placementRevenue).toBeUndefined();
    expect(data.kpis.invoicesDue).toBeUndefined();
    expect(data.kpis.dueForInvoicing).toBeUndefined();
    expect(data.kpis.invoicedPipeline).toBeUndefined();
    expect(data.kpis.paidInvoices).toBeUndefined();
    expect(data.filterOptions.recruiters).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(String(beta.employee._id));
    expect(JSON.stringify(data)).not.toContain('25000');
  });

  it('refuses to let a recruiter widen their scope through filters or dimensions', async () => {
    const { alpha, beta, vendor, job, otherJob, today } = await seedAnalyticsCompany();
    const alphaToken = await token(alpha.user.email);
    const range = `preset=custom&startDate=${today}&endDate=${today}`;

    await request(app).get(`/api/v1/crm/monitoring/analytics?${range}&employeeId=${beta.employee._id}`).set(auth(alphaToken)).expect(403);
    await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=RECRUITER&value=${beta.employee._id}`).set(auth(alphaToken)).expect(403);
    await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=INVOICE_STATE&value=DUE`).set(auth(alphaToken)).expect(403);

    // Filtering to a job that belongs to another recruiter must intersect with the
    // recruiter's scope and return nothing, never widen it.
    const foreign = await request(app).get(`/api/v1/crm/monitoring/analytics?${range}&jobOpeningId=${otherJob._id}`).set(auth(alphaToken)).expect(200);
    expect(foreign.body.data.kpis.submissions.value).toBe(0);
    expect(foreign.body.data.funnel.every((step) => step.count === 0)).toBe(true);

    const foreignDrill = await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=JOB&value=${otherJob._id}`).set(auth(alphaToken)).expect(200);
    expect(foreignDrill.body.data.summary.total).toBe(0);
    expect(foreignDrill.body.data.items).toEqual([]);

    // Their own job resolves normally, and only their own rows come back.
    const mine = await request(app).get(`/api/v1/crm/monitoring/drilldown?${range}&dimension=JOB&value=${job._id}`).set(auth(alphaToken)).expect(200);
    expect(mine.body.data.items.map((item) => item.name)).toEqual(['Joined candidate']);
    expect(mine.body.data.summary.byRecruiter).toEqual([]);

    // Filter options are limited to what the recruiter is assigned to.
    const { body } = await request(app).get(`/api/v1/crm/monitoring/analytics?${range}`).set(auth(alphaToken)).expect(200);
    expect(body.data.filterOptions.jobs.map((option) => option.key)).toEqual([String(job._id)]);
    expect(body.data.filterOptions.vendors.map((option) => option.key)).toEqual([String(vendor._id)]);
  });

  it('loses access to a job as soon as the recruiter is unassigned from it', async () => {
    const { alpha, job, today } = await seedAnalyticsCompany();
    const alphaToken = await token(alpha.user.email);
    const range = `preset=custom&startDate=${today}&endDate=${today}`;
    expect((await request(app).get(`/api/v1/crm/monitoring/analytics?${range}`).set(auth(alphaToken)).expect(200)).body.data.kpis.joined.value).toBe(1);

    await JobOpening.updateOne({ _id: job._id }, { $set: { assignedRecruiterIds: [] } });
    const after = await request(app).get(`/api/v1/crm/monitoring/analytics?${range}`).set(auth(alphaToken)).expect(200);
    expect(after.body.data.kpis.joined.value).toBe(0);
    expect(after.body.data.filterOptions.jobs).toEqual([]);
  });
});

describe('owner administration and recruiter lifecycle', () => {
  it('creates, reads and updates complete vendor profiles', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const owner = await createOwner(company);
    const recruiter = await createRecruiter(company, 'A');
    const ownerToken = await token(owner.email);
    const recruiterToken = await token(recruiter.user.email);
    const created = await request(app).post('/api/v1/vendors').set(auth(ownerToken)).send({
      name: 'Complete Vendor', website: 'https://vendor.example.com', agreementDate: '2026-09-13', location: 'Pune, Maharashtra',
      status: 'ACTIVE', clauseDaysDefault: 45, contactInfo: { name: 'Vendor Contact', phone: '9999999999', email: 'contact@example.com' },
    }).expect(201);
    expect(created.body.data).toMatchObject({ name: 'Complete Vendor', website: 'https://vendor.example.com', location: 'Pune, Maharashtra' });
    expect(created.body.data.agreementDate).toMatch(/^2026-09-13/);
    await request(app).get(`/api/v1/vendors/${created.body.data._id}`).set(auth(recruiterToken)).expect(403);
    const updated = await request(app).patch(`/api/v1/vendors/${created.body.data._id}`).set(auth(ownerToken)).send({ website: 'https://new.vendor.example.com', agreementDate: '2026-10-01', location: 'Mumbai, Maharashtra' }).expect(200);
    expect(updated.body.data).toMatchObject({ website: 'https://new.vendor.example.com', location: 'Mumbai, Maharashtra' });
    expect(updated.body.data.agreementDate).toMatch(/^2026-10-01/);
  });

  it('blocks recruiters from administration and immediately revokes disabled access', async () => {
    const company = await Company.create({ name: 'Primary company' });
    const owner = await createOwner(company); const recruiter = await createRecruiter(company, 'A');
    const ownerToken = await token(owner.email); const recruiterToken = await token(recruiter.user.email);
    await request(app).get('/api/v1/employees').set(auth(recruiterToken)).expect(403);
    await request(app).get('/api/v1/employees').set(auth(ownerToken)).expect(200);
    await request(app).patch(`/api/v1/employees/${recruiter.employee._id}/recruiter-access`).set(auth(ownerToken)).send({ enabled: false }).expect(200);
    await request(app).get('/api/v1/job-openings').set(auth(recruiterToken)).expect(401);
    await request(app).patch(`/api/v1/employees/${recruiter.employee._id}/recruiter-access`).set(auth(ownerToken)).send({ enabled: true }).expect(200);
    const restoredToken = await token(recruiter.user.email);
    await request(app).patch(`/api/v1/employees/${recruiter.employee._id}/status`).set(auth(ownerToken)).send({ employmentStatus: 'TERMINATED', reason: 'Employment ended' }).expect(200);
    await request(app).get('/api/v1/job-openings').set(auth(restoredToken)).expect(401);
  });

  it('creates record-only employees and optional recruiter accounts', async () => {
    const company = await Company.create({ name: 'Primary company' }); const owner = await createOwner(company); const ownerToken = await token(owner.email);
    const base = { joiningDate: '2026-09-01', salaryType: 'SALARIED', monthlyCtc: '75000.00', firstName: 'New', lastName: 'Person' };
    const recordOnly = await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({ ...base, employeeCode: 'E-1', workEmail: 'record@example.com', phone: '+91 98765 43210', qualification: 'B.Tech in Computer Science', takeHomeSalary: '65000.00', bankDetails: { accountHolder: 'New Person', bankName: 'State Bank of India', accountNumber: '123456789012', ifscOrRouting: 'SBIN0001234', pan: 'ABCDE1234F', aadhaar: '1234 5678 9012' } }).expect(201);
    expect(recordOnly.body.data.userId).toBeUndefined();
    expect(recordOnly.body.data).toMatchObject({ phone: '+91 98765 43210', qualification: 'B.Tech in Computer Science', takeHomeSalary: '65000.00' });
    const bank = await request(app).get(`/api/v1/employees/${recordOnly.body.data._id}/bank-details`).set(auth(ownerToken)).expect(200);
    expect(bank.body.data).toMatchObject({ accountHolder: 'New Person', bankName: 'State Bank of India', ifscOrRouting: 'SBIN0001234' });
    expect(bank.body.data.accountNumber).not.toBe('123456789012'); expect(bank.body.data.accountNumber).toMatch(/9012$/);
    expect(bank.body.data.pan).not.toBe('ABCDE1234F'); expect(bank.body.data.aadhaar).not.toBe('1234 5678 9012');
    const updated = await request(app).patch(`/api/v1/employees/${recordOnly.body.data._id}`).set(auth(ownerToken)).send({ phone: '+91 90000 00000', qualification: 'MBA', takeHomeSalary: '68000.00' }).expect(200);
    expect(updated.body.data).toMatchObject({ phone: '+91 90000 00000', qualification: 'MBA', takeHomeSalary: '68000.00' });
    await request(app).patch(`/api/v1/employees/${recordOnly.body.data._id}/bank-details`).set(auth(ownerToken)).send({ accountHolder: 'New Person Updated', accountNumber: '998877665544' }).expect(200);
    const updatedBank = await request(app).get(`/api/v1/employees/${recordOnly.body.data._id}/bank-details`).set(auth(ownerToken)).expect(200);
    expect(updatedBank.body.data.accountHolder).toBe('New Person Updated'); expect(updatedBank.body.data.accountNumber).toMatch(/5544$/);
    await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({ ...base, employeeCode: 'E-3', workEmail: 'record-two@example.com' }).expect(201);
    const recruiter = await request(app).post('/api/v1/employees').set(auth(ownerToken)).send({ ...base, employeeCode: 'E-2', workEmail: 'login@example.com', recruiterAccount: { temporaryPassword: 'Temporary123' } }).expect(201);
    expect(recruiter.body.data.userId.role).toBe('RECRUITER');
  });
});

describe('job assignment and candidate ownership', () => {
  it('persists complete job details, protects vendor payment, and supports unsaved companies through placement', async () => {
    const company = await Company.create({ name: 'Primary company' }); const owner = await createOwner(company); const recruiter = await createRecruiter(company, 'A');
    const ownerToken = await token(owner.email); const recruiterToken = await token(recruiter.user.email);
    const created = await request(app).post('/api/v1/job-openings').set(auth(ownerToken)).send({
      companyName: 'Unsaved Client Pvt Ltd', title: 'Customer Support Associate', process: 'VOICE', skills: 'English, customer service',
      salaryRange: '35000-45000 monthly', monthlyCtc: '45000', takeHomeSalary: '38000', vendorPayment: '12000',
      clauseDays: 60, jobType: 'NON_IT', requirements: 'Graduate with strong spoken English', location: 'Pune', openings: 4, status: 'ACTIVE',
    }).expect(201);
    expect(created.body.data).toMatchObject({ companyName: 'Unsaved Client Pvt Ltd', process: 'VOICE', skills: 'English, customer service', monthlyCtc: '45000', takeHomeSalary: '38000', vendorPayment: '12000', clauseDays: 60, jobType: 'NON_IT' });
    expect(created.body.data.vendorId).toBeNull();
    await request(app).patch(`/api/v1/job-openings/${created.body.data._id}/recruiters`).set(auth(ownerToken)).send({ recruiterEmployeeIds: [String(recruiter.employee._id)] }).expect(200);
    const recruiterView = await request(app).get(`/api/v1/job-openings/${created.body.data._id}`).set(auth(recruiterToken)).expect(200);
    expect(recruiterView.body.data).toMatchObject({ companyName: 'Unsaved Client Pvt Ltd', requirements: 'Graduate with strong spoken English', clauseDays: 60 });
    expect(recruiterView.body.data).not.toHaveProperty('vendorPayment');
    expect(recruiterView.body.data).not.toHaveProperty('internalPaymentDetails');
    const candidate = await Candidate.create({ companyId: company._id, jobOpeningId: created.body.data._id, recruiterEmployeeId: recruiter.employee._id, name: 'Selected Candidate', contact: { phone: '9876543210' }, candidateType: 'IT', languages: ['ENGLISH'], consentGiven: true, stage: 'INTERVIEW_SCHEDULED', progressionRank: 4, stageHistory: [{ fromStage: null, toStage: 'INTERVIEW_SCHEDULED', changedBy: owner._id }] });
    const expectedDoj = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const selectedCandidate = await request(app).post(`/api/v1/crm/candidates/${candidate._id}/stage`).set(auth(ownerToken)).send({ stage: 'SELECTED', expectedDoj }).expect(200);
    expect(selectedCandidate.body.data.expectedDoj).toBe(expectedDoj);
    const placement = await Placement.findOne({ candidateId: candidate._id });
    expect(placement).toMatchObject({ companyName: 'Unsaved Client Pvt Ltd', clauseDays: 60 });
    expect(placement.vendorId).toBeNull();
    expect(placement.invoiceAmount.toString()).toBe('12000');
    const placementList = await request(app).get('/api/v1/placements').set(auth(ownerToken)).expect(200);
    expect(placementList.body.data.items.find((item) => item._id === String(placement._id))).toMatchObject({ candidateName: 'Selected Candidate', jobTitle: 'Customer Support Associate', clientName: 'Unsaved Client Pvt Ltd', invoiceAmount: '12000' });
  });

  it('generates, previews, downloads and pays an invoice without ever storing the PDF', async () => {
    const company = await Company.create({ name: 'Invoice company' }); const owner = await createOwner(company); const recruiter = await createRecruiter(company, 'INV');
    const ownerToken = await token(owner.email); const recruiterToken = await token(recruiter.user.email);
    const vendor = await Vendor.create({ companyId: company._id, name: 'Invoice vendor' });
    const job = await JobOpening.create({ companyId: company._id, vendorId: vendor._id, title: 'Invoice role', vendorPayment: '30000', status: 'ACTIVE', assignedRecruiterIds: [recruiter.employee._id] });
    const futureDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const candidate = await Candidate.create({ companyId: company._id, jobOpeningId: job._id, recruiterEmployeeId: recruiter.employee._id, name: 'Invoice Candidate', contact: { phone: '9876500001' }, candidateType: 'IT', languages: ['ENGLISH'], consentGiven: true, stage: 'JOINED', progressionRank: 6, actualDoj: new Date() });
    const placement = await Placement.create({ companyId: company._id, candidateId: candidate._id, jobOpeningId: job._id, vendorId: vendor._id, companyName: null, actualDoj: new Date(), clauseDays: 45, invoiceDueDate: futureDue, invoiceState: 'FUTURE_DUE', invoiceAmount: '30000' });

    // A recruiter cannot touch any invoice route.
    await request(app).get(`/api/v1/placements/${placement._id}/invoice/draft`).set(auth(recruiterToken)).expect(403);
    await request(app).post(`/api/v1/placements/${placement._id}/invoice/save`).set(auth(recruiterToken)).send({ lineItems: [{ label: 'Fee', amount: 30000 }] }).expect(403);

    const draft = await request(app).get(`/api/v1/placements/${placement._id}/invoice/draft`).set(auth(ownerToken)).expect(200);
    expect(draft.body.data.saved).toBe(false);
    expect(draft.body.data.isEarly).toBe(true);
    expect(draft.body.data.lineItems).toEqual([{ label: 'Placement fee — Invoice Candidate', amount: 30000 }]);

    // Preview renders a PDF but writes nothing.
    const preview = await request(app).post(`/api/v1/placements/${placement._id}/invoice/preview`).set(auth(ownerToken)).send({ lineItems: [{ label: 'Placement fee', amount: 30000 }, { label: 'Referral bonus', amount: 2000 }] }).expect(200);
    expect(preview.body.data.contentType).toBe('application/pdf');
    expect(Buffer.from(preview.body.data.contentBase64, 'base64').toString('latin1')).toMatch(/^%PDF/);
    expect(await Invoice.countDocuments({ placementId: placement._id })).toBe(0);
    expect((await Placement.findById(placement._id)).invoiceState).toBe('FUTURE_DUE');
    expect(await mongoose.model('DocumentAsset').countDocuments({})).toBe(0);

    // Save persists the invoice and moves the placement to GENERATED, even though it is early.
    const saved = await request(app).post(`/api/v1/placements/${placement._id}/invoice/save`).set(auth(ownerToken)).send({ lineItems: [{ label: 'Placement fee', amount: 30000 }, { label: 'Referral bonus', amount: 2000 }] }).expect(200);
    expect(saved.body.data.total).toBe('32000');
    expect(saved.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/);
    expect((await Placement.findById(placement._id)).invoiceState).toBe('GENERATED');
    expect(await Invoice.countDocuments({ placementId: placement._id })).toBe(1);
    expect(await mongoose.model('DocumentAsset').countDocuments({})).toBe(0);

    // Download re-renders from the saved record; content matches what was saved.
    const download = await request(app).get(`/api/v1/placements/${placement._id}/invoice/download`).set(auth(ownerToken)).expect(200);
    expect(download.body.data.filename).toBe(`invoice-${saved.body.data.invoiceNumber}.pdf`);
    expect(Buffer.from(download.body.data.contentBase64, 'base64').toString('latin1')).toContain('Referral bonus: 2000.00');

    await request(app).post(`/api/v1/placements/${placement._id}/invoice/ready`).set(auth(ownerToken)).expect(200);
    await request(app).post(`/api/v1/placements/${placement._id}/invoice/raise`).set(auth(ownerToken)).send({ invoiceReference: 'REF-1' }).expect(200);
    const raised = await Placement.findById(placement._id);
    expect(raised.invoiceState).toBe('RAISED'); expect(raised.raisedAt).toBeTruthy();

    // Mark paid must not wipe raisedAt/raisedBy.
    await request(app).post(`/api/v1/placements/${placement._id}/invoice/paid`).set(auth(recruiterToken)).expect(403);
    const paidResult = await request(app).post(`/api/v1/placements/${placement._id}/invoice/paid`).set(auth(ownerToken)).expect(200);
    expect(paidResult.body.data.invoiceState).toBe('PAID');
    expect(paidResult.body.data.raisedAt).toBeTruthy();
    expect(paidResult.body.data.paidAt).toBeTruthy();

    // Marking an already-paid invoice paid again is rejected, not silently repeated.
    await request(app).post(`/api/v1/placements/${placement._id}/invoice/paid`).set(auth(ownerToken)).expect(409);
  });

  it('enforces assignment, lifecycle, unassignment and owner-only reassignment', async () => {
    const company = await Company.create({ name: 'Primary company' }); const owner = await createOwner(company); const first = await createRecruiter(company, 'A'); const second = await createRecruiter(company, 'B');
    const ownerToken = await token(owner.email); const firstToken = await token(first.user.email); const secondToken = await token(second.user.email);
    const vendor = await Vendor.create({ companyId: company._id, name: 'Vendor' });
    const job = await JobOpening.create({ companyId: company._id, vendorId: vendor._id, title: 'Recruiter job', vendorPayment: '25000', status: 'ACTIVE', assignedRecruiterIds: [] });
    await request(app).patch(`/api/v1/job-openings/${job._id}/recruiters`).set(auth(firstToken)).send({ recruiterEmployeeIds: [String(first.employee._id)] }).expect(403);
    await request(app).patch(`/api/v1/job-openings/${job._id}/recruiters`).set(auth(ownerToken)).send({ recruiterEmployeeIds: [String(first.employee._id)] }).expect(200);
    const candidateInput = { jobOpeningId: String(job._id), name: 'Candidate One', contact: { phone: '9999999999' }, candidateType: 'NON_IT', languages: ['ENGLISH', 'HINDI'], consentGiven: true };
    await request(app).post('/api/v1/crm/candidates').set(auth(firstToken)).send({ ...candidateInput, recruiterEmployeeId: String(second.employee._id), name: 'Invalid owner' }).expect(403);
    await request(app).post('/api/v1/crm/candidates').set(auth(firstToken)).send({ jobOpeningId: String(job._id), name: 'Invalid candidate', contact: { phone: '9999999999' }, consentGiven: true }).expect(400);
    const created = await request(app).post('/api/v1/crm/candidates').set(auth(firstToken)).send(candidateInput).expect(201);
    expect(created.body.data).toMatchObject({ name: 'Candidate One', stage: 'NEW_LEAD', candidateType: 'NON_IT', languages: ['ENGLISH', 'HINDI'] });
    expect(created.body.data.recruiterEmployeeId).toBe(String(first.employee._id));
    await request(app).get(`/api/v1/crm/candidates/${created.body.data._id}`).set(auth(secondToken)).expect(404);
    const recruiterSubmissions = await request(app).get('/api/v1/crm/candidates?bucket=SUBMISSIONS').set(auth(firstToken)).expect(200);
    expect(recruiterSubmissions.body.data.items.map((item) => item._id)).toContain(created.body.data._id);
    const adminSubmissions = await request(app).get('/api/v1/crm/candidates?bucket=SUBMISSIONS&search=Candidate').set(auth(ownerToken)).expect(200);
    expect(adminSubmissions.body.data.items.map((item) => item._id)).toContain(created.body.data._id);
    await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'SHORTLISTED' }).expect(200);
    const afterShortlist = await request(app).get('/api/v1/crm/candidates?bucket=SUBMISSIONS').set(auth(firstToken)).expect(200);
    expect(afterShortlist.body.data.items).toHaveLength(0);
    const shortlisted = await request(app).get('/api/v1/crm/candidates?bucket=SHORTLISTED').set(auth(firstToken)).expect(200);
    expect(shortlisted.body.data.items.map((item) => item._id)).toContain(created.body.data._id);
    await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'INTERVIEW_SCHEDULED' }).expect(400);
    const firstInterviewDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const scheduledInterview = await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'INTERVIEW_SCHEDULED', interviewDate: firstInterviewDate }).expect(200);
    expect(scheduledInterview.body.data).toMatchObject({ stage: 'INTERVIEW_SCHEDULED', interviewStatus: 'SCHEDULED', interviewDate: firstInterviewDate });
    expect(scheduledInterview.body.data.stageHistory.at(-1)).toMatchObject({ toStage: 'INTERVIEW_SCHEDULED', interviewDate: firstInterviewDate });
    const afterInterview = await request(app).get('/api/v1/crm/candidates?bucket=SHORTLISTED').set(auth(firstToken)).expect(200);
    expect(afterInterview.body.data.items).toHaveLength(0);
    const interviews = await request(app).get('/api/v1/crm/candidates?bucket=INTERVIEW_SCHEDULED').set(auth(firstToken)).expect(200);
    expect(interviews.body.data.items.map((item) => item._id)).toContain(created.body.data._id);
    const secondInterviewDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const rescheduled = await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/interview`).set(auth(firstToken)).send({ action: 'RESCHEDULE', interviewDate: secondInterviewDate }).expect(200);
    expect(rescheduled.body.data).toMatchObject({ interviewStatus: 'SCHEDULED', interviewDate: secondInterviewDate });
    expect(rescheduled.body.data.stageHistory.at(-1)).toMatchObject({ eventType: 'INTERVIEW_RESCHEDULED', interviewDate: secondInterviewDate });
    await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/interview`).set(auth(secondToken)).send({ action: 'CANCEL' }).expect(404);
    const cancelled = await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/interview`).set(auth(firstToken)).send({ action: 'CANCEL' }).expect(200);
    expect(cancelled.body.data).toMatchObject({ interviewStatus: 'CANCELLED', interviewDate: null });
    expect(cancelled.body.data.stageHistory.at(-1)).toMatchObject({ eventType: 'INTERVIEW_CANCELLED', interviewDate: secondInterviewDate });
    const finalInterviewDate = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/interview`).set(auth(firstToken)).send({ action: 'RESCHEDULE', interviewDate: finalInterviewDate }).expect(200);
    await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'SELECTED' }).expect(400);
    const expectedDoj = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const selectedTransition = await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'SELECTED', expectedDoj }).expect(200);
    expect(selectedTransition.body.data.expectedDoj).toBe(expectedDoj);
    const selected = await request(app).get('/api/v1/crm/candidates?bucket=SELECTED').set(auth(firstToken)).expect(200);
    expect(selected.body.data.items.map((item) => item._id)).toContain(created.body.data._id);
    const interviewsAfterSelection = await request(app).get('/api/v1/crm/candidates?bucket=INTERVIEW_SCHEDULED').set(auth(firstToken)).expect(200);
    expect(interviewsAfterSelection.body.data.items).toHaveLength(0);
    const joinedTransition = await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'JOINED' }).expect(200);
    expect(joinedTransition.body.data.actualDoj).toBeTruthy();
    const joinedPlacement = await Placement.findOne({ candidateId: created.body.data._id });
    expect(joinedPlacement.actualDoj.toISOString()).toBe(joinedTransition.body.data.actualDoj);
    expect(joinedPlacement.invoiceDueDate).toBeTruthy();
    expect(joinedPlacement.invoiceAmount.toString()).toBe('25000');
    const joined = await request(app).get('/api/v1/crm/candidates?bucket=JOINED').set(auth(firstToken)).expect(200);
    expect(joined.body.data.items.map((item) => item._id)).toContain(created.body.data._id);
    const selectedAfterJoining = await request(app).get('/api/v1/crm/candidates?bucket=SELECTED').set(auth(firstToken)).expect(200);
    expect(selectedAfterJoining.body.data.items).toHaveLength(0);
    const rejectedCandidate = await request(app).post('/api/v1/crm/candidates').set(auth(firstToken)).send({ ...candidateInput, name: 'Rejected candidate' }).expect(201);
    await request(app).post(`/api/v1/crm/candidates/${rejectedCandidate.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'SHORTLISTED' }).expect(200);
    await request(app).post(`/api/v1/crm/candidates/${rejectedCandidate.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'REJECTED' }).expect(200);
    const rejected = await request(app).get('/api/v1/crm/candidates?bucket=REJECTED').set(auth(firstToken)).expect(200);
    expect(rejected.body.data.items.map((item) => item._id)).toContain(rejectedCandidate.body.data._id);
    await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(firstToken)).send({ stage: 'CALLED' }).expect(409);
    await request(app).patch(`/api/v1/job-openings/${job._id}/status`).set(auth(ownerToken)).send({ status: 'ON_HOLD' }).expect(200);
    await request(app).get(`/api/v1/crm/candidates/${created.body.data._id}`).set(auth(firstToken)).expect(200);
    await request(app).post('/api/v1/crm/candidates').set(auth(firstToken)).send({ ...candidateInput, name: 'Blocked candidate' }).expect(404);
    await request(app).patch(`/api/v1/job-openings/${job._id}/recruiters`).set(auth(ownerToken)).send({ recruiterEmployeeIds: [] }).expect(200);
    await request(app).get(`/api/v1/crm/candidates/${created.body.data._id}`).set(auth(firstToken)).expect(404);
    expect(String((await Candidate.findById(created.body.data._id)).recruiterEmployeeId)).toBe(String(first.employee._id));
    await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/recruiter`).set(auth(firstToken)).send({ recruiterEmployeeId: null }).expect(403);
    await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/recruiter`).set(auth(ownerToken)).send({ recruiterEmployeeId: String(second.employee._id) }).expect(422);
    await request(app).patch(`/api/v1/crm/candidates/${created.body.data._id}/recruiter`).set(auth(ownerToken)).send({ recruiterEmployeeId: null }).expect(200);
  });
});
