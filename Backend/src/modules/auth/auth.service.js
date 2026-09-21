const crypto = require('node:crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { sha256, randomToken, ipHash } = require('../../common/utils/security');
const { addSeconds } = require('../../common/utils/dates');
const { User } = require('./user.model');
const Session = require('./session.model');
const { PasswordResetToken, OtpCode } = require('./credential.model');
const { Employee } = require('../employees/employee.model');
const email = require('../../integrations/email/email.service');

const normalizeEmail = (value) => value.trim().toLowerCase();

function durationMs(value) {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  return Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 })[match[2]];
}

function signAccessToken(user, session) {
  return jwt.sign({ sessionId: String(session._id), tokenVersion: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id), expiresIn: env.JWT_ACCESS_EXPIRES_IN, algorithm: 'HS256',
  });
}

async function publicProfile(user) {
  const employee = user.role === 'RECRUITER'
    ? await Employee.findOne({ userId: user._id, companyId: user.companyId, deletedAt: null }).select('_id firstName lastName employeeCode workEmail employmentStatus')
    : null;
  return {
    id: user.id, email: user.email, displayName: user.displayName, role: user.role,
    status: user.status, mustChangePassword: user.mustChangePassword, employee,
  };
}

async function findLoginUser(emailAddress) {
  return User.findOne({ normalizedEmail: normalizeEmail(emailAddress), deletedAt: null }).select('+passwordHash');
}

async function login(input, client = {}) {
  const user = await findLoginUser(input.email);
  if (!user) throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid email or password');
  const now = new Date();
  if (user.status === 'DISABLED') throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Account is disabled');
  if (user.status === 'INVITATION_PENDING' || !user.passwordHash) throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Account has not been activated');
  if (user.status === 'LOCKED' && user.lockedUntil && user.lockedUntil > now) throw new AppError('AUTH_ACCOUNT_LOCKED', 423, 'Account is temporarily locked');
  if (user.status === 'LOCKED' && (!user.lockedUntil || user.lockedUntil <= now)) {
    user.status = 'ACTIVE'; user.failedLoginCount = 0; user.lockedUntil = null;
  }
  const matches = await argon2.verify(user.passwordHash, input.password).catch(() => false);
  if (!matches) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= env.AUTH_MAX_FAILED_ATTEMPTS) {
      user.status = 'LOCKED'; user.lockedUntil = new Date(now.getTime() + env.AUTH_LOCK_MINUTES * 60000);
    }
    await user.save();
    throw new AppError(user.status === 'LOCKED' ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_INVALID_CREDENTIALS', user.status === 'LOCKED' ? 423 : 401, user.status === 'LOCKED' ? 'Account is temporarily locked' : 'Invalid email or password');
  }
  const employee = await Employee.findOne({ userId: user._id, companyId: user.companyId, deletedAt: null });
  if (user.role === 'SUPER_ADMIN' && employee) throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Owner accounts cannot be employee accounts');
  if (user.role === 'RECRUITER' && (!employee || employee.employmentStatus !== 'ACTIVE')) throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Recruiter employee account is not active');
  user.failedLoginCount = 0; user.lockedUntil = null;
  if (user.status === 'LOCKED') user.status = 'ACTIVE';
  await user.save();
  const refreshToken = randomToken();
  const session = await Session.create({
    userId: user._id, refreshTokenHash: sha256(refreshToken), familyId: crypto.randomUUID(),
    deviceId: input.deviceId || null, userAgent: client.userAgent || null, ipHash: ipHash(client.ip),
    expiresAt: new Date(now.getTime() + durationMs(env.JWT_REFRESH_EXPIRES_IN)),
  });
  return { accessToken: signAccessToken(user, session), refreshToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN, user: await publicProfile(user) };
}

async function refresh(refreshToken) {
  const tokenHash = sha256(refreshToken);
  let session = await Session.findOne({ $or: [{ refreshTokenHash: tokenHash }, { usedTokenHashes: tokenHash }] }).select('+refreshTokenHash +usedTokenHashes');
  if (!session) throw new AppError('AUTH_REFRESH_INVALID', 401, 'Refresh token is invalid');
  if (session.usedTokenHashes.includes(tokenHash) || session.revokedAt) {
    await Session.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' } });
    throw new AppError('AUTH_REFRESH_INVALID', 401, 'Refresh token reuse detected');
  }
  if (session.expiresAt <= new Date()) throw new AppError('AUTH_REFRESH_INVALID', 401, 'Refresh token is expired');
  const user = await User.findOne({ _id: session.userId, deletedAt: null });
  if (!user || user.status !== 'ACTIVE') throw new AppError(user?.status === 'DISABLED' ? 'AUTH_ACCOUNT_DISABLED' : 'AUTH_REFRESH_INVALID', 401, 'Account cannot refresh a session');
  const nextToken = randomToken();
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, refreshTokenHash: tokenHash, revokedAt: null },
    { $set: { refreshTokenHash: sha256(nextToken), lastUsedAt: new Date() }, $push: { usedTokenHashes: { $each: [tokenHash], $slice: -10 } } },
    { new: true },
  );
  if (!updated) {
    await Session.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' } });
    throw new AppError('AUTH_REFRESH_INVALID', 401, 'Refresh token reuse detected');
  }
  return { accessToken: signAccessToken(user, updated), refreshToken: nextToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN };
}

