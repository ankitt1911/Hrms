'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const payroll = require('./payroll.service');
const recruitment = require('./recruitment.service');
const operations = require('./operations.service');
const { AppError, requireActor, success, asyncRoute } = require('./support');
const { requireSuperAdmin, requireRecruiter, requireEmployee } = require('../../common/middleware/access.middleware');
const { getStorageAdapter, LocalPrivateStorage } = require('./storage');
const { idempotency } = require('../../common/middleware/idempotency.middleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024), files: 1 } });
const uploadOne = (req, res, next) => upload.single('file')(req, res, (error) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return next(new AppError('FILE_TOO_LARGE', 413, 'Uploaded file is too large'));
  if (error) return next(new AppError('VALIDATION_ERROR', 400, error.message)); next();
});
const oid = z.string().regex(/^[0-9a-fA-F]{24}$/);
const text = (max = 1000) => z.string().trim().min(1).max(max);
const optionalText = (max = 1000) => z.string().trim().max(max).nullable().optional();
const money = z.union([z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().nonnegative()]).transform(String);
const validate = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse({ body: req.body, query: req.query, params: req.params });
  if (!parsed.success) return next(new AppError('VALIDATION_ERROR', 400, 'Request validation failed', parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))));
  if (parsed.data.body) req.body = parsed.data.body; if (parsed.data.query) req.validatedQuery = parsed.data.query; if (parsed.data.params) req.params = parsed.data.params; next();
};
const body = (shape) => validate(z.object({ body: z.object(shape).strict(), query: z.any(), params: z.any() }));
const params = validate(z.object({ params: z.object({ id: oid }), body: z.any(), query: z.any() }));

router.get('/storage/local/download', asyncRoute(async (req, res) => {
  const storage = getStorageAdapter(); if (!(storage instanceof LocalPrivateStorage)) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Local storage is not active');
  const verified = storage.verify({ encodedKey: req.query.key, expires: req.query.expires, signature: req.query.signature });
  if (!verified) throw new AppError('PERMISSION_DENIED', 403, 'Signed URL is invalid or expired'); return res.sendFile(verified.path);
}));

router.use(requireActor);

// Payroll and payslips: owner administration, recruiter self-service.
router.post('/payroll-periods', requireSuperAdmin, body({ periodMonth: z.coerce.number().int().min(1).max(12), periodYear: z.coerce.number().int().min(2000).max(2200), employeeIds: z.array(oid).min(1), formulaVersion: text(50).optional() }), asyncRoute(async (req, res) => success(req, res, await payroll.createPeriod(req.actor, req.body), 'Payroll period created', 201)));
router.get('/payroll-periods', requireSuperAdmin, asyncRoute(async (req, res) => success(req, res, await payroll.listPeriods(req.actor, req.query))));
router.post('/payroll-periods/:id/calculate', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await payroll.calculatePeriod(req.actor, req.params.id), 'Payroll calculated')));
router.get('/payroll-periods/:id', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await payroll.getPeriod(req.actor, req.params.id))));
router.patch('/payroll-lines/:id', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ extraDeductions: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,6})?$/.test(v)), reason: text(500) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await payroll.updateLine(req.actor, req.params.id, req.body), 'Payroll line overridden')));
router.post('/payroll-periods/:id/approve', requireSuperAdmin, params, idempotency(), asyncRoute(async (req, res) => success(req, res, await payroll.approvePeriod(req.actor, req.params.id), 'Payroll approved')));
router.post('/payroll-periods/:id/reopen', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ reason: text(500) }).strict(), query: z.any() })), idempotency(), asyncRoute(async (req, res) => success(req, res, await payroll.reopenPeriod(req.actor, req.params.id, req.body.reason), 'Payroll reopened')));
const payslipComponent = z.object({ label: text(100), amount: money }).strict();
router.patch('/payroll-lines/:id/breakdown', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({
  earnings: z.array(payslipComponent).max(20).optional(), deductionItems: z.array(payslipComponent).max(20).optional(),
  workedHours: z.union([z.string(), z.number()]).transform(String).refine((value) => /^\d+(\.\d{1,2})?$/.test(value)).optional(),
  reason: text(500),
}).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await payroll.updateLineBreakdown(req.actor, req.params.id, req.body), 'Payslip updated')));
router.post('/payroll-lines/:id/payslip', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await payroll.createPayslip(req.actor, req.params.id), 'Payslip generated', 201)));
router.post('/payslips/:id/approve', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await payroll.transitionPayslip(req.actor, req.params.id, 'DRAFT', 'APPROVED'), 'Payslip approved')));
router.post('/payslips/:id/publish', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await payroll.transitionPayslip(req.actor, req.params.id, 'APPROVED', 'PUBLISHED'), 'Payslip published')));
router.get('/payslips/me', requireEmployee, asyncRoute(async (req, res) => success(req, res, await payroll.ownPayslips(req.actor))));
router.get('/payslips/:id', params, asyncRoute(async (req, res) => success(req, res, await payroll.payslipView(req.actor, req.params.id))));
router.get('/payslips/:id/download', params, asyncRoute(async (req, res) => success(req, res, await payroll.downloadPayslip(req.actor, req.params.id))));

