'use strict';

const argon2 = require('argon2');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Company = require('../../src/modules/company/company.model');
const { User } = require('../../src/modules/auth/user.model');
const { Employee } = require('../../src/modules/employees/employee.model');
const { Vendor, JobOpening, Candidate } = require('../../src/modules/business/models');
const { normalizeEmail } = require('../../src/modules/auth/auth.service');
const { seedLeaveTypes } = require('./defaults');

const oid = (suffix) => new mongoose.Types.ObjectId(`66f${String(suffix).padStart(21, '0')}`);
const COMPANY_ID = oid(1);
const OWNER_ID = oid(10);
const recruiters = [
  { userId: oid(20), employeeId: oid(30), name: 'Rohan Verma', email: 'recruiter@demo.hrms.test', code: 'REC-001', password: 'RecruiterDemo123!' },
  { userId: oid(21), employeeId: oid(31), name: 'Meera Iyer', email: 'recruiter2@demo.hrms.test', code: 'REC-002', password: 'RecruiterDemo456!' },
];
const upsert = (Model, id, values) => Model.findOneAndUpdate({ _id: id }, { $set: values, $setOnInsert: { _id: id } }, { upsert: true, new: true, runValidators: true });

async function run() {
  if (process.env.APP_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Demo seed is disabled in production');
  await connectDatabase();
  const company = await upsert(Company, COMPANY_ID, { singletonKey: 'PRIMARY', name: 'Ledger Demo Company', timezone: 'Asia/Kolkata' });
  await seedLeaveTypes(company._id);
  await upsert(User, OWNER_ID, { companyId: company._id, role: 'SUPER_ADMIN', email: 'owner@demo.hrms.test', normalizedEmail: 'owner@demo.hrms.test', displayName: 'Aarav Sharma', passwordHash: await argon2.hash('OwnerDemo123!', { type: argon2.argon2id }), status: 'ACTIVE', mustChangePassword: false, deletedAt: null });
  for (const recruiter of recruiters) {
    const [firstName, lastName] = recruiter.name.split(' ');
    await upsert(User, recruiter.userId, { companyId: company._id, role: 'RECRUITER', email: recruiter.email, normalizedEmail: normalizeEmail(recruiter.email), displayName: recruiter.name, passwordHash: await argon2.hash(recruiter.password, { type: argon2.argon2id }), status: 'ACTIVE', mustChangePassword: false, deletedAt: null });
    await upsert(Employee, recruiter.employeeId, { companyId: company._id, userId: recruiter.userId, workEmail: recruiter.email, employeeCode: recruiter.code, firstName, lastName, designation: 'Recruiter', department: 'Talent Acquisition', employmentStatus: 'ACTIVE', joiningDate: new Date('2025-01-01T00:00:00.000Z'), salaryType: 'SALARIED', monthlyCtc: '80000.00', deletedAt: null });
  }
  await upsert(Employee, oid(32), { companyId: company._id, workEmail: 'employee@demo.hrms.test', employeeCode: 'EMP-001', firstName: 'Ananya', lastName: 'Gupta', designation: 'Software Engineer', department: 'Engineering', employmentStatus: 'ACTIVE', joiningDate: new Date('2025-02-01T00:00:00.000Z'), salaryType: 'SALARIED', monthlyCtc: '90000.00', deletedAt: null });
  const vendor = await upsert(Vendor, oid(40), { companyId: company._id, name: 'Acme Hiring', status: 'ACTIVE', clauseDaysDefault: 45, deletedAt: null });
  const job = await upsert(JobOpening, oid(41), { companyId: company._id, vendorId: vendor._id, title: 'Backend Engineer', location: 'Bengaluru', openings: 3, status: 'ACTIVE', assignedRecruiterIds: recruiters.map(({ employeeId }) => employeeId), deletedAt: null });
  await upsert(Candidate, oid(50), { companyId: company._id, jobOpeningId: job._id, recruiterEmployeeId: recruiters[0].employeeId, name: 'Priya Nair', contact: { phone: '9876543210', email: 'priya@example.com' }, candidateType: 'IT', languages: ['ENGLISH'], consentGiven: true, stage: 'NEW_LEAD', progressionRank: 0, stageHistory: [{ fromStage: null, toStage: 'NEW_LEAD', changedBy: recruiters[0].userId }] });
  process.stdout.write('Demo seeded: 1 SUPER_ADMIN, 2 RECRUITER accounts, 1 record-only employee\n');
  await disconnectDatabase();
}
run().catch(async (error) => { process.stderr.write(`${error.stack || error.message}\n`); await disconnectDatabase(); process.exit(1); });
