'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const { SalaryComponentSchema } = require('../employees/employee.model');

const objectId = (ref, options = {}) => ({ type: Schema.Types.ObjectId, ref, ...options });
const tenant = { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true };
const timestamps = { timestamps: true };
const immutableTimestamps = { timestamps: { createdAt: true, updatedAt: false } };
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

const PayrollPeriodSchema = new Schema({
  companyId: tenant,
  periodMonth: { type: Number, required: true, min: 1, max: 12 },
  periodYear: { type: Number, required: true, min: 2000, max: 2200 },
  employeeIds: [objectId('Employee')],
  status: { type: String, enum: ['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'LOCKED', 'REOPENED'], default: 'DRAFT' },
  formulaVersion: { type: String, default: 'PAYROLL_V1' },
  approvedBy: objectId('User', { default: null }),
  approvedAt: { type: Date, default: null },
}, timestamps);
PayrollPeriodSchema.index({ companyId: 1, periodYear: 1, periodMonth: 1 }, { unique: true });

const PayrollLineSchema = new Schema({
  companyId: tenant,
  payrollPeriodId: objectId('PayrollPeriod', { required: true, index: true }),
  employeeId: objectId('Employee', { required: true, index: true }),
  workedHours: { type: Schema.Types.Decimal128, required: true },
  grossPay: { type: Schema.Types.Decimal128, required: true },
  basicPay: { type: Schema.Types.Decimal128, required: true },
  allowances: { type: Schema.Types.Decimal128, required: true },
  deductions: { type: Schema.Types.Decimal128, required: true },
  netPay: { type: Schema.Types.Decimal128, required: true },
  extraDeductions: { type: Schema.Types.Decimal128, default: '0.00' },
  // The named rows that produced grossPay / deductions, captured at calculation
  // time so a payslip reflects the structure in force for that period.
  earnings: { type: [SalaryComponentSchema], default: [] },
  deductionItems: { type: [SalaryComponentSchema], default: [] },
  itJoinings: { type: Number, default: 0 }, nonItJoinings: { type: Number, default: 0 },
  overrideReason: { type: String, default: null },
  overriddenBy: objectId('User', { default: null }),
  revision: { type: Number, default: 1 },
  revisionOf: objectId('PayrollLine', { default: null }),
  isCurrent: { type: Boolean, default: true },
}, immutableTimestamps);
PayrollLineSchema.index({ payrollPeriodId: 1, employeeId: 1, revision: 1 }, { unique: true });
PayrollLineSchema.index({ companyId: 1, payrollPeriodId: 1, isCurrent: 1 });

const PayslipSchema = new Schema({
  companyId: tenant,
  payrollLineId: objectId('PayrollLine', { required: true, unique: true }),
  employeeId: objectId('Employee', { required: true, index: true }),
  status: { type: String, enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'WITHDRAWN'], default: 'DRAFT' },
  approvedBy: objectId('User', { default: null }), approvedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
}, immutableTimestamps);

const VendorSchema = new Schema({
  companyId: tenant,
  name: { type: String, required: true, trim: true },
  website: { type: String, trim: true, default: null },
  agreementDate: { type: Date, default: null },
  location: { type: String, trim: true, default: null },
  contactInfo: { type: Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  clauseDaysDefault: { type: Number, min: 0, default: 45 },
  deletedAt: { type: Date, default: null },
}, timestamps);
VendorSchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

const JobOpeningSchema = new Schema({
  companyId: tenant,
  vendorId: objectId('Vendor', { default: null, index: true }),
  companyName: { type: String, trim: true, default: null },
  title: { type: String, required: true, trim: true },
  process: { type: String, enum: ['VOICE', 'NON_VOICE'], default: null },
  skills: { type: String, default: null },
  salaryRange: { type: String, default: null },
  monthlyCtc: { type: Schema.Types.Decimal128, default: null },
  takeHomeSalary: { type: Schema.Types.Decimal128, default: null },
  vendorPayment: { type: Schema.Types.Decimal128, default: null, select: false },
  clauseDays: { type: Number, min: 0, default: null },
  jobType: { type: String, enum: ['IT', 'NON_IT'], default: null },
  requirements: { type: String, default: null },
  location: { type: String, default: null },
  qualification: { type: String, default: null }, language: { type: String, default: null },
  openings: { type: Number, min: 1, default: 1 }, description: { type: String, default: null },
  status: { type: String, enum: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'INACTIVE'], default: 'DRAFT' },
  internalPaymentDetails: { type: Schema.Types.Mixed, default: null, select: false },
  assignedRecruiterIds: [objectId('Employee')],
  clauseDaysOverride: { type: Number, min: 0, default: null }, deletedAt: { type: Date, default: null },
}, timestamps);
JobOpeningSchema.pre('validate', function requireHiringCompany(next) {
  if (!this.vendorId && !this.companyName) this.invalidate('companyName', 'A saved vendor or company name is required');
  next();
});
JobOpeningSchema.index({ companyId: 1, status: 1, deletedAt: 1 });
JobOpeningSchema.index({ companyId: 1, assignedRecruiterIds: 1, status: 1 });

const stages = ['NEW_LEAD', 'CALLED', 'RNR', 'INTERESTED', 'NOT_INTERESTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'JOINED', 'ON_HOLD'];
const legacyStages = ['NEW', 'CONTACTED', 'INTERVIEWED', 'DID_NOT_JOIN'];
const spokenLanguages = ['ENGLISH', 'KANNADA', 'HINDI', 'TAMIL', 'TELUGU', 'MALAYALAM', 'MARATHI', 'BENGALI', 'GUJARATI', 'URDU', 'OTHER'];
const StageHistorySchema = new Schema({
  fromStage: { type: String, enum: [...stages, ...legacyStages], default: null }, toStage: { type: String, enum: [...stages, ...legacyStages], required: true },
  eventType: { type: String, enum: ['STAGE_TRANSITION', 'INTERVIEW_RESCHEDULED', 'INTERVIEW_CANCELLED'], default: 'STAGE_TRANSITION' },
  interviewDate: { type: Date, default: null }, recruiterEmployeeId: objectId('Employee', { default: null }), changedBy: objectId('User', { required: true }), changedAt: { type: Date, default: Date.now },
}, { _id: true });
const CandidateSchema = new Schema({
  companyId: tenant,
  jobOpeningId: objectId('JobOpening', { required: true, index: true }),
  candidateProfileId: objectId('CandidateProfile', { default: null, index: true }),
  recruiterEmployeeId: objectId('Employee', { default: null, index: true }),
  name: { type: String, required: true, trim: true }, contact: { type: Schema.Types.Mixed, required: true },
  candidateType: { type: String, enum: ['IT', 'NON_IT'], required: true },
  qualification: { type: String, default: null }, languages: [{ type: String, enum: spokenLanguages }],
  otherLanguage: { type: String, default: null }, language: { type: String, default: null },
  location: { type: String, default: null }, source: { type: String, default: null },
  remarks: { type: String, default: null }, consentGiven: { type: Boolean, default: false },
  stage: { type: String, enum: stages, default: 'NEW_LEAD' }, progressionRank: { type: Number, min: 0, max: 6, default: 0 }, stageHistory: [StageHistorySchema],
  interviewDate: { type: Date, default: null }, interviewStatus: { type: String, enum: ['SCHEDULED', 'CANCELLED'], default: null }, expectedDoj: { type: Date, default: null }, actualDoj: { type: Date, default: null },
}, { ...timestamps, optimisticConcurrency: true });
CandidateSchema.index({ companyId: 1, recruiterEmployeeId: 1, stage: 1 });
CandidateSchema.index({ companyId: 1, jobOpeningId: 1, stage: 1 });
CandidateSchema.index({ companyId: 1, stage: 1, updatedAt: -1 });
CandidateSchema.index({ companyId: 1, createdAt: 1, recruiterEmployeeId: 1 });
CandidateSchema.index({ companyId: 1, 'stageHistory.changedAt': 1 });

// The candidate pool the owner builds up before any job is chosen. A Candidate
// row above is one submission of a pool profile against one job opening;
// `status` here mirrors the stage of whichever submission is currently live.
const profileStatuses = ['NEW', 'ASSIGNED', 'SUBMITTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'JOINED', 'ON_HOLD'];
const CandidateProfileSchema = new Schema({
  companyId: tenant,
  name: { type: String, required: true, trim: true }, contact: { type: Schema.Types.Mixed, required: true },
  candidateType: { type: String, enum: ['IT', 'NON_IT'], required: true },
  qualification: { type: String, default: null }, languages: [{ type: String, enum: spokenLanguages }],
  otherLanguage: { type: String, default: null }, location: { type: String, default: null },
  source: { type: String, default: null }, experienceYears: { type: Number, min: 0, max: 60, default: null },
  remarks: { type: String, default: null },
  assignedRecruiterId: objectId('Employee', { default: null, index: true }),
  assignedAt: { type: Date, default: null }, assignedBy: objectId('User', { default: null }),
  status: { type: String, enum: profileStatuses, default: 'NEW' },
  activeSubmissionId: objectId('Candidate', { default: null }),
  lastSubmissionId: objectId('Candidate', { default: null }),
  submissionCount: { type: Number, default: 0 },
  deletedAt: { type: Date, default: null },
}, timestamps);
CandidateProfileSchema.index({ companyId: 1, assignedRecruiterId: 1, status: 1 });
CandidateProfileSchema.index({ companyId: 1, status: 1, updatedAt: -1 });
CandidateProfileSchema.index({ companyId: 1, 'contact.phone': 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

const invoiceStates = ['NOT_READY', 'FUTURE_DUE', 'DUE', 'GENERATED', 'READY_TO_RAISE', 'RAISED', 'PAID', 'CANCELLED'];
const PlacementSchema = new Schema({
  companyId: tenant,
  candidateId: objectId('Candidate', { required: true, unique: true }),
  jobOpeningId: objectId('JobOpening', { required: true }), vendorId: objectId('Vendor', { default: null }),
  companyName: { type: String, trim: true, default: null },
  actualDoj: { type: Date, default: null }, clauseDays: { type: Number, min: 0, required: true },
  invoiceDueDate: { type: Date, default: null }, dueDateOverridden: { type: Boolean, default: false },
  overrideReason: { type: String, default: null }, overriddenBy: objectId('User', { default: null }),
  invoiceState: { type: String, enum: invoiceStates, default: 'NOT_READY' },
  invoiceAmount: { type: Schema.Types.Decimal128, default: null }, invoiceReference: { type: String, default: null },
  raisedAt: { type: Date, default: null }, raisedBy: objectId('User', { default: null }),
  paidAt: { type: Date, default: null }, paidBy: objectId('User', { default: null }),
}, timestamps);
PlacementSchema.index({ companyId: 1, invoiceState: 1, invoiceDueDate: 1 });

const InvoiceSchema = new Schema({
  companyId: tenant,
  placementId: objectId('Placement', { required: true, unique: true }),
  candidateId: objectId('Candidate', { required: true }),
  invoiceNumber: { type: String, required: true, trim: true },
  issueDate: { type: Date, required: true }, dueDate: { type: Date, default: null },
  clientName: { type: String, trim: true, default: null },
  candidateName: { type: String, trim: true, default: null },
  jobTitle: { type: String, trim: true, default: null },
  lineItems: [{ _id: false, label: { type: String, required: true, trim: true }, amount: { type: Schema.Types.Decimal128, required: true } }],
  total: { type: Schema.Types.Decimal128, required: true },
  generatedAt: { type: Date, default: null }, generatedBy: objectId('User', { default: null }),
  generatedEarly: { type: Boolean, default: false },
}, timestamps);
InvoiceSchema.index({ companyId: 1, invoiceNumber: 1 }, { unique: true });

const ConversationSchema = new Schema({
  companyId: tenant,
  participantAId: objectId('User', { required: true }), participantBId: objectId('User', { required: true }),
  lastMessageAt: { type: Date, default: null },
}, immutableTimestamps);
ConversationSchema.index({ companyId: 1, participantAId: 1, participantBId: 1 }, { unique: true });
const MessageSchema = new Schema({
  companyId: tenant, conversationId: objectId('Conversation', { required: true, index: true }),
  senderId: objectId('User', { required: true }), body: { type: String, required: true, trim: true, maxlength: 5000 },
  sentAt: { type: Date, default: Date.now }, readAt: { type: Date, default: null },
}, { timestamps: false });
MessageSchema.index({ companyId: 1, conversationId: 1, sentAt: 1, _id: 1 });

const NotificationSchema = new Schema({
  companyId: tenant, recipientUserId: objectId('User', { required: true, index: true }),
  type: { type: String, required: true }, title: { type: String, required: true }, body: { type: String, default: null },
  linkEntityType: { type: String, default: null }, linkEntityId: { type: Schema.Types.ObjectId, default: null },
  readAt: { type: Date, default: null }, deliveryError: { type: String, default: null }, digestSentAt: { type: Date, default: null },
}, immutableTimestamps);
NotificationSchema.index({ companyId: 1, recipientUserId: 1, readAt: 1, createdAt: -1, _id: -1 });
NotificationSchema.index({ recipientUserId: 1, type: 1, linkEntityId: 1 }, { name: 'uniq_invoice_due_reminder', unique: true, partialFilterExpression: { type: 'INVOICE_DUE_REMINDER' } });
NotificationSchema.index({ recipientUserId: 1, type: 1, linkEntityId: 1 }, { name: 'uniq_payroll_pending_reminder', unique: true, partialFilterExpression: { type: 'PAYROLL_PENDING_REMINDER' } });

const DocumentAssetSchema = new Schema({
  companyId: tenant, ownerType: { type: String, enum: ['EMPLOYEE', 'VENDOR'], required: true },
  ownerId: { type: Schema.Types.ObjectId, required: true }, category: { type: String, required: true },
  objectKey: { type: String, required: true, unique: true }, originalName: { type: String, required: true },
  contentType: { type: String, required: true }, sizeBytes: { type: Number, required: true }, sha256: { type: String, required: true },
  scanStatus: { type: String, enum: ['PENDING', 'CLEAN', 'INFECTED', 'FAILED'], default: 'PENDING' },
  visibleToOwner: { type: Boolean, default: false }, uploadedBy: objectId('User', { required: true }),
  deletedAt: { type: Date, default: null },
}, immutableTimestamps);
DocumentAssetSchema.index({ companyId: 1, ownerType: 1, ownerId: 1, deletedAt: 1 });

const AuditEventSchema = new Schema({
  companyId: tenant, actorUserId: objectId('User', { required: true }), action: { type: String, required: true },
  entityType: { type: String, required: true }, entityId: { type: Schema.Types.ObjectId, required: true },
  before: { type: Schema.Types.Mixed, default: null }, after: { type: Schema.Types.Mixed, default: null },
  reason: { type: String, default: null }, requestId: { type: String, default: null }, ipHash: { type: String, default: null },
}, immutableTimestamps);
AuditEventSchema.index({ companyId: 1, createdAt: -1, _id: -1 });
AuditEventSchema.index({ companyId: 1, entityType: 1, entityId: 1, createdAt: -1 });

module.exports = {
  PayrollPeriod: model('PayrollPeriod', PayrollPeriodSchema), PayrollLine: model('PayrollLine', PayrollLineSchema),
  Payslip: model('Payslip', PayslipSchema), Vendor: model('Vendor', VendorSchema), JobOpening: model('JobOpening', JobOpeningSchema),
  Candidate: model('Candidate', CandidateSchema), CandidateProfile: model('CandidateProfile', CandidateProfileSchema), Placement: model('Placement', PlacementSchema), Invoice: model('Invoice', InvoiceSchema),
  Conversation: model('Conversation', ConversationSchema), Message: model('Message', MessageSchema),
  Notification: model('Notification', NotificationSchema), DocumentAsset: model('DocumentAsset', DocumentAssetSchema),
  AuditEvent: model('AuditEvent', AuditEventSchema), CANDIDATE_STAGES: stages, INVOICE_STATES: invoiceStates,
  CANDIDATE_PROFILE_STATUSES: profileStatuses, SPOKEN_LANGUAGES: spokenLanguages,
};
