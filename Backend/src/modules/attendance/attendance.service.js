const mongoose = require('mongoose');
const { AttendanceRecord } = require('./attendanceRecord.model');
const Company = require('../company/company.model');
const { AppError } = require('../../common/errors/AppError');
const { startOfUtcDay, endOfUtcDay, dateKeyInTimeZone, canonicalDateInTimeZone, startInstantOfDateInTimeZone, isValidTimeZone } = require('../../common/utils/dates');
const { pagination } = require('../../common/http/pagination');
const { recordAudit } = require('../../common/services/sideEffects');

function totals(segments) {
  return segments.reduce((sum, segment) => {
    if (!segment.endedAt) return sum;
    const minutes = Math.max(0, Math.floor((new Date(segment.endedAt) - new Date(segment.startedAt)) / 60000));
    sum[segment.type === 'WORK' ? 'workedMinutes' : 'breakMinutes'] += minutes;
    return sum;
  }, { workedMinutes: 0, breakMinutes: 0 });
}

async function attendanceDay(ctx, now = new Date()) {
  const company = await Company.findById(ctx.companyId).select('timezone settings').lean();
  const timeZone = isValidTimeZone(company?.timezone) ? company.timezone : 'UTC';
  const businessDate = dateKeyInTimeZone(now, timeZone);
  return { businessDate, timeZone, workDate: canonicalDateInTimeZone(now, timeZone), startsAt: startInstantOfDateInTimeZone(businessDate, timeZone), settings: company?.settings || {} };
}

// The employee's own shift target, so their attendance page can show progress
// against a full day rather than an unanchored running total.
function workdayTarget(settings = {}) {
  return {
    standardWorkMinutes: Number.isFinite(settings.standardWorkMinutes) && settings.standardWorkMinutes > 0 ? settings.standardWorkMinutes : 480,
    workdayStartTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.workdayStartTime || '')) ? settings.workdayStartTime : null,
  };
}

async function closeStaleShifts(ctx, day) {
  const staleRecords = await AttendanceRecord.find({ employeeId: ctx.employeeId, companyId: ctx.companyId, workDate: { $lt: day.workDate }, status: { $in: ['WORKING', 'ON_BREAK'] } });
  for (const record of staleRecords) {
    for (const segment of record.segments) {
      if (!segment.endedAt) segment.endedAt = day.startsAt > segment.startedAt ? day.startsAt : segment.startedAt;
    }
    Object.assign(record, totals(record.segments));
    record.status = 'COMPLETED';
    await record.save();
  }
}

async function state(ctx, now = new Date()) {
  const day = await attendanceDay(ctx, now);
  await closeStaleShifts(ctx, day);
  const record = await AttendanceRecord.findOne({ employeeId: ctx.employeeId, companyId: ctx.companyId, workDate: day.workDate });
  return { ...(record?.toObject() || { status: 'NOT_STARTED', workDate: day.workDate, workedMinutes: 0, breakMinutes: 0, segments: [] }), businessDate: day.businessDate, timeZone: day.timeZone, serverNow: now, workday: workdayTarget(day.settings) };
}

async function clockIn(ctx, now = new Date()) {
  const day = await attendanceDay(ctx, now);
  await closeStaleShifts(ctx, day);
  try {
    return await AttendanceRecord.create({ employeeId: ctx.employeeId, companyId: ctx.companyId, workDate: day.workDate, status: 'WORKING', segments: [{ type: 'WORK', startedAt: now }] });
  } catch (error) {
    if (error.code === 11000) throw new AppError('ATTENDANCE_ALREADY_CLOCKED_IN', 409, 'Attendance has already started for today');
    throw error;
  }
}

