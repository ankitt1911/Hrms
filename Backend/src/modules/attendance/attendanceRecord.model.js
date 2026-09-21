const { Schema, model } = require('mongoose');
const ATTENDANCE_STATUSES = ['NOT_STARTED', 'WORKING', 'ON_BREAK', 'COMPLETED'];
const SEGMENT_TYPES = ['WORK', 'BREAK'];
const AttendanceSegmentSchema = new Schema({
  type: { type: String, enum: SEGMENT_TYPES, required: true }, startedAt: { type: Date, required: true }, endedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, _id: true });
const CorrectionSchema = new Schema({
  correctedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, reason: { type: String, required: true }, correctedAt: { type: Date, required: true },
  before: { type: Schema.Types.Mixed, required: true }, after: { type: Schema.Types.Mixed, required: true },
}, { _id: true });
const AttendanceRecordSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true }, companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  workDate: { type: Date, required: true }, status: { type: String, enum: ATTENDANCE_STATUSES, default: 'NOT_STARTED' }, workedMinutes: { type: Number, default: 0 }, breakMinutes: { type: Number, default: 0 },
  segments: [AttendanceSegmentSchema], correctedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, correctionReason: { type: String, default: null }, corrections: [CorrectionSchema],
}, { timestamps: true, optimisticConcurrency: true });
AttendanceRecordSchema.index({ employeeId: 1, workDate: 1 }, { unique: true });
AttendanceRecordSchema.index({ companyId: 1, workDate: -1, status: 1, employeeId: 1 });
module.exports = { AttendanceRecord: model('AttendanceRecord', AttendanceRecordSchema), ATTENDANCE_STATUSES, SEGMENT_TYPES };