// Vendors and jobs.
const website = z.string().trim().max(500).url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Website must use http or https').nullable().optional();
const vendorInput = { name: text(200), website, agreementDate: z.coerce.date().nullable().optional(), location: optionalText(500), contactInfo: z.record(z.string(), z.unknown()).nullable().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), clauseDaysDefault: z.coerce.number().int().min(0).max(3650).optional() };
router.get('/vendors', requireSuperAdmin, asyncRoute(async (req, res) => success(req, res, await recruitment.listVendors(req.actor, req.query))));
router.post('/vendors', requireSuperAdmin, body(vendorInput), asyncRoute(async (req, res) => success(req, res, await recruitment.createVendor(req.actor, req.body), 'Vendor created', 201)));
router.get('/vendors/:id', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.getVendor(req.actor, req.params.id))));
router.patch('/vendors/:id', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object(Object.fromEntries(Object.entries(vendorInput).map(([key, schema]) => [key, schema.optional()]))).strict().refine((value) => Object.keys(value).length), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.updateVendor(req.actor, req.params.id, req.body), 'Vendor updated')));
router.get('/vendors/:id/documents', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await operations.listOwnerDocuments(req.actor, 'VENDOR', req.params.id))));
router.post('/vendors/:id/documents', requireSuperAdmin, params, uploadOne, asyncRoute(async (req, res) => success(req, res, await operations.uploadDocument(req.actor, { ownerType: 'VENDOR', ownerId: req.params.id, category: req.body.category || 'GENERAL', visibleToOwner: false }, req.file), 'Document uploaded', 201)));
const jobInput = {
  vendorId: oid.nullable().optional(), companyName: optionalText(200), title: text(200),
  process: z.enum(['VOICE', 'NON_VOICE']).nullable().optional(), skills: optionalText(2000), salaryRange: optionalText(200),
  monthlyCtc: money.nullable().optional(), takeHomeSalary: money.nullable().optional(), vendorPayment: money.nullable().optional(),
  clauseDays: z.coerce.number().int().min(0).max(3650).nullable().optional(), jobType: z.enum(['IT', 'NON_IT']).nullable().optional(), requirements: optionalText(5000),
  location: optionalText(200), qualification: optionalText(500), language: optionalText(100), openings: z.coerce.number().int().min(1).max(10000).optional(),
  description: optionalText(5000), status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'INACTIVE']).optional(),
  internalPaymentDetails: z.record(z.string(), z.unknown()).nullable().optional(), clauseDaysOverride: z.coerce.number().int().min(0).max(3650).nullable().optional(),
};
const jobCreate = z.object(jobInput).strict().refine((value) => value.vendorId || value.companyName, { path: ['companyName'], message: 'Select a saved vendor or enter a company name' });
router.get('/job-openings', asyncRoute(async (req, res) => success(req, res, await recruitment.listJobs(req.actor, req.query))));
router.post('/job-openings', requireSuperAdmin, validate(z.object({ body: jobCreate, query: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.createJob(req.actor, req.body), 'Job opening created', 201)));
router.get('/job-openings/:id', params, asyncRoute(async (req, res) => success(req, res, await recruitment.getJob(req.actor, req.params.id))));
router.patch('/job-openings/:id', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object(Object.fromEntries(Object.entries(jobInput).map(([key, schema]) => [key, schema.optional()]))).strict().refine((value) => Object.keys(value).length), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.updateJob(req.actor, req.params.id, req.body), 'Job opening updated')));
router.patch('/job-openings/:id/status', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'INACTIVE']) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.setJobStatus(req.actor, req.params.id, req.body.status), 'Job status updated')));
router.patch('/job-openings/:id/recruiters', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ recruiterEmployeeIds: z.array(oid).max(200) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.assignRecruiters(req.actor, req.params.id, req.body.recruiterEmployeeIds), 'Recruiters assigned')));

