const { Schema, model } = require('mongoose');
const LeaveTypeSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true }, name: { type: String, required: true, trim: true }, isPaid: { type: Boolean, default: true }, deletedAt: { type: Date, default: null },
}, { timestamps: true });
LeaveTypeSchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const LeaveRequestSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true }, employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true }, leaveTypeId: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true },
  startDate: { type: Date, required: true }, endDate: { type: Date, required: true }, reason: { type: String, default: null }, status: { type: String, enum: LEAVE_STATUSES, default: 'PENDING' },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, decisionNote: { type: String, default: null }, decidedAt: { type: Date, default: null }, attachmentDocumentId: { type: Schema.Types.ObjectId, ref: 'DocumentAsset', default: null },
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, cancelledAt: { type: Date, default: null }, cancellationReason: { type: String, default: null },
}, { timestamps: true });
LeaveRequestSchema.index({ employeeId: 1, status: 1 }); LeaveRequestSchema.index({ companyId: 1, status: 1, startDate: 1, endDate: 1, employeeId: 1 });
module.exports = { LeaveType: model('LeaveType', LeaveTypeSchema), LeaveRequest: model('LeaveRequest', LeaveRequestSchema), LEAVE_STATUSES };
