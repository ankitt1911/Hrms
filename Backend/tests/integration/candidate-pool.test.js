const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const argon2 = require('argon2');
const request = require('supertest');
const app = require('../../src/app');
const Company = require('../../src/modules/company/company.model');
const { User } = require('../../src/modules/auth/user.model');
const { Employee } = require('../../src/modules/employees/employee.model');
const { JobOpening, CandidateProfile } = require('../../src/modules/business/models');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');

const PASSWORD = 'Password1234';
let mongo;

async function createOwner(company) {
  const email = 'owner@example.com';
  return User.create({ companyId: company._id, role: 'SUPER_ADMIN', email, normalizedEmail: email, displayName: 'Owner', passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
}
async function createRecruiter(company, suffix) {
  const email = `recruiter-${suffix}@example.com`;
  const user = await User.create({ companyId: company._id, role: 'RECRUITER', email, normalizedEmail: email, displayName: `Recruiter ${suffix}`, passwordHash: await argon2.hash(PASSWORD), status: 'ACTIVE' });
  const employee = await Employee.create({ companyId: company._id, userId: user._id, workEmail: email, employeeCode: `REC-${suffix}`, firstName: 'Recruiter', lastName: suffix, joiningDate: new Date('2026-01-01'), salaryType: 'SALARIED', monthlyCtc: '50000' });
  return { user, employee, email };
}
async function token(email) {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return response.body.data.accessToken;
}
const auth = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });
const profileBody = (overrides = {}) => ({ name: 'Asha Rao', contact: { phone: '9876543210' }, candidateType: 'NON_IT', languages: ['ENGLISH'], location: 'Bangalore', ...overrides });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => { await disconnectDatabase(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({}))); });