// Candidate CRM.
const candidateStages = ['NEW_LEAD', 'CALLED', 'RNR', 'INTERESTED', 'NOT_INTERESTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'JOINED', 'ON_HOLD'];
const languageValues = ['ENGLISH', 'KANNADA', 'HINDI', 'TAMIL', 'TELUGU', 'MALAYALAM', 'MARATHI', 'BENGALI', 'GUJARATI', 'URDU', 'OTHER'];
const candidateContact = z.object({ phone: z.string().trim().min(7).max(30), email: z.email().optional() }).strict();
const candidateInput = { jobOpeningId: oid, recruiterEmployeeId: oid.nullable().optional(), name: text(200), contact: candidateContact, candidateType: z.enum(['IT', 'NON_IT']), qualification: optionalText(500), languages: z.array(z.enum(languageValues)).min(1).max(languageValues.length).refine((values) => new Set(values).size === values.length, 'Languages must be unique'), otherLanguage: optionalText(100), location: optionalText(200), source: optionalText(200), remarks: optionalText(5000), consentGiven: z.literal(true), expectedDoj: z.coerce.date().nullable().optional() };
const candidateCreate = z.object(candidateInput).strict().superRefine((value, ctx) => { if (value.otherLanguage && !value.languages.includes('OTHER')) ctx.addIssue({ code: 'custom', path: ['otherLanguage'], message: 'Select Other before entering another language' }); });
const candidateBuckets = ['SUBMISSIONS', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'JOINED'];
const candidateList = z.object({ body: z.any(), params: z.any(), query: z.object({
  bucket: z.enum(candidateBuckets).optional(), stage: z.enum(candidateStages).optional(), jobOpeningId: oid.optional(),
  vendorId: oid.optional(), recruiterEmployeeId: oid.optional(), candidateType: z.enum(['IT', 'NON_IT']).optional(),
  interviewStatus: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
  dateField: z.enum(['interviewDate', 'doj']).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  search: z.string().trim().max(200).optional(), page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.from || value.to) && !value.dateField) ctx.addIssue({ code: 'custom', path: ['dateField'], message: 'dateField is required with a date range' });
  if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be on or after from' });
}) });
router.get('/crm/candidates', validate(candidateList), asyncRoute(async (req, res) => success(req, res, await recruitment.listCandidates(req.actor, req.validatedQuery))));
router.post('/crm/candidates', validate(z.object({ body: candidateCreate, query: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.createCandidate(req.actor, req.body), 'Candidate submitted', 201)));
router.get('/crm/candidates/:id', params, asyncRoute(async (req, res) => success(req, res, await recruitment.getCandidate(req.actor, req.params.id, { populate: true }))));
router.patch('/crm/candidates/:id', validate(z.object({ params: z.object({ id: oid }), body: z.object(Object.fromEntries(Object.entries(candidateInput).filter(([key]) => !['jobOpeningId', 'recruiterEmployeeId', 'consentGiven'].includes(key)).map(([key, schema]) => [key, schema.optional()]))).extend({ consentGiven: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.updateCandidate(req.actor, req.params.id, req.body), 'Candidate updated')));
router.patch('/crm/candidates/:id/recruiter', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ recruiterEmployeeId: oid.nullable() }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.reassignCandidate(req.actor, req.params.id, req.body.recruiterEmployeeId), 'Candidate recruiter updated')));
const futureDate = z.coerce.date().refine((value) => value.getTime() > Date.now(), 'Interview date and time must be in the future');
const stageTransition = z.object({ stage: z.enum(candidateStages), interviewDate: futureDate.optional(), expectedDoj: z.coerce.date().optional() }).strict().superRefine((value, ctx) => {
  if (value.stage === 'INTERVIEW_SCHEDULED' && !value.interviewDate) ctx.addIssue({ code: 'custom', path: ['interviewDate'], message: 'Interview date and time are required' });
  if (value.stage !== 'INTERVIEW_SCHEDULED' && value.interviewDate) ctx.addIssue({ code: 'custom', path: ['interviewDate'], message: 'Interview date is only accepted when scheduling an interview' });
  if (value.stage === 'SELECTED' && !value.expectedDoj) ctx.addIssue({ code: 'custom', path: ['expectedDoj'], message: 'Expected date of joining is required' });
  if (value.stage !== 'SELECTED' && value.expectedDoj) ctx.addIssue({ code: 'custom', path: ['expectedDoj'], message: 'Expected date of joining is only accepted when selecting a candidate' });
});
router.post('/crm/candidates/:id/stage', validate(z.object({ params: z.object({ id: oid }), body: stageTransition, query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.transitionCandidate(req.actor, req.params.id, req.body), 'Candidate stage updated')));
router.patch('/crm/candidates/:id/interview', validate(z.object({ params: z.object({ id: oid }), body: z.discriminatedUnion('action', [z.object({ action: z.literal('RESCHEDULE'), interviewDate: futureDate }).strict(), z.object({ action: z.literal('CANCEL') }).strict()]), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.updateInterview(req.actor, req.params.id, req.body), req.body.action === 'CANCEL' ? 'Interview cancelled' : 'Interview rescheduled')));
router.get('/crm/candidates/:id/history', params, asyncRoute(async (req, res) => success(req, res, await recruitment.candidateHistory(req.actor, req.params.id))));

// Candidate pool: the owner builds the master list and hands candidates to one
// recruiter at a time; the recruiter submits them against an assigned job.
const candidateProfileStatuses = ['NEW', 'ASSIGNED', 'SUBMITTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'JOINED', 'ON_HOLD'];
const candidateProfileInput = {
  name: text(200), contact: candidateContact, candidateType: z.enum(['IT', 'NON_IT']), qualification: optionalText(500),
  languages: z.array(z.enum(languageValues)).min(1).max(languageValues.length).refine((values) => new Set(values).size === values.length, 'Languages must be unique'),
  otherLanguage: optionalText(100), location: optionalText(200), source: optionalText(200),
  experienceYears: z.coerce.number().min(0).max(60).nullable().optional(), remarks: optionalText(5000),
};
const candidateProfileList = z.object({ body: z.any(), params: z.any(), query: z.object({
  status: z.enum(candidateProfileStatuses).optional(), candidateType: z.enum(['IT', 'NON_IT']).optional(),
  assignment: z.enum(['UNASSIGNED', 'ASSIGNED']).optional(), assignedRecruiterId: oid.optional(),
  search: z.string().trim().max(200).optional(), page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(),
}).strict() });
router.get('/crm/candidate-profiles', validate(candidateProfileList), asyncRoute(async (req, res) => success(req, res, await recruitment.listCandidateProfiles(req.actor, req.validatedQuery))));
router.post('/crm/candidate-profiles', requireSuperAdmin, validate(z.object({ body: z.object(candidateProfileInput).strict(), query: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.createCandidateProfile(req.actor, req.body), 'Candidate added', 201)));
router.post('/crm/candidate-profiles/assign', requireSuperAdmin, body({ candidateProfileIds: z.array(oid).min(1).max(200), recruiterEmployeeId: oid.nullable() }), asyncRoute(async (req, res) => success(req, res, await recruitment.assignCandidateProfiles(req.actor, req.body), 'Candidates assigned')));
router.get('/crm/candidate-profiles/:id', params, asyncRoute(async (req, res) => success(req, res, await recruitment.getCandidateProfile(req.actor, req.params.id))));
router.patch('/crm/candidate-profiles/:id', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object(Object.fromEntries(Object.entries(candidateProfileInput).map(([key, schema]) => [key, schema.optional()]))).strict().refine((value) => Object.keys(value).length), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.updateCandidateProfile(req.actor, req.params.id, req.body), 'Candidate updated')));
router.post('/crm/candidate-profiles/:id/submit', validate(z.object({ params: z.object({ id: oid }), body: z.object({ jobOpeningId: oid, remarks: optionalText(5000) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.submitCandidateProfile(req.actor, req.params.id, req.body), 'Candidate submitted', 201)));
const crmMonitoringQuery = z.object({
  employeeId: oid.optional(), preset: z.enum(['week', 'month', 'custom']).default('month'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.preset !== 'custom') return;
  if (!value.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date is required for a custom range' });
  if (!value.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is required for a custom range' });
  if (value.startDate && value.endDate && value.startDate > value.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date' });
});
router.get('/crm/monitoring', validate(z.object({ query: crmMonitoringQuery, body: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.crmMonitoring(req.actor, req.validatedQuery))));

// CRM business intelligence. Both roles may call these: the service self-scopes a
// recruiter to their own candidates on assigned jobs and omits owner-only
// sections (peer leaderboard, placement revenue). `/monitoring` above is unchanged.
const crmDateRange = {
  preset: z.enum(['today', 'week', 'month', 'quarter', 'custom']).default('month'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};
const crmSliceFilters = {
  employeeId: oid.optional(), jobOpeningId: oid.optional(), vendorId: oid.optional(),
  candidateType: z.enum(['IT', 'NON_IT']).optional(),
  source: z.string().trim().max(200).optional(), location: z.string().trim().max(200).optional(),
};
const requireCustomRange = (value, ctx) => {
  if (value.preset !== 'custom') return;
  if (!value.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date is required for a custom range' });
  if (!value.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is required for a custom range' });
  if (value.startDate && value.endDate && value.startDate > value.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date' });
};
const crmAnalyticsQuery = z.object({ ...crmDateRange, ...crmSliceFilters, granularity: z.enum(['day', 'week', 'month']).optional() }).strict().superRefine(requireCustomRange);
const crmDrilldownDimensions = ['ALL', 'STAGE', 'PIPELINE_STAGE', 'RECRUITER', 'JOB', 'VENDOR', 'SOURCE', 'CANDIDATE_TYPE', 'LOCATION', 'LANGUAGE', 'INVOICE_STATE'];
const crmDrilldownQuery = z.object({
  ...crmDateRange, ...crmSliceFilters,
  dimension: z.enum(crmDrilldownDimensions).default('ALL'), value: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(),
}).strict().superRefine((value, ctx) => {
  requireCustomRange(value, ctx);
  if (value.dimension !== 'ALL' && !value.value) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A drill-down value is required for this dimension' });
});
router.get('/crm/monitoring/analytics', validate(z.object({ query: crmAnalyticsQuery, body: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.crmAnalytics(req.actor, req.validatedQuery))));
router.get('/crm/monitoring/drilldown', validate(z.object({ query: crmDrilldownQuery, body: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.crmDrilldown(req.actor, req.validatedQuery))));

// Placement and invoice administration.
router.get('/placements', requireSuperAdmin, asyncRoute(async (req, res) => success(req, res, await recruitment.listPlacements(req.actor, req.query))));
router.get('/placements/:id', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.getPlacement(req.actor, req.params.id))));
router.patch('/placements/:id/joining', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ actualDoj: z.coerce.date() }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.updateJoining(req.actor, req.params.id, req.body.actualDoj), 'Joining verified')));
router.patch('/placements/:id/invoice-date-override', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ invoiceDueDate: z.coerce.date(), reason: text(500) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.overrideInvoiceDate(req.actor, req.params.id, req.body.invoiceDueDate, req.body.reason), 'Invoice date overridden')));
router.post('/placements/:id/invoice/generate', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.invoiceTransition(req.actor, req.params.id, ['DUE'], 'GENERATED'), 'Invoice generated')));
router.post('/placements/:id/invoice/ready', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.invoiceTransition(req.actor, req.params.id, ['GENERATED'], 'READY_TO_RAISE'), 'Invoice ready to raise')));
router.post('/placements/:id/invoice/raise', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ invoiceReference: text(200) }).strict(), query: z.any() })), idempotency(), asyncRoute(async (req, res) => success(req, res, await recruitment.invoiceTransition(req.actor, req.params.id, ['GENERATED', 'READY_TO_RAISE'], 'RAISED', req.body), 'Invoice raised')));
router.post('/placements/:id/invoice/reverse', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ reason: text(500) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.invoiceTransition(req.actor, req.params.id, 'RAISED', 'READY_TO_RAISE', req.body), 'Invoice reversed')));

