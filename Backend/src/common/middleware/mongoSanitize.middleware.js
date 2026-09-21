const { AppError } = require('../errors/AppError');

function hasUnsafeKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasUnsafeKey);
  return Object.entries(value).some(([key, child]) => key.startsWith('$') || key.includes('.') || hasUnsafeKey(child));
}

function mongoSanitize(req, _res, next) {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
    return next(new AppError('VALIDATION_ERROR', 400, 'Request contains prohibited field names'));
  }
  return next();
}

module.exports = { mongoSanitize, hasUnsafeKey };