async function revokeSession(sessionId, userId, reason = 'LOGOUT') {
  await Session.updateOne({ _id: sessionId, userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

async function revokeAll(userId, reason = 'LOGOUT_ALL') {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

async function forgotPassword(input) {
  const user = await findLoginUser(input.email);
  if (!user || user.status === 'DISABLED') return;
  await PasswordResetToken.deleteMany({ userId: user._id, usedAt: null });
  const token = randomToken(32);
  await PasswordResetToken.create({ userId: user._id, tokenHash: sha256(token), purpose: 'PASSWORD_RESET', expiresAt: addSeconds(new Date(), env.PASSWORD_RESET_TTL_SECONDS) });
  await email.send({ to: user.email, subject: 'Reset your Smart HRMS password', text: `Use this one-time reset token: ${token}` });
}

async function requestOtp(input) {
  const user = await findLoginUser(input.email);
  if (!user || user.status === 'DISABLED') return;
  await OtpCode.deleteMany({ userId: user._id, usedAt: null, purpose: 'PASSWORD_RESET' });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await OtpCode.create({ userId: user._id, tokenHash: sha256(code), purpose: 'PASSWORD_RESET', expiresAt: addSeconds(new Date(), env.OTP_TTL_SECONDS) });
  await email.send({ to: user.email, subject: 'Your Smart HRMS verification code', text: `Your one-time verification code is ${code}` });
}

async function verifyOtp(input) {
  const user = await findLoginUser(input.email);
  if (!user) throw new AppError('AUTH_INVALID_CREDENTIALS', 400, 'Verification code is invalid or expired');
  const otp = await OtpCode.findOne({ userId: user._id, purpose: 'PASSWORD_RESET', usedAt: null }).sort('-createdAt').select('+tokenHash');
  const now = new Date();
  if (!otp || otp.expiresAt <= now || otp.attempts >= env.OTP_MAX_ATTEMPTS || otp.tokenHash !== sha256(input.code)) {
    if (otp) { otp.attempts += 1; await otp.save(); }
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= env.AUTH_MAX_FAILED_ATTEMPTS) { user.status = 'LOCKED'; user.lockedUntil = new Date(now.getTime() + env.AUTH_LOCK_MINUTES * 60000); }
    await user.save();
    throw new AppError(user.status === 'LOCKED' ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_INVALID_CREDENTIALS', user.status === 'LOCKED' ? 423 : 400, 'Verification code is invalid or expired');
  }
  otp.usedAt = now; user.failedLoginCount = 0;
  const resetToken = randomToken(32);
  await Promise.all([otp.save(), user.save(), PasswordResetToken.create({ userId: user._id, tokenHash: sha256(resetToken), purpose: 'PASSWORD_RESET', expiresAt: addSeconds(now, env.PASSWORD_RESET_TTL_SECONDS) })]);
  return { resetToken, expiresIn: env.PASSWORD_RESET_TTL_SECONDS };
}

async function resetPassword(token, newPassword) {
  const credential = await PasswordResetToken.findOne({ tokenHash: sha256(token), usedAt: null }).select('+tokenHash');
  if (!credential || credential.expiresAt <= new Date()) throw new AppError('AUTH_REFRESH_INVALID', 400, 'Reset token is invalid or expired');
  const user = await User.findById(credential.userId).select('+passwordHash');
  if (!user || user.status === 'DISABLED') throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Account is disabled');
  const now = new Date();
  credential.usedAt = now;
  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  user.passwordChangedAt = now; user.mustChangePassword = false; user.failedLoginCount = 0; user.lockedUntil = null; user.status = 'ACTIVE'; user.tokenVersion += 1;
  await Promise.all([credential.save(), user.save(), revokeAll(user._id, 'PASSWORD_RESET')]);
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Current password is incorrect');
  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  user.passwordChangedAt = new Date(); user.mustChangePassword = false; user.tokenVersion += 1;
  await user.save();
  await revokeAll(user._id, 'PASSWORD_CHANGED');
}

module.exports = { normalizeEmail, login, refresh, revokeSession, revokeAll, forgotPassword, requestOtp, verifyOtp, resetPassword, changePassword, publicProfile };
