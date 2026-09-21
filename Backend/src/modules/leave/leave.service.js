const { LeaveType, LeaveRequest } = require('./leave.model');
const { Employee } = require('../employees/employee.model');
const { AppError } = require('../../common/errors/AppError');
const { assertExists } = require('../../common/utils/references');
const { startOfUtcDay, endOfUtcDay } = require('../../common/utils/dates');
const { pagination } = require('../../common/http/pagination');
const { recordAudit, notifyUser } = require('../../common/services/sideEffects');

const listTypes = (ctx) => LeaveType.find({ companyId: ctx.companyId, deletedAt: null }).sort('name');
const createType = (ctx, input) => LeaveType.create({ companyId: ctx.companyId, ...input });

async function submit(ctx, input) {
  const employee = await assertExists(Employee, ctx.employeeId, { companyId: ctx.companyId, filter: { employmentStatus: 'ACTIVE' }, code: 'EMPLOYEE_NOT_FOUND' });
  await assertExists(LeaveType, input.leaveTypeId, { companyId: ctx.companyId });
  const startDate = startOfUtcDay(input.startDate); const endDate = startOfUtcDay(input.endDate);
  const overlap = await LeaveRequest.exists({ employeeId: employee._id, companyId: ctx.companyId, status: { $in: ['PENDING', 'APPROVED'] }, startDate: { $lte: endDate }, endDate: { $gte: startDate } });
  if (overlap) throw new AppError('LEAVE_OVERLAP', 409, 'Leave dates overlap an existing pending or approved request');
  return LeaveRequest.create({ companyId: ctx.companyId, employeeId: employee._id, leaveTypeId: input.leaveTypeId, startDate, endDate, reason: input.reason, attachmentDocumentId: input.attachmentDocumentId });
}

async function list(ctx, query, own = false) {
  const { page, limit, skip } = pagination(query); const filter = { companyId: ctx.companyId };
  if (own) filter.employeeId = ctx.employeeId; else if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  if (query.from || query.to) { filter.startDate = { ...(query.to && { $lte: endOfUtcDay(query.to) }) }; filter.endDate = { ...(query.from && { $gte: startOfUtcDay(query.from) }) }; }
  const [items, total] = await Promise.all([LeaveRequest.find(filter).populate('leaveTypeId', 'name isPaid').populate('employeeId', 'employeeCode firstName lastName').sort('-createdAt').skip(skip).limit(limit), LeaveRequest.countDocuments(filter)]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

async function decide(ctx, id, status, note) {
  const request = await LeaveRequest.findOneAndUpdate({ _id: id, companyId: ctx.companyId, status: 'PENDING' }, { $set: { status, reviewerId: ctx.userId, decisionNote: note || null, decidedAt: new Date() } }, { new: true }).populate('employeeId', 'userId');
  if (!request) throw new AppError('CONFLICT', 409, 'Leave request is not pending or is outside this company');
  if (request.employeeId.userId) await notifyUser({ companyId: ctx.companyId, recipientUserId: request.employeeId.userId, type: `LEAVE_${status}`, title: `Leave request ${status.toLowerCase()}`, linkEntityType: 'LeaveRequest', linkEntityId: request._id });
  return request;
}

async function cancel(ctx, id, reason) {
  const filter = { _id: id, companyId: ctx.companyId, status: { $in: ['PENDING', 'APPROVED'] } };
  if (ctx.role !== 'SUPER_ADMIN') filter.employeeId = ctx.employeeId;
  const before = await LeaveRequest.findOne(filter).select('status');
  const updated = before && await LeaveRequest.findOneAndUpdate({ ...filter, status: before.status }, { $set: { status: 'CANCELLED', cancelledBy: ctx.userId, cancelledAt: new Date(), cancellationReason: reason } }, { new: true });
  if (!updated) throw new AppError('PERMISSION_DENIED', 403, 'Leave request cannot be cancelled');
  await recordAudit({ ctx, action: 'LEAVE_CANCELLED', entityType: 'LeaveRequest', entityId: id, before: { status: before.status }, after: { status: 'CANCELLED' }, reason });
  return updated;
}
module.exports = { listTypes, createType, submit, list, decide, cancel };
