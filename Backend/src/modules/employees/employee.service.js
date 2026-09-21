const mongoose = require('mongoose');
const argon2 = require('argon2');
const { Employee } = require('./employee.model');
const EmployeeBankDetails = require('./employeeBankDetails.model');
const { User } = require('../auth/user.model');
const Session = require('../auth/session.model');
const { AppError } = require('../../common/errors/AppError');
const { pagination } = require('../../common/http/pagination');
const { normalizeEmail, forgotPassword, revokeAll } = require('../auth/auth.service');
const { assertExists } = require('../../common/utils/references');
const { encryptSensitive, decryptSensitive, mask } = require('../../common/utils/security');
const { recordAudit } = require('../../common/services/sideEffects');
const { rollbackAndRethrow } = require('../../common/utils/compensatingWrites');

function bankForStorage(input) {
  const output = {};
  if ('accountHolder' in input) output.accountHolder = input.accountHolder;
  if ('bankName' in input) output.bankName = input.bankName;
  if ('ifscOrRouting' in input) output.ifscOrRouting = input.ifscOrRouting;
  if ('accountNumber' in input) output.accountNumberEncrypted = encryptSensitive(input.accountNumber);
  if ('pan' in input) output.panEncrypted = encryptSensitive(input.pan);
  if ('aadhaar' in input) output.aadhaarEncrypted = encryptSensitive(input.aadhaar);
  return output;
}

