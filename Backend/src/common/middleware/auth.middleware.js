const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { AppError } = require('../errors/AppError');
const { User } = require('../../modules/auth/user.model');
const Session = require('../../modules/auth/session.model');
const { Employee } = require('../../modules/employees/employee.model');

async function authenticate(req, _res, next) {
  try {
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Authentication is required');
    let claims;
    try { claims = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET); }
    catch { throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Access token is invalid or expired'); }
    const [user, session] = await Promise.all([
      User.findOne({ _id: claims.sub, deletedAt: null }),
      Session.findOne({ _id: claims.sessionId, userId: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() } }),
    ]);
    if (!user || !session || user.tokenVersion !== claims.tokenVersion) throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Session is no longer valid');
    if (user.status === 'DISABLED') throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Account is disabled');
    if (user.status !== 'ACTIVE') throw new AppError('AUTH_ACCOUNT_LOCKED', 423, 'Account is not active');
    const employee = await Employee.findOne({ userId: user._id, companyId: user.companyId, deletedAt: null }).select('_id employmentStatus');
    if (user.role === 'SUPER_ADMIN' && employee) throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Owner accounts cannot be employee accounts');
    if (user.role === 'RECRUITER' && (!employee || employee.employmentStatus !== 'ACTIVE')) throw new AppError('AUTH_ACCOUNT_DISABLED', 403, 'Recruiter employee account is not active');
    req.actor = {
      requestId: req.requestId, userId: String(user._id), sessionId: String(session._id), companyId: String(user.companyId),
      employeeId: user.role === 'RECRUITER' && employee ? String(employee._id) : null, role: user.role,
      ip: req.ip, userAgent: req.get('user-agent') || '',
    };
    req.authUser = user;
    next();
  } catch (error) { next(error); }
}

module.exports = { authenticate };
