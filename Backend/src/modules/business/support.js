'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { AuditEvent, Notification } = require('./models');
const { serialize } = require('./rules');
const { AppError } = require('../../common/errors/AppError');
function actorOf(req) { return req.actor || req.actorContext || req.user || null; }
function requireActor(req, _res, next) {
  const actor = actorOf(req);
  if (!actor?.userId || !actor?.companyId) return next(new AppError('AUTH_TOKEN_EXPIRED', 401, 'Authentication required'));
  req.actor = actor; next();
}
function objectId(value, field = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{24}$/.test(value)) throw new AppError('INVALID_ID_FORMAT', 400, `Invalid ${field}`, [{ field, message: 'must be a 24-character hexadecimal ObjectId' }]);
  return new mongoose.Types.ObjectId(value);
}
function page(query) { return { page: Math.max(1, Number(query.page) || 1), limit: Math.min(100, Math.max(1, Number(query.limit) || 25)) }; }
function dateRange(query, defaultDays = 30) {
  const end = query.endDate ? new Date(query.endDate) : new Date();
  const start = query.startDate ? new Date(query.startDate) : new Date(end.getTime() - defaultDays * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new AppError('VALIDATION_ERROR', 400, 'Invalid date range');
  return { start, end };
}
function success(req, res, data, message = 'Operation completed successfully', status = 200) {
  return res.status(status).json({ success: true, message, data: serialize(data), meta: { requestId: req.actor?.requestId || req.requestId || null } });
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function model(name) { try { return mongoose.model(name); } catch { throw new AppError('INTERNAL_ERROR', 500, `${name} model is not registered`); } }
async function assertTenantEntity(name, id, companyId, extra = {}, options = {}) {
  const filter = { _id: objectId(String(id)), companyId: objectId(String(companyId), 'companyId'), ...extra };
  if (options.notDeleted !== false) filter.deletedAt = null;
  let query = model(name).findOne(filter);
  if (options.select) query = query.select(options.select);
  const found = await query;
  if (!found) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, `${name} not found in this company`);
  return found;
}
function redact(value) {
  const blocked = /password|token|otp|secret|accountNumber|aadhaar|pan/i;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(serialize(value)).filter(([key]) => !blocked.test(key)).map(([key, item]) => [key, item && typeof item === 'object' ? redact(item) : item]));
}
async function audit(actor, input) {
  return AuditEvent.create({
    companyId: actor.companyId, actorUserId: actor.userId, requestId: actor.requestId || null,
    ipHash: actor.ip ? crypto.createHash('sha256').update(actor.ip).digest('hex') : null,
    ...input, before: redact(input.before), after: redact(input.after),
  });
}
async function notify(input, options = {}) {
  try {
    return await Notification.create(input);
  } catch (error) {
    if (options.bestEffort || error?.code === 11000) return null;
    throw error;
  }
}

module.exports = { AppError, actorOf, requireActor, objectId, page, dateRange, success, asyncRoute, model, assertTenantEntity, audit, notify };