describe('candidate pool', () => {
  async function scenario() {
    const company = await Company.create({ name: 'Primary company' });
    const owner = await createOwner(company);
    const recruiterA = await createRecruiter(company, 'A');
    const recruiterB = await createRecruiter(company, 'B');
    const job = await JobOpening.create({ companyId: company._id, title: 'Developer', companyName: 'Google', status: 'ACTIVE', assignedRecruiterIds: [recruiterA.employee._id] });
    return { company, owner, recruiterA, recruiterB, job, ownerToken: await token(owner.email), tokenA: await token(recruiterA.email), tokenB: await token(recruiterB.email) };
  }

  it('lets the owner create candidates and blocks recruiters from creating them', async () => {
    const { ownerToken, tokenA } = await scenario();
    const created = await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody()).expect(201);
    expect(created.body.data).toMatchObject({ name: 'Asha Rao', status: 'NEW', submissionCount: 0 });
    await request(app).post('/api/v1/crm/candidate-profiles').set(auth(tokenA)).send(profileBody({ contact: { phone: '9000000001' } })).expect(403);
    await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody()).expect(409); // duplicate phone
  });

  it('bulk assigns candidates and scopes the recruiter list to their own', async () => {
    const { ownerToken, tokenA, tokenB, recruiterA } = await scenario();
    const one = (await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody()).expect(201)).body.data;
    const two = (await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody({ name: 'Bhavna S', contact: { phone: '9876500000' } })).expect(201)).body.data;

    const assigned = await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken))
      .send({ candidateProfileIds: [one._id, two._id], recruiterEmployeeId: String(recruiterA.employee._id) }).expect(200);
    expect(assigned.body.data).toMatchObject({ assigned: 2 });

    const mine = await request(app).get('/api/v1/crm/candidate-profiles').set(auth(tokenA)).expect(200);
    expect(mine.body.data.items).toHaveLength(2);
    expect(mine.body.data.items.every((item) => item.status === 'ASSIGNED')).toBe(true);
    const theirs = await request(app).get('/api/v1/crm/candidate-profiles').set(auth(tokenB)).expect(200);
    expect(theirs.body.data.items).toHaveLength(0);
    const all = await request(app).get('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).expect(200);
    expect(all.body.data.total).toBe(2);
    // The recruiter got one notification per assigned candidate.
    expect(await mongoose.model('Notification').countDocuments({ type: 'CANDIDATE_ASSIGNED' })).toBe(2);
  });

  it('submits an assigned candidate to a job and mirrors pipeline stages back onto the pool', async () => {
    const { ownerToken, tokenA, recruiterA, job } = await scenario();
    const profile = (await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody()).expect(201)).body.data;
    await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken)).send({ candidateProfileIds: [profile._id], recruiterEmployeeId: String(recruiterA.employee._id) }).expect(200);

    const submission = (await request(app).post(`/api/v1/crm/candidate-profiles/${profile._id}/submit`).set(auth(tokenA)).send({ jobOpeningId: String(job._id) }).expect(201)).body.data;
    expect(submission).toMatchObject({ stage: 'NEW_LEAD', name: 'Asha Rao' });
    expect(String(submission.candidateProfileId)).toBe(String(profile._id));
    expect(String(submission.recruiterEmployeeId)).toBe(String(recruiterA.employee._id));

    let pooled = await CandidateProfile.findById(profile._id);
    expect(pooled.status).toBe('SUBMITTED');
    expect(pooled.submissionCount).toBe(1);
    expect(String(pooled.activeSubmissionId)).toBe(String(submission._id));

    // One active submission at a time.
    await request(app).post(`/api/v1/crm/candidate-profiles/${profile._id}/submit`).set(auth(tokenA)).send({ jobOpeningId: String(job._id) }).expect(409);

    await request(app).post(`/api/v1/crm/candidates/${submission._id}/stage`).set(auth(tokenA)).send({ stage: 'SHORTLISTED' }).expect(200);
    pooled = await CandidateProfile.findById(profile._id);
    expect(pooled.status).toBe('SHORTLISTED');

    // Rejection releases the candidate back into the pool for a fresh submission.
    await request(app).post(`/api/v1/crm/candidates/${submission._id}/stage`).set(auth(tokenA)).send({ stage: 'REJECTED' }).expect(200);
    pooled = await CandidateProfile.findById(profile._id);
    expect(pooled.status).toBe('REJECTED');
    expect(pooled.activeSubmissionId).toBeNull();
    await request(app).post(`/api/v1/crm/candidate-profiles/${profile._id}/submit`).set(auth(tokenA)).send({ jobOpeningId: String(job._id) }).expect(201);
    expect((await CandidateProfile.findById(profile._id)).submissionCount).toBe(2);
  });

  it('refuses submission by a recruiter the candidate is not assigned to, and for unassigned jobs', async () => {
    const { ownerToken, tokenA, tokenB, recruiterA, recruiterB, job } = await scenario();
    const profile = (await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody()).expect(201)).body.data;
    await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken)).send({ candidateProfileIds: [profile._id], recruiterEmployeeId: String(recruiterA.employee._id) }).expect(200);
    await request(app).post(`/api/v1/crm/candidate-profiles/${profile._id}/submit`).set(auth(tokenB)).send({ jobOpeningId: String(job._id) }).expect(404);

    const otherJob = await JobOpening.create({ companyId: (await Company.findOne())._id, title: 'Support', companyName: 'Acme', status: 'ACTIVE', assignedRecruiterIds: [recruiterB.employee._id] });
    await request(app).post(`/api/v1/crm/candidate-profiles/${profile._id}/submit`).set(auth(tokenA)).send({ jobOpeningId: String(otherJob._id) }).expect(422);
  });

  it('reassigns and unassigns, carrying any live submission with the candidate', async () => {
    const { ownerToken, tokenA, tokenB, recruiterA, recruiterB, job } = await scenario();
    const spare = (await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody({ name: 'Pooled Only', contact: { phone: '9222222222' } })).expect(201)).body.data;
    const profile = (await request(app).post('/api/v1/crm/candidate-profiles').set(auth(ownerToken)).send(profileBody()).expect(201)).body.data;
    await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken)).send({ candidateProfileIds: [profile._id, spare._id], recruiterEmployeeId: String(recruiterA.employee._id) }).expect(200);
    const submission = (await request(app).post(`/api/v1/crm/candidate-profiles/${profile._id}/submit`).set(auth(tokenA)).send({ jobOpeningId: String(job._id) }).expect(201)).body.data;

    // Recruiter B is not on that job yet, so the handover is refused.
    await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken)).send({ candidateProfileIds: [profile._id], recruiterEmployeeId: String(recruiterB.employee._id) }).expect(409);

    await JobOpening.updateOne({ _id: job._id }, { $push: { assignedRecruiterIds: recruiterB.employee._id } });
    const moved = await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken)).send({ candidateProfileIds: [profile._id], recruiterEmployeeId: String(recruiterB.employee._id) }).expect(200);
    expect(moved.body.data).toMatchObject({ assigned: 1, submissionsMoved: 1 });

    let pooled = await CandidateProfile.findById(profile._id);
    expect(String(pooled.assignedRecruiterId)).toBe(String(recruiterB.employee._id));
    expect(pooled.status).toBe('SUBMITTED'); // the pipeline mirror is not clobbered by a handover
    expect(String((await mongoose.model('Candidate').findById(submission._id)).recruiterEmployeeId)).toBe(String(recruiterB.employee._id));
    expect((await request(app).get('/api/v1/crm/candidate-profiles').set(auth(tokenB)).expect(200)).body.data.items).toHaveLength(1);
    expect((await request(app).get('/api/v1/crm/candidate-profiles').set(auth(tokenA)).expect(200)).body.data.items.map((item) => item.name)).toEqual(['Pooled Only']);

    await request(app).post('/api/v1/crm/candidate-profiles/assign').set(auth(ownerToken)).send({ candidateProfileIds: [profile._id, spare._id], recruiterEmployeeId: null }).expect(200);
    pooled = await CandidateProfile.findById(profile._id);
    expect(pooled.assignedRecruiterId).toBeNull();
    expect(pooled.status).toBe('SUBMITTED');
    expect((await mongoose.model('Candidate').findById(submission._id)).recruiterEmployeeId).toBeNull();
    // A candidate with no live submission drops back to NEW.
    expect((await CandidateProfile.findById(spare._id)).status).toBe('NEW');
  });

  it('keeps the existing manual submission path working and unlinked from the pool', async () => {
    const { tokenA, job } = await scenario();
    const created = await request(app).post('/api/v1/crm/candidates').set(auth(tokenA)).send({
      jobOpeningId: String(job._id), name: 'Manual Entry', contact: { phone: '9111111111' }, candidateType: 'NON_IT', languages: ['ENGLISH'], consentGiven: true,
    }).expect(201);
    expect(created.body.data.candidateProfileId).toBeNull();
    await request(app).post(`/api/v1/crm/candidates/${created.body.data._id}/stage`).set(auth(tokenA)).send({ stage: 'SHORTLISTED' }).expect(200);
  });
});