// Editable invoice document: draft/preview never touch the database, save
// persists the record and moves the placement to GENERATED.
const invoiceLineItemsBody = z.object({ lineItems: z.array(z.object({ label: text(200), amount: z.coerce.number().nonnegative() }).strict()).min(1).max(25) }).strict();
router.get('/placements/:id/invoice/draft', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.invoiceDraft(req.actor, req.params.id))));
router.post('/placements/:id/invoice/preview', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: invoiceLineItemsBody, query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.previewInvoice(req.actor, req.params.id, req.body))));
router.post('/placements/:id/invoice/save', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: invoiceLineItemsBody, query: z.any() })), asyncRoute(async (req, res) => success(req, res, await recruitment.saveInvoice(req.actor, req.params.id, req.body), 'Invoice generated')));
router.get('/placements/:id/invoice/download', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.downloadInvoice(req.actor, req.params.id))));
router.post('/placements/:id/invoice/paid', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await recruitment.invoiceTransition(req.actor, req.params.id, 'RAISED', 'PAID'), 'Invoice marked paid')));

// Shared messages and notifications; monitoring remains owner-only.
router.get('/messages/partners', asyncRoute(async (req, res) => success(req, res, await operations.partners(req.actor))));
router.post('/messages/conversations', body({ partnerUserId: oid }), asyncRoute(async (req, res) => success(req, res, await operations.ensureConversation(req.actor, req.body.partnerUserId), 'Conversation ready', 201)));
router.get('/messages/conversations', asyncRoute(async (req, res) => success(req, res, await operations.conversations(req.actor))));
router.get('/messages/conversations/:id', params, asyncRoute(async (req, res) => success(req, res, await operations.thread(req.actor, req.params.id, req.query))));
router.post('/messages/conversations/:id/messages', validate(z.object({ params: z.object({ id: oid }), body: z.object({ body: text(5000) }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await operations.sendMessage(req.actor, req.params.id, req.body.body), 'Message sent', 201)));
router.post('/messages/conversations/:id/read', params, asyncRoute(async (req, res) => success(req, res, await operations.markRead(req.actor, req.params.id), 'Messages marked read')));
router.get('/admin/conversations', requireSuperAdmin, asyncRoute(async (req, res) => success(req, res, await operations.monitorConversations(req.actor, req.query))));
router.get('/notifications', asyncRoute(async (req, res) => success(req, res, await operations.notifications(req.actor, req.query))));
router.post('/notifications/read-all', asyncRoute(async (req, res) => success(req, res, await operations.readAll(req.actor), 'Notifications marked read')));
router.post('/notifications/:id/read', params, asyncRoute(async (req, res) => success(req, res, await operations.readNotification(req.actor, req.params.id), 'Notification marked read')));

// Recruiter self documents and owner document administration.
router.get('/employees/:id/documents', params, asyncRoute(async (req, res) => success(req, res, await operations.listOwnerDocuments(req.actor, 'EMPLOYEE', req.params.id))));
router.post('/employees/:id/documents', requireSuperAdmin, params, uploadOne, asyncRoute(async (req, res) => success(req, res, await operations.uploadDocument(req.actor, { ownerType: 'EMPLOYEE', ownerId: req.params.id, category: req.body.category || 'GENERAL', visibleToOwner: req.body.visibleToOwner === true || req.body.visibleToOwner === 'true' }, req.file), 'Document uploaded', 201)));
router.post('/documents', requireSuperAdmin, uploadOne, asyncRoute(async (req, res) => { const parsed = z.object({ ownerType: z.enum(['EMPLOYEE', 'VENDOR']), ownerId: oid, category: text(100), visibleToOwner: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).optional() }).safeParse(req.body); if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid document metadata', parsed.error.issues); return success(req, res, await operations.uploadDocument(req.actor, parsed.data, req.file), 'Document uploaded', 201); }));
router.get('/documents/:id', params, asyncRoute(async (req, res) => success(req, res, await operations.getDocument(req.actor, req.params.id))));
router.get('/documents/:id/download', params, asyncRoute(async (req, res) => success(req, res, await operations.downloadDocument(req.actor, req.params.id))));
router.delete('/documents/:id', requireSuperAdmin, params, asyncRoute(async (req, res) => success(req, res, await operations.deleteDocument(req.actor, req.params.id, req.body?.reason), 'Document deleted')));
router.patch('/documents/:id/scan-status', requireSuperAdmin, validate(z.object({ params: z.object({ id: oid }), body: z.object({ scanStatus: z.enum(['CLEAN', 'INFECTED', 'FAILED']), reason: text(500).optional() }).strict(), query: z.any() })), asyncRoute(async (req, res) => success(req, res, await operations.updateScanStatus(req.actor, req.params.id, req.body.scanStatus, req.body.reason), 'Document scan status updated')));

router.get('/audit-events', requireSuperAdmin, asyncRoute(async (req, res) => success(req, res, await operations.auditEvents(req.actor, req.query))));
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Shared by the overview and its drill-downs so a drill-down always reads the
// same window and scope as the figure it came from.
const reportScope = {
  preset: z.enum(['today', 'week', 'month', 'quarter', 'year', 'custom']).default('today'),
  startDate: dateKey.optional(),
  endDate: dateKey.optional(),
  department: text(120).optional(),
  employeeId: oid.optional(),
};
const dashboardQuery = z.object({
  ...reportScope,
  granularity: z.enum(['day', 'week', 'month']).optional(),
  exclude: text(120).optional(),
  attendancePage: z.coerce.number().int().min(1).optional(),
  attendanceLimit: z.coerce.number().int().min(1).max(100).optional(),
}).strict().superRefine(requireCustomRange);
const dashboardDrilldownQuery = z.object({
  ...reportScope,
  dimension: text(40),
  value: text(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict().superRefine(requireCustomRange);
router.get('/reports/dashboard/admin', requireSuperAdmin, validate(z.object({ query: dashboardQuery, body: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await operations.adminDashboard(req.actor, req.validatedQuery))));
router.get('/reports/dashboard/admin/live', requireSuperAdmin, asyncRoute(async (req, res) => success(req, res, await operations.liveWorkforce(req.actor))));
router.get('/reports/dashboard/admin/drilldown', requireSuperAdmin, validate(z.object({ query: dashboardDrilldownQuery, body: z.any(), params: z.any() })), asyncRoute(async (req, res) => success(req, res, await operations.workforceDrilldown(req.actor, req.validatedQuery))));
router.get('/reports/dashboard/recruiter', requireRecruiter, requireEmployee, asyncRoute(async (req, res) => success(req, res, await operations.recruiterDashboard(req.actor, req.query))));
router.post('/reports/export', requireSuperAdmin, body({ report: z.enum(['candidates', 'placements', 'payroll', 'audit']), startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional(), timezone: text(100).optional() }), asyncRoute(async (req, res) => success(req, res, await operations.exportReport(req.actor, req.body), 'Report exported')));

module.exports = router;
module.exports.router = router;