async function transition(ctx, expectedStatus, nextStatus, closeType, openType, now = new Date()) {
  const { workDate } = await attendanceDay(ctx, now);
  const closedSegments = { $map: { input: '$segments', as: 'segment', in: { $cond: [
    { $and: [{ $eq: ['$$segment.type', closeType] }, { $eq: [{ $ifNull: ['$$segment.endedAt', null] }, null] }] },
    { $mergeObjects: ['$$segment', { endedAt: now }] }, '$$segment',
  ] } } };
  const resultingSegments = openType
    ? { $concatArrays: [closedSegments, [{ _id: new mongoose.Types.ObjectId(), type: openType, startedAt: now, endedAt: null, createdAt: now }]] }
    : closedSegments;
  const minuteSum = (type) => ({ $reduce: { input: '$segments', initialValue: 0, in: { $add: ['$$value', { $cond: [
    { $and: [{ $eq: ['$$this.type', type] }, { $ne: [{ $ifNull: ['$$this.endedAt', null] }, null] }] },
    { $floor: { $divide: [{ $subtract: ['$$this.endedAt', '$$this.startedAt'] }, 60000] } }, 0,
  ] }] } } });
  const record = await AttendanceRecord.findOneAndUpdate(
    { employeeId: ctx.employeeId, companyId: ctx.companyId, workDate, status: expectedStatus, segments: { $elemMatch: { type: closeType, endedAt: null } } },
    [{ $set: { status: nextStatus, segments: resultingSegments, updatedAt: now, __v: { $add: [{ $ifNull: ['$__v', 0] }, 1] } } }, { $set: { workedMinutes: minuteSum('WORK'), breakMinutes: minuteSum('BREAK') } }],
    { new: true },
  );
  if (!record) throw new AppError('ATTENDANCE_INVALID_TRANSITION', 409, `Action is only allowed while ${expectedStatus}`);
  return record;
}

const startBreak = (ctx, now) => transition(ctx, 'WORKING', 'ON_BREAK', 'WORK', 'BREAK', now);
const resume = (ctx, now) => transition(ctx, 'ON_BREAK', 'WORKING', 'BREAK', 'WORK', now);
async function clockOut(ctx, now = new Date()) {
  const { workDate } = await attendanceDay(ctx, now);
  const current = await AttendanceRecord.findOne({ employeeId: ctx.employeeId, companyId: ctx.companyId, workDate });
  if (!current || !['WORKING', 'ON_BREAK'].includes(current.status)) throw new AppError('ATTENDANCE_INVALID_TRANSITION', 409, 'Clock out is only allowed while working or on break');
  return transition(ctx, current.status, 'COMPLETED', current.status === 'WORKING' ? 'WORK' : 'BREAK', null, now);
}

async function history(ctx, query) {
  const { page, limit, skip } = pagination(query); const filter = { employeeId: ctx.employeeId, companyId: ctx.companyId };
  if (query.from || query.to) filter.workDate = { ...(query.from && { $gte: startOfUtcDay(query.from) }), ...(query.to && { $lte: endOfUtcDay(query.to) }) };
  const [items, total] = await Promise.all([AttendanceRecord.find(filter).sort('-workDate').skip(skip).limit(limit), AttendanceRecord.countDocuments(filter)]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

async function adminList(ctx, query) {
  const { page, limit, skip } = pagination(query); const filter = { companyId: ctx.companyId };
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  if (query.date) filter.workDate = startOfUtcDay(query.date);
  else if (query.from || query.to) filter.workDate = { ...(query.from && { $gte: startOfUtcDay(query.from) }), ...(query.to && { $lte: endOfUtcDay(query.to) }) };
  const [items, total] = await Promise.all([AttendanceRecord.find(filter).populate('employeeId', 'employeeCode firstName lastName').sort('-workDate').skip(skip).limit(limit), AttendanceRecord.countDocuments(filter)]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

async function correct(ctx, id, input) {
  const record = await AttendanceRecord.findOne({ _id: id, companyId: ctx.companyId });
  if (!record) throw new AppError('TENANT_SCOPE_VIOLATION', 404, 'Attendance record was not found');
  if (record.__v !== input.expectedVersion) throw new AppError('CONFLICT', 409, 'Attendance record changed; reload and retry');
  const before = { status: record.status, workedMinutes: record.workedMinutes, breakMinutes: record.breakMinutes, segments: record.segments.map((s) => s.toObject()) };
  record.segments = input.segments.map((s) => ({ ...s, startedAt: new Date(s.startedAt), endedAt: new Date(s.endedAt) }));
  Object.assign(record, totals(record.segments)); record.status = input.status; record.correctedBy = ctx.userId; record.correctionReason = input.reason;
  const after = { status: record.status, workedMinutes: record.workedMinutes, breakMinutes: record.breakMinutes, segments: record.segments.map((s) => s.toObject()) };
  record.corrections.push({ correctedBy: ctx.userId, reason: input.reason, correctedAt: new Date(), before, after });
  await record.save();
  await recordAudit({ ctx, action: 'ATTENDANCE_CORRECTED', entityType: 'AttendanceRecord', entityId: id, before: { status: before.status, workedMinutes: before.workedMinutes, breakMinutes: before.breakMinutes }, after: { status: after.status, workedMinutes: after.workedMinutes, breakMinutes: after.breakMinutes }, reason: input.reason });
  return record;
}
module.exports = { totals, attendanceDay, closeStaleShifts, state, clockIn, startBreak, resume, clockOut, history, adminList, correct };