async function create(ctx, input) {
  if (input.managerId) await assertExists(Employee, input.managerId, { companyId: ctx.companyId });
  const employeeId = new mongoose.Types.ObjectId();
  const userId = input.recruiterAccount ? new mongoose.Types.ObjectId() : null;
  const cleanups = [() => EmployeeBankDetails.deleteOne({ employeeId }), () => Employee.deleteOne({ _id: employeeId }), () => userId ? User.deleteOne({ _id: userId }) : null];
  try {
    if (userId) await User.create({ _id: userId, companyId: ctx.companyId, role: 'RECRUITER', email: input.workEmail, normalizedEmail: normalizeEmail(input.workEmail), displayName: `${input.firstName} ${input.lastName}`, passwordHash: await argon2.hash(input.recruiterAccount.temporaryPassword, { type: argon2.argon2id }), status: 'ACTIVE', mustChangePassword: true });
    const employee = await Employee.create({ _id: employeeId, companyId: ctx.companyId, ...(userId ? { userId } : {}), employeeCode: input.employeeCode, workEmail: normalizeEmail(input.workEmail), firstName: input.firstName, lastName: input.lastName, phone: input.phone, qualification: input.qualification, designation: input.designation, department: input.department, managerId: input.managerId, joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`), salaryType: input.salaryType, hourlyRate: input.hourlyRate, monthlyCtc: input.monthlyCtc, takeHomeSalary: input.takeHomeSalary, itJoiningRate: input.itJoiningRate, nonItJoiningRate: input.nonItJoiningRate, salaryComponents: { earnings: input.salaryComponents?.earnings || [], deductions: input.salaryComponents?.deductions || [] } });
    if (input.bankDetails) await EmployeeBankDetails.create({ employeeId, ...bankForStorage(input.bankDetails) });
    return employee.populate('userId', 'email role status');
  } catch (error) { return rollbackAndRethrow(error, cleanups); }
}

async function list(ctx, query) {
  const { page, limit, skip } = pagination(query); const filter = { companyId: ctx.companyId, deletedAt: null };
  if (query.status) filter.employmentStatus = query.status; if (query.department) filter.department = query.department;
  if (query.search) filter.$or = ['firstName', 'lastName', 'employeeCode', 'designation', 'qualification', 'phone', 'workEmail'].map((field) => ({ [field]: { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
  const [items, total] = await Promise.all([Employee.find(filter).populate('userId', 'email role status').sort('-createdAt').skip(skip).limit(limit), Employee.countDocuments(filter)]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

async function get(ctx, id, forceAdmin = false) {
  if (!forceAdmin && ctx.role !== 'SUPER_ADMIN' && String(ctx.employeeId) !== String(id)) throw new AppError('PERMISSION_DENIED', 403, 'Recruiters can only view their own employee profile');
  const employee = await Employee.findOne({ _id: id, companyId: ctx.companyId, deletedAt: null }).populate('userId', 'email role status displayName');
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee not found');
  return employee;
}

async function update(ctx, id, input) {
  const employee = await get(ctx, id, true);
  if (input.managerId) { if (String(input.managerId) === String(id)) throw new AppError('VALIDATION_ERROR', 400, 'Employee cannot manage themselves'); await assertExists(Employee, input.managerId, { companyId: ctx.companyId }); }
  const patch = { ...input }; if (input.joiningDate) patch.joiningDate = new Date(`${input.joiningDate}T00:00:00.000Z`); if (input.workEmail) patch.workEmail = normalizeEmail(input.workEmail);
  const updated = await Employee.findOneAndUpdate({ _id: id, companyId: ctx.companyId, deletedAt: null }, { $set: patch }, { new: true, runValidators: true });
  if (employee.userId && (input.workEmail || input.firstName || input.lastName)) await User.updateOne({ _id: employee.userId._id || employee.userId, role: 'RECRUITER' }, { $set: { ...(input.workEmail ? { email: input.workEmail, normalizedEmail: normalizeEmail(input.workEmail) } : {}), ...((input.firstName || input.lastName) ? { displayName: `${input.firstName || employee.firstName} ${input.lastName || employee.lastName}` } : {}) } });
  return updated.populate('userId', 'email role status');
}

async function revokeRecruiter(userId, reason) {
  if (!userId) return;
  await User.updateOne({ _id: userId, role: 'RECRUITER' }, { $set: { status: 'DISABLED' }, $inc: { tokenVersion: 1 } });
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

async function setStatus(ctx, id, input) {
  const employee = await Employee.findOne({ _id: id, companyId: ctx.companyId, deletedAt: null }); if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee not found');
  const before = { employmentStatus: employee.employmentStatus, terminationDate: employee.terminationDate };
  employee.employmentStatus = input.employmentStatus; employee.terminationDate = input.employmentStatus === 'TERMINATED' ? new Date(`${input.terminationDate || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) : null; await employee.save();
  if (input.employmentStatus === 'TERMINATED') await revokeRecruiter(employee.userId, 'EMPLOYEE_TERMINATED');
  await recordAudit({ ctx, action: 'EMPLOYEE_STATUS_CHANGED', entityType: 'Employee', entityId: id, before, after: { employmentStatus: employee.employmentStatus, terminationDate: employee.terminationDate }, reason: input.reason });
  return employee;
}

async function setRecruiterAccess(ctx, id, input) {
  const employee = await Employee.findOne({ _id: id, companyId: ctx.companyId, deletedAt: null }); if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee not found');
  if (!input.enabled) await revokeRecruiter(employee.userId, 'RECRUITER_ACCESS_DISABLED');
  else {
    if (employee.employmentStatus !== 'ACTIVE') throw new AppError('AUTH_ACCOUNT_DISABLED', 409, 'Only active employees can receive recruiter access');
    let user = employee.userId ? await User.findById(employee.userId).select('+passwordHash') : null;
    if (!user && !input.temporaryPassword) throw new AppError('VALIDATION_ERROR', 400, 'A temporary password is required when creating recruiter access');
    if (!user) {
      user = await User.create({ companyId: ctx.companyId, role: 'RECRUITER', email: employee.workEmail, normalizedEmail: normalizeEmail(employee.workEmail), displayName: `${employee.firstName} ${employee.lastName}`, passwordHash: await argon2.hash(input.temporaryPassword, { type: argon2.argon2id }), status: 'ACTIVE', mustChangePassword: true }); employee.userId = user._id; await employee.save();
    } else {
      if (user.role !== 'RECRUITER') throw new AppError('CONFLICT', 409, 'Employee is linked to an invalid account type');
      if (input.temporaryPassword) { user.passwordHash = await argon2.hash(input.temporaryPassword, { type: argon2.argon2id }); user.mustChangePassword = true; }
      if (!user.passwordHash) throw new AppError('VALIDATION_ERROR', 400, 'A temporary password is required to restore this recruiter');
      user.status = 'ACTIVE'; user.failedLoginCount = 0; user.lockedUntil = null; user.tokenVersion += 1; await user.save();
    }
  }
  await recordAudit({ ctx, action: input.enabled ? 'RECRUITER_ACCESS_ENABLED' : 'RECRUITER_ACCESS_DISABLED', entityType: 'Employee', entityId: id });
  return get(ctx, id, true);
}

/*
 * Two ways to hand an account back to its owner. Without `newPassword` the
 * employee gets a reset link and the admin never learns the password, which
 * stays the safer default. With one, the admin sets a password directly — for
 * the common case of handing it over in person — and the account is flagged
 * `mustChangePassword`, so that password only survives until the employee's next
 * sign-in. Either way every existing session is revoked.
 */
async function resetCredentials(ctx, id, newPassword) {
  const employee = await Employee.findOne({ _id: id, companyId: ctx.companyId, deletedAt: null }).populate('userId', 'email role status');
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee not found'); if (!employee.userId || employee.userId.role !== 'RECRUITER') throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Recruiter account not found');
  if (!newPassword) {
    await forgotPassword({ email: employee.userId.email });
    await recordAudit({ ctx, action: 'RECRUITER_CREDENTIAL_RESET_REQUESTED', entityType: 'Employee', entityId: id });
    return { mode: 'RESET_LINK', email: employee.userId.email };
  }
  const user = await User.findById(employee.userId._id).select('+passwordHash');
  if (!user || user.status === 'DISABLED') throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Account is disabled');
  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  user.passwordChangedAt = new Date();
  user.mustChangePassword = true;
  user.failedLoginCount = 0; user.lockedUntil = null;
  if (['INVITATION_PENDING', 'LOCKED'].includes(user.status)) user.status = 'ACTIVE';
  user.tokenVersion += 1;
  await user.save();
  await revokeAll(user._id, 'ADMIN_PASSWORD_SET');
  // The password itself is never audited or returned.
  await recordAudit({ ctx, action: 'RECRUITER_PASSWORD_SET', entityType: 'Employee', entityId: id });
  return { mode: 'PASSWORD_SET', email: user.email, mustChangePassword: true };
}

async function getBank(ctx, id) { await get(ctx, id); const details = await EmployeeBankDetails.findOne({ employeeId: id }).select('+accountNumberEncrypted +panEncrypted +aadhaarEncrypted'); if (!details) return null; return { accountHolder: details.accountHolder, bankName: details.bankName, ifscOrRouting: details.ifscOrRouting, accountNumber: mask(decryptSensitive(details.accountNumberEncrypted)), pan: mask(decryptSensitive(details.panEncrypted)), aadhaar: mask(decryptSensitive(details.aadhaarEncrypted)) }; }
async function updateBank(ctx, id, input) { await get(ctx, id, true); return EmployeeBankDetails.findOneAndUpdate({ employeeId: id }, { $set: bankForStorage(input) }, { new: true, upsert: true, runValidators: true }); }

module.exports = { create, list, get, update, setStatus, setRecruiterAccess, resetCredentials, getBank, updateBank };
