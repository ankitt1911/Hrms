const argon2 = require('argon2');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Company = require('../../src/modules/company/company.model');
const { User } = require('../../src/modules/auth/user.model');
const { normalizeEmail } = require('../../src/modules/auth/auth.service');
const { seedLeaveTypes } = require('./defaults');

async function run() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const ownerName = process.env.SUPER_ADMIN_NAME || 'System Owner';
  const companyName = process.env.COMPANY_NAME || 'Smart HRMS';
  if (!email || !password || password.length < 10) throw new Error('Set SUPER_ADMIN_EMAIL and a SUPER_ADMIN_PASSWORD of at least 10 characters');
  await connectDatabase();
  const company = await Company.findOneAndUpdate({ singletonKey: 'PRIMARY' }, { $setOnInsert: { singletonKey: 'PRIMARY', name: companyName } }, { upsert: true, new: true });
  const normalizedEmail = normalizeEmail(email);
  const existingOwner = await User.findOne({ role: 'SUPER_ADMIN', deletedAt: null }).select('+passwordHash');
  if (existingOwner && existingOwner.normalizedEmail !== normalizedEmail) throw new Error(`A different SUPER_ADMIN already exists: ${existingOwner.email}`);
  if (!existingOwner) await User.create({ companyId: company._id, role: 'SUPER_ADMIN', email, normalizedEmail, displayName: ownerName, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), status: 'ACTIVE', mustChangePassword: false });
  const leaveTypeCount = await seedLeaveTypes(company._id);
  process.stdout.write(`SUPER_ADMIN ready for ${company.name}; ${leaveTypeCount} default leave types ready\n`);
  await disconnectDatabase();
}
run().catch(async (error) => { process.stderr.write(`${error.message}\n`); await disconnectDatabase(); process.exit(1); });
