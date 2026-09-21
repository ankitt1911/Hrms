const { AppError } = require('../errors/AppError');

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.actor || !roles.includes(req.actor.role)) {
      return next(new AppError('PERMISSION_DENIED', 403, 'You do not have access to perform this action'));
    }
    next();
  };
}

const requireSuperAdmin = requireRole('SUPER_ADMIN');
const requireRecruiter = requireRole('RECRUITER');

function requireEmployee(req, _res, next) {
  if (req.actor?.role !== 'RECRUITER' || !req.actor.employeeId) {
    return next(new AppError('PERMISSION_DENIED', 403, 'An active recruiter employee profile is required'));
  }
  next();
}

module.exports = { requireRole, requireSuperAdmin, requireRecruiter, requireEmployee };
