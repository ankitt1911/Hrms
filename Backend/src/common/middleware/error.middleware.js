const mongoose = require('mongoose');
const { ZodError } = require('zod');
const { AppError } = require('../errors/AppError');

function notFound(req, _res, next) {
  next(new AppError('NOT_FOUND', 404, `Route ${req.method} ${req.originalUrl} was not found`));
}

function mapDuplicate(error) {
  const keys = Object.keys(error.keyPattern || error.keyValue || {});
  if (keys.includes('normalizedEmail')) return new AppError('DUPLICATE_EMAIL', 409, 'Email is already in use');
  if (keys.includes('employeeCode')) return new AppError('DUPLICATE_EMPLOYEE_CODE', 409, 'Employee code is already in use');
  return new AppError('CONFLICT', 409, 'A record with these values already exists');
}

function errorHandler(error, req, res, _next) {
  let mapped = error;
  if (error instanceof ZodError) {
    mapped = new AppError('VALIDATION_ERROR', 400, 'Request validation failed', error.issues.map((issue) => ({
      field: issue.path.filter((p) => p !== 'body' && p !== 'query' && p !== 'params').join('.'), message: issue.message,
    })));
  } else if (error?.code === 11000) mapped = mapDuplicate(error);
  else if (error instanceof mongoose.Error.CastError) mapped = new AppError('INVALID_ID_FORMAT', 400, 'Invalid ID format');
  else if (error instanceof mongoose.Error.ValidationError) {
    mapped = new AppError('VALIDATION_ERROR', 400, 'Request validation failed', Object.entries(error.errors).map(([field, value]) => ({ field, message: value.message })));
  } else if (error instanceof mongoose.Error.VersionError) mapped = new AppError('CONFLICT', 409, 'Record changed; reload and retry');

  const status = mapped instanceof AppError ? mapped.status : 500;
  if (status === 500) process.stderr.write(`[${req.requestId}] ${req.method} ${req.originalUrl} failed: ${error?.stack || error}\n`);
  res.status(status).json({
    success: false,
    message: status === 500 ? 'An unexpected error occurred' : mapped.message,
    code: status === 500 ? 'INTERNAL_ERROR' : mapped.code,
    errors: mapped.details || [],
    meta: { requestId: req.requestId },
  });
}

module.exports = { notFound, errorHandler };
