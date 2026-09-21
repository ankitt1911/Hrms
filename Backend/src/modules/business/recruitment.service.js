'use strict';

const mongoose = require('mongoose');
const { Vendor, JobOpening, Candidate, CandidateProfile, Placement, Invoice, Notification, AuditEvent, CANDIDATE_STAGES, INVOICE_STATES } = require('./models');
const { canTransitionCandidate, CRM_STAGE_RANK, CRM_MAIN_STAGES, CRM_TERMINAL_STAGES, addClauseDays, deriveInvoiceState, publicJob } = require('./rules');
const { AppError, objectId, page, model, assertTenantEntity, audit } = require('./support');
const { rollbackAndRethrow } = require('../../common/utils/compensatingWrites');
const { dashboardReportRange, addDateKeyDays } = require('./operations.service');
const { metric, daysBetweenKeys, autoGranularity, bucketKeyFor, bucketKeys, dayKeyExpr, companyTimeZone } = require('./analytics');
const { simplePdf } = require('./payroll.service');

async function listVendors(actor, query) { const { page: p, limit } = page(query); const filter = { companyId: actor.companyId, deletedAt: null }; if (query.status) filter.status = query.status; const [items, total] = await Promise.all([Vendor.find(filter).skip((p - 1) * limit).limit(limit).sort({ name: 1 }), Vendor.countDocuments(filter)]); return { items, page: p, limit, total }; }
async function createVendor(actor, input) { return Vendor.create({ companyId: actor.companyId, ...input }); }
async function getVendor(actor, id) { const query = Vendor.findOne({ _id: objectId(id), companyId: actor.companyId, deletedAt: null }); const vendor = await query; if (!vendor) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Vendor not found'); return vendor; }
async function updateVendor(actor, id, input) { const vendor = await Vendor.findOneAndUpdate({ _id: objectId(id), companyId: actor.companyId, deletedAt: null }, { $set: input }, { new: true, runValidators: true }); if (!vendor) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Vendor not found'); return vendor; }

const isOwner = (actor) => actor.role === 'SUPER_ADMIN';

async function listJobs(actor, query) {
  const admin = isOwner(actor);
  const { page: p, limit } = page(query); const filter = { companyId: actor.companyId, deletedAt: null };
  if (admin) filter.status = query.status || { $in: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'INACTIVE'] };
  else { if (!actor.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiter employee profile required'); filter.assignedRecruiterIds = actor.employeeId; if (query.status) filter.status = query.status; }
  let cursor = JobOpening.find(filter).populate('vendorId', 'name'); if (admin) cursor = cursor.select('+internalPaymentDetails +vendorPayment');
  const [rows, total] = await Promise.all([cursor.skip((p - 1) * limit).limit(limit).sort({ createdAt: -1 }), JobOpening.countDocuments(filter)]);
  return { items: admin ? rows : rows.map(publicJob), page: p, limit, total };
}
async function createJob(actor, input) {
  if (input.vendorId) await assertTenantEntity('Vendor', input.vendorId, actor.companyId, { status: 'ACTIVE' });
  if (!input.vendorId && !input.companyName) throw new AppError('VALIDATION_ERROR', 400, 'A saved vendor or company name is required');
  return JobOpening.create({ companyId: actor.companyId, ...input, vendorId: input.vendorId || null, companyName: input.vendorId ? null : input.companyName });
}
async function getJob(actor, id) { const admin = isOwner(actor); let query = JobOpening.findOne({ _id: objectId(id), companyId: actor.companyId, deletedAt: null, ...(admin ? {} : { assignedRecruiterIds: actor.employeeId }) }).populate('vendorId', 'name'); if (admin) query = query.select('+internalPaymentDetails +vendorPayment'); const job = await query; if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Job opening not found'); return admin ? job : publicJob(job); }
async function updateJob(actor, id, input) {
  const current = await JobOpening.findOne({ _id: objectId(id), companyId: actor.companyId, deletedAt: null });
  if (!current) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Job opening not found');
  if (input.vendorId) await assertTenantEntity('Vendor', input.vendorId, actor.companyId, { status: 'ACTIVE' });
  const vendorId = Object.prototype.hasOwnProperty.call(input, 'vendorId') ? input.vendorId : current.vendorId;
  const companyName = Object.prototype.hasOwnProperty.call(input, 'companyName') ? input.companyName : current.companyName;
  if (!vendorId && !companyName) throw new AppError('VALIDATION_ERROR', 400, 'A saved vendor or company name is required');
  const source = vendorId ? { vendorId, companyName: null } : { vendorId: null, companyName };
  return JobOpening.findOneAndUpdate({ _id: current._id, companyId: actor.companyId }, { $set: { ...input, ...source } }, { new: true, runValidators: true }).select('+internalPaymentDetails +vendorPayment').populate('vendorId', 'name');
}
async function setJobStatus(actor, id, status) {
  const job = await JobOpening.findOneAndUpdate({ _id: objectId(id), companyId: actor.companyId, deletedAt: null }, { $set: { status } }, { new: true, runValidators: true });
  if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Job opening not found');
  if (status === 'ACTIVE') {
    const Employee = model('Employee'); const recipients = await Employee.find({ _id: { $in: job.assignedRecruiterIds }, companyId: actor.companyId, employmentStatus: 'ACTIVE', deletedAt: null, userId: { $ne: null } }).select('userId').lean();
    if (recipients.length) await Notification.insertMany(recipients.map(({ userId }) => ({ companyId: actor.companyId, recipientUserId: userId, type: 'JOB_ACTIVATED', title: `Assigned job activated: ${job.title}`, linkEntityType: 'JobOpening', linkEntityId: job._id })), { ordered: false }).catch(() => null);
  }
  return job;
}

async function activeRecruiter(actor, recruiterEmployeeId) {
  const Employee = model('Employee'); const User = model('User');
  const employee = await Employee.findOne({ _id: objectId(String(recruiterEmployeeId), 'recruiterEmployeeId'), companyId: actor.companyId, employmentStatus: 'ACTIVE', deletedAt: null, userId: { $ne: null } });
  if (!employee) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 422, 'Active recruiter employee not found');
  const user = await User.findOne({ _id: employee.userId, companyId: actor.companyId, role: 'RECRUITER', status: 'ACTIVE', deletedAt: null });
  if (!user) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 422, 'Active recruiter account not found'); return employee;
}
async function assignedRecruiter(actor, recruiterEmployeeId, job) {
  const employee = await activeRecruiter(actor, recruiterEmployeeId);
  if (!job.assignedRecruiterIds.some((id) => String(id) === String(employee._id))) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 422, 'Recruiter is not assigned to this job');
  return employee;
}
async function assignRecruiters(actor, id, recruiterIds) {
  const job = await JobOpening.findOne({ _id: objectId(id), companyId: actor.companyId, deletedAt: null }).select('+internalPaymentDetails +vendorPayment');
  if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Job opening not found');
  const unique = [...new Set(recruiterIds.map(String))];
  const previous = new Set(job.assignedRecruiterIds.map(String)); const additions = unique.filter((idValue) => !previous.has(idValue));
  if (additions.length && job.status !== 'ACTIVE') throw new AppError('CONFLICT', 409, 'Recruiters can only be added to active jobs');
  for (const recruiterId of additions) await activeRecruiter(actor, recruiterId);
  const before = [...job.assignedRecruiterIds]; job.assignedRecruiterIds = unique; await job.save();
  await audit(actor, { action: 'JOB_RECRUITERS_ASSIGNED', entityType: 'JobOpening', entityId: job._id, before: { assignedRecruiterIds: before }, after: { assignedRecruiterIds: unique } }); return job;
}
async function recruiterJobIds(actor) { return JobOpening.find({ companyId: actor.companyId, assignedRecruiterIds: actor.employeeId, deletedAt: null }).distinct('_id'); }
async function candidateScope(actor) { if (isOwner(actor)) return { companyId: actor.companyId }; return { companyId: actor.companyId, recruiterEmployeeId: actor.employeeId, jobOpeningId: { $in: await recruiterJobIds(actor) } }; }
const CANDIDATE_BUCKET_STAGES = Object.freeze({
  SUBMISSIONS: ['NEW_LEAD', 'CALLED', 'RNR', 'INTERESTED', 'NOT_INTERESTED'],
  SHORTLISTED: ['SHORTLISTED'],
  INTERVIEW_SCHEDULED: ['INTERVIEW_SCHEDULED'],
  SELECTED: ['SELECTED'],
  REJECTED: ['REJECTED'],
  JOINED: ['JOINED'],
});
async function listCandidates(actor, query) {
  const { page: p, limit } = page(query); const filter = await candidateScope(actor); if (query.stage) filter.stage = query.stage;
  if (query.bucket) filter.stage = { $in: CANDIDATE_BUCKET_STAGES[query.bucket] };
  // Extra clauses go through $and so they compose with the recruiter scope and
  // the search $or instead of overwriting either.
  const extra = [];
  if (query.candidateType) filter.candidateType = query.candidateType;
  if (query.interviewStatus) filter.interviewStatus = query.interviewStatus;
  if (query.recruiterEmployeeId) {
    if (!isOwner(actor)) throw new AppError('PERMISSION_DENIED', 403, 'Recruiters cannot filter by another recruiter');
    filter.recruiterEmployeeId = objectId(query.recruiterEmployeeId, 'recruiterEmployeeId');
  }
  if (query.vendorId) {
    const vendorJobs = await JobOpening.find({ companyId: actor.companyId, vendorId: objectId(query.vendorId, 'vendorId'), deletedAt: null }).distinct('_id');
    extra.push({ jobOpeningId: { $in: vendorJobs } });
  }
  if (query.dateField && (query.from || query.to)) {
    const range = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
    if (query.dateField === 'interviewDate') {
      filter.interviewDate = range;
      // A cancelled interview is not a scheduled one, so it is excluded unless
      // the caller asks for that status explicitly.
      if (!query.interviewStatus) filter.interviewStatus = { $ne: 'CANCELLED' };
    } else {
      // A candidate lands on the day they actually joined, or on the day they are
      // still expected to, never on both.
      extra.push({ $or: [{ actualDoj: range }, { actualDoj: null, expectedDoj: range }] });
    }
  }
  if (query.jobOpeningId) {
    const requestedJob = objectId(query.jobOpeningId);
    if (!isOwner(actor) && !filter.jobOpeningId.$in.some((id) => String(id) === String(requestedJob))) throw new AppError('CRM_NOT_OWNER', 404, 'Job not assigned to recruiter');
    filter.jobOpeningId = requestedJob;
  }
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'i');
    const jobSearch = [{ title: expression }, { companyName: expression }];
    if (/^[0-9a-fA-F]{24}$/.test(query.search)) jobSearch.push({ _id: new mongoose.Types.ObjectId(query.search) });
    const jobs = await JobOpening.find({ companyId: actor.companyId, deletedAt: null, $or: jobSearch }).distinct('_id');
    filter.$or = [{ name: expression }, { 'contact.phone': expression }, { 'contact.email': expression }, { qualification: expression }, { location: expression }, { jobOpeningId: { $in: jobs } }];
  }
  if (extra.length) filter.$and = [...(filter.$and || []), ...extra];
  const populate = [{ path: 'jobOpeningId', select: 'title companyName vendorId jobType status assignedRecruiterIds', populate: { path: 'vendorId', select: 'name' } }, { path: 'recruiterEmployeeId', select: 'firstName lastName workEmail' }, { path: 'stageHistory.changedBy', select: 'displayName' }];
  const [items, total] = await Promise.all([Candidate.find(filter).populate(populate).sort({ updatedAt: -1 }).skip((p - 1) * limit).limit(limit), Candidate.countDocuments(filter)]); return { items, page: p, limit, total, pages: Math.ceil(total / limit) };
}
async function createCandidate(actor, input) {
  const job = await assertTenantEntity('JobOpening', input.jobOpeningId, actor.companyId, { status: 'ACTIVE' });
  let recruiterEmployeeId = input.recruiterEmployeeId || null;
  if (!isOwner(actor)) { if (Object.prototype.hasOwnProperty.call(input, 'recruiterEmployeeId')) throw new AppError('PERMISSION_DENIED', 403, 'Recruiters cannot choose candidate ownership'); await assignedRecruiter(actor, actor.employeeId, job); recruiterEmployeeId = actor.employeeId; }
  else if (recruiterEmployeeId) await assignedRecruiter(actor, recruiterEmployeeId, job);
  const safe = { ...input }; delete safe.recruiterEmployeeId;
  return Candidate.create({ companyId: actor.companyId, ...safe, recruiterEmployeeId, stage: 'NEW_LEAD', progressionRank: 0, stageHistory: [{ fromStage: null, toStage: 'NEW_LEAD', recruiterEmployeeId, changedBy: actor.userId }] });
}
// `populate` is opt-in and used only by the read route: the mutation paths below
// rely on raw ObjectIds (joinCandidate does JobOpening.findOne({ _id: current.jobOpeningId })),
// which a populated document would break.
async function getCandidate(actor, id, { populate = false } = {}) {
  let query = Candidate.findOne({ _id: objectId(id), ...await candidateScope(actor) });
  if (populate) {
    query = query
      .populate({ path: 'jobOpeningId', select: 'title companyName vendorId', populate: { path: 'vendorId', select: 'name' } })
      .populate('recruiterEmployeeId', 'firstName lastName workEmail')
      .populate('stageHistory.changedBy', 'displayName email');
  }
  const candidate = await query;
  if (!candidate) throw new AppError('CRM_NOT_OWNER', 404, 'Candidate not found or not accessible');
  return candidate;
}
async function updateCandidate(actor, id, input) { const current = await getCandidate(actor, id); const safe = Object.fromEntries(Object.entries(input).filter(([key]) => ['name', 'contact', 'candidateType', 'qualification', 'languages', 'otherLanguage', 'location', 'source', 'remarks', 'consentGiven', 'expectedDoj'].includes(key))); const languages = safe.languages || current.languages || []; if (safe.otherLanguage && !languages.includes('OTHER')) throw new AppError('VALIDATION_ERROR', 400, 'Select Other before entering another language'); if (safe.languages && !safe.languages.includes('OTHER')) safe.otherLanguage = null; return Candidate.findOneAndUpdate({ _id: current._id, companyId: actor.companyId }, { $set: safe }, { new: true, runValidators: true }); }
async function reassignCandidate(actor, id, recruiterEmployeeId) { const candidate = await Candidate.findOne({ _id: objectId(id), companyId: actor.companyId }); if (!candidate) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate not found'); const job = await JobOpening.findOne({ _id: candidate.jobOpeningId, companyId: actor.companyId, deletedAt: null }); if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate job not found'); if (recruiterEmployeeId) await assignedRecruiter(actor, recruiterEmployeeId, job); const before = candidate.recruiterEmployeeId; candidate.recruiterEmployeeId = recruiterEmployeeId || null; await candidate.save(); await audit(actor, { action: 'CANDIDATE_RECRUITER_CHANGED', entityType: 'Candidate', entityId: candidate._id, before: { recruiterEmployeeId: before }, after: { recruiterEmployeeId: candidate.recruiterEmployeeId } }); return candidate; }

// --- Candidate pool ------------------------------------------------------------
// The owner maintains a pool of candidate profiles and hands each one to a single
// recruiter, who submits it against one of their assigned job openings. A profile
// carries at most one live submission; the profile status mirrors that
// submission's stage so the owner reads progress without opening the pipeline.
const PROFILE_STATUS_BY_STAGE = Object.freeze({
  NEW_LEAD: 'SUBMITTED', CALLED: 'SUBMITTED', RNR: 'SUBMITTED', INTERESTED: 'SUBMITTED', NOT_INTERESTED: 'REJECTED',
  SHORTLISTED: 'SHORTLISTED', INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED', SELECTED: 'SELECTED', REJECTED: 'REJECTED', JOINED: 'JOINED', ON_HOLD: 'ON_HOLD',
});
// A candidate who fell out of a pipeline returns to the pool, so the recruiter can
// submit them somewhere else while the owner still sees why they came back.
const PROFILE_RELEASING_STAGES = ['NOT_INTERESTED', 'REJECTED'];
const PROFILE_EDITABLE_FIELDS = ['name', 'contact', 'candidateType', 'qualification', 'languages', 'otherLanguage', 'location', 'source', 'experienceYears', 'remarks'];

function profileScope(actor) {
  if (isOwner(actor)) return { companyId: actor.companyId, deletedAt: null };
  if (!actor.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiter employee profile required');
  return { companyId: actor.companyId, deletedAt: null, assignedRecruiterId: actor.employeeId };
}
// Best effort: a pipeline move must not fail because its pool mirror did.
async function syncCandidateProfile(actor, candidate) {
  const status = candidate?.candidateProfileId ? PROFILE_STATUS_BY_STAGE[candidate.stage] : null;
  if (!status) return candidate;
  const release = PROFILE_RELEASING_STAGES.includes(candidate.stage);
  await CandidateProfile.updateOne({ _id: candidate.candidateProfileId, companyId: actor.companyId }, { $set: { status, activeSubmissionId: release ? null : candidate._id } }).catch(() => null);
  return candidate;
}
async function assertUniquePhone(actor, phone, excludeId = null) {
  if (!phone) return;
  const filter = { companyId: actor.companyId, deletedAt: null, 'contact.phone': phone };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await CandidateProfile.exists(filter)) throw new AppError('CONFLICT', 409, 'A candidate with this phone number already exists');
}
async function listCandidateProfiles(actor, query) {
  const { page: p, limit } = page(query); const filter = profileScope(actor);
  if (query.status) filter.status = query.status;
  if (query.candidateType) filter.candidateType = query.candidateType;
  if (isOwner(actor)) {
    if (query.assignment === 'UNASSIGNED') filter.assignedRecruiterId = null;
    if (query.assignment === 'ASSIGNED') filter.assignedRecruiterId = { $ne: null };
    if (query.assignedRecruiterId) filter.assignedRecruiterId = objectId(query.assignedRecruiterId, 'assignedRecruiterId');
  } else if (query.assignedRecruiterId && String(query.assignedRecruiterId) !== String(actor.employeeId)) {
    throw new AppError('PERMISSION_DENIED', 403, 'Recruiters cannot filter by another recruiter');
  }
  if (query.search) {
    const expression = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: expression }, { 'contact.phone': expression }, { 'contact.email': expression }, { qualification: expression }, { location: expression }, { source: expression }];
  }
  const populate = [
    { path: 'assignedRecruiterId', select: 'firstName lastName workEmail' },
    { path: 'activeSubmissionId', select: 'stage jobOpeningId', populate: { path: 'jobOpeningId', select: 'title companyName' } },
  ];
  const [items, total] = await Promise.all([
    CandidateProfile.find(filter).populate(populate).sort({ updatedAt: -1 }).skip((p - 1) * limit).limit(limit),
    CandidateProfile.countDocuments(filter),
  ]);
  return { items, page: p, limit, total, pages: Math.ceil(total / limit) };
}
async function getCandidateProfile(actor, id) {
  const profile = await CandidateProfile.findOne({ _id: objectId(id), ...profileScope(actor) })
    .populate('assignedRecruiterId', 'firstName lastName workEmail')
    .populate({ path: 'activeSubmissionId', select: 'stage jobOpeningId', populate: { path: 'jobOpeningId', select: 'title companyName' } });
  if (!profile) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate not found or not accessible');
  return profile;
}
async function createCandidateProfile(actor, input) {
  await assertUniquePhone(actor, input.contact?.phone);
  const languages = input.languages || [];
  if (input.otherLanguage && !languages.includes('OTHER')) throw new AppError('VALIDATION_ERROR', 400, 'Select Other before entering another language');
  let profile;
  try {
    profile = await CandidateProfile.create({ companyId: actor.companyId, ...input, status: 'NEW' });
  } catch (error) {
    if (error?.code === 11000) throw new AppError('CONFLICT', 409, 'A candidate with this phone number already exists');
    throw error;
  }
  await audit(actor, { action: 'CANDIDATE_PROFILE_CREATED', entityType: 'CandidateProfile', entityId: profile._id, after: { name: profile.name, candidateType: profile.candidateType, status: profile.status } });
  return profile;
}
async function updateCandidateProfile(actor, id, input) {
  const current = await CandidateProfile.findOne({ _id: objectId(id), companyId: actor.companyId, deletedAt: null });
  if (!current) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate not found');
  const safe = Object.fromEntries(Object.entries(input).filter(([key]) => PROFILE_EDITABLE_FIELDS.includes(key)));
  if (safe.contact?.phone) await assertUniquePhone(actor, safe.contact.phone, current._id);
  const languages = safe.languages || current.languages || [];
  if (safe.otherLanguage && !languages.includes('OTHER')) throw new AppError('VALIDATION_ERROR', 400, 'Select Other before entering another language');
  if (safe.languages && !safe.languages.includes('OTHER')) safe.otherLanguage = null;
  return CandidateProfile.findOneAndUpdate({ _id: current._id, companyId: actor.companyId }, { $set: safe }, { new: true, runValidators: true });
}
async function assignCandidateProfiles(actor, { candidateProfileIds, recruiterEmployeeId }) {
  const ids = [...new Set(candidateProfileIds.map(String))].map((value) => objectId(value, 'candidateProfileIds'));
  const recruiter = recruiterEmployeeId ? await activeRecruiter(actor, recruiterEmployeeId) : null;
  const profiles = await CandidateProfile.find({ _id: { $in: ids }, companyId: actor.companyId, deletedAt: null }).select('_id name status assignedRecruiterId activeSubmissionId');
  if (profiles.length !== ids.length) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'One or more selected candidates were not found');
  // A candidate already in a pipeline hands over together with their live
  // submission, so the incoming recruiter must already be on that job.
  const live = profiles.filter((profile) => profile.activeSubmissionId);
  const submissions = live.length ? await Candidate.find({ _id: { $in: live.map((profile) => profile.activeSubmissionId) }, companyId: actor.companyId }).select('_id name jobOpeningId') : [];
  if (recruiter) {
    for (const submission of submissions) {
      const job = await JobOpening.findOne({ _id: submission.jobOpeningId, companyId: actor.companyId, deletedAt: null }).select('title assignedRecruiterIds');
      if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, `The job opening ${submission.name} was submitted to no longer exists`);
      if (!job.assignedRecruiterIds.some((id) => String(id) === String(recruiter._id))) throw new AppError('CONFLICT', 409, `Assign this recruiter to the job "${job.title}" before moving ${submission.name}, who is already submitted to it`);
    }
  }
  const before = profiles.map((profile) => ({ _id: profile._id, assignedRecruiterId: profile.assignedRecruiterId, status: profile.status }));
  const ownership = { assignedRecruiterId: recruiter?._id || null, assignedAt: recruiter ? new Date() : null, assignedBy: recruiter ? actor.userId : null };
  const pooled = profiles.filter((profile) => !profile.activeSubmissionId).map((profile) => profile._id);
  // Only a candidate with no live submission gets their status reset; the rest
  // keep the status mirroring whatever stage their submission is at.
  if (pooled.length) await CandidateProfile.updateMany({ _id: { $in: pooled }, companyId: actor.companyId }, { $set: { ...ownership, status: recruiter ? 'ASSIGNED' : 'NEW' } });
  if (live.length) await CandidateProfile.updateMany({ _id: { $in: live.map((profile) => profile._id) }, companyId: actor.companyId }, { $set: ownership });
  if (submissions.length) await Candidate.updateMany({ _id: { $in: submissions.map((submission) => submission._id) }, companyId: actor.companyId }, { $set: { recruiterEmployeeId: recruiter?._id || null } });
  if (recruiter?.userId) {
    await Notification.insertMany(profiles.map((profile) => ({
      companyId: actor.companyId, recipientUserId: recruiter.userId, type: 'CANDIDATE_ASSIGNED',
      title: `Candidate assigned: ${profile.name}`, linkEntityType: 'CandidateProfile', linkEntityId: profile._id,
    })), { ordered: false }).catch(() => null);
  }
  await audit(actor, { action: 'CANDIDATE_PROFILES_ASSIGNED', entityType: 'CandidateProfile', entityId: profiles[0]._id, before: { profiles: before }, after: { assignedRecruiterId: recruiter?._id || null, count: profiles.length, submissionsMoved: submissions.map((submission) => submission._id) } });
  return { assigned: profiles.length, submissionsMoved: submissions.length, recruiterEmployeeId: recruiter?._id || null };
}
async function submitCandidateProfile(actor, id, input) {
  const profile = await CandidateProfile.findOne({ _id: objectId(id), ...profileScope(actor) });
  if (!profile) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate not found or not assigned to you');
  if (profile.activeSubmissionId) throw new AppError('CONFLICT', 409, 'This candidate is already submitted to a job opening');
  if (!profile.assignedRecruiterId) throw new AppError('CONFLICT', 409, 'Assign this candidate to a recruiter before submitting');
  const recruiterEmployeeId = profile.assignedRecruiterId;
  const job = await assertTenantEntity('JobOpening', input.jobOpeningId, actor.companyId, { status: 'ACTIVE' });
  await assignedRecruiter(actor, recruiterEmployeeId, job);
  const candidateId = new mongoose.Types.ObjectId();
  const cleanups = [() => Candidate.deleteOne({ _id: candidateId, companyId: actor.companyId })];
  try {
    const candidate = await Candidate.create({
      _id: candidateId, companyId: actor.companyId, candidateProfileId: profile._id, jobOpeningId: job._id, recruiterEmployeeId,
      name: profile.name, contact: profile.contact, candidateType: profile.candidateType, qualification: profile.qualification,
      languages: profile.languages, otherLanguage: profile.otherLanguage, location: profile.location,
      source: profile.source || 'CANDIDATE_POOL', remarks: input.remarks ?? profile.remarks, consentGiven: true,
      stage: 'NEW_LEAD', progressionRank: 0, stageHistory: [{ fromStage: null, toStage: 'NEW_LEAD', recruiterEmployeeId, changedBy: actor.userId }],
    });
    // Claiming the profile is conditional on it still being free, so two
    // simultaneous submissions cannot both attach to the same candidate.
    const claimed = await CandidateProfile.findOneAndUpdate({ _id: profile._id, companyId: actor.companyId, activeSubmissionId: null }, {
      $set: { activeSubmissionId: candidate._id, lastSubmissionId: candidate._id, status: 'SUBMITTED' }, $inc: { submissionCount: 1 },
    }, { new: true });
    if (!claimed) throw new AppError('CONFLICT', 409, 'This candidate was just submitted elsewhere; reload and retry');
    await audit(actor, { action: 'CANDIDATE_PROFILE_SUBMITTED', entityType: 'CandidateProfile', entityId: profile._id, before: { status: profile.status }, after: { status: 'SUBMITTED', candidateId: candidate._id, jobOpeningId: job._id } });
    return candidate;
  } catch (error) { return rollbackAndRethrow(error, cleanups); }
}

async function joinCandidate(actor, current, progressionRank) {
  const job = await JobOpening.findOne({ _id: current.jobOpeningId, companyId: actor.companyId, deletedAt: null }).select('+vendorPayment');
  if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate job not found');
  const vendor = job.vendorId ? await Vendor.findOne({ _id: job.vendorId, companyId: actor.companyId, deletedAt: null }) : null;
  if (job.vendorId && !vendor) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate vendor not found');
  const Company = model('Company'); const company = await Company.findById(actor.companyId).select('settings.invoiceClauseDaysDefault');
  const clauseDays = job.clauseDays ?? job.clauseDaysOverride ?? vendor?.clauseDaysDefault ?? company?.settings?.invoiceClauseDaysDefault ?? 45;
  const joinedAt = new Date(); const invoiceDueDate = addClauseDays(joinedAt, clauseDays); const existing = await Placement.findOne({ companyId: actor.companyId, candidateId: current._id });
  const placementId = existing?._id || new mongoose.Types.ObjectId(); const historyId = new mongoose.Types.ObjectId(); const auditId = new mongoose.Types.ObjectId();
  const invoiceState = deriveInvoiceState({ actualDoj: joinedAt, invoiceDueDate, invoiceState: existing?.invoiceState || 'NOT_READY' });
  const placementBefore = existing?.toObject();
  const restorePlacement = existing ? () => Placement.updateOne({ _id: placementId, companyId: actor.companyId, actualDoj: joinedAt }, { $set: { actualDoj: placementBefore.actualDoj || null, invoiceDueDate: placementBefore.invoiceDueDate || null, invoiceState: placementBefore.invoiceState, invoiceAmount: placementBefore.invoiceAmount || null, jobOpeningId: placementBefore.jobOpeningId, vendorId: placementBefore.vendorId || null, companyName: placementBefore.companyName || null, clauseDays: placementBefore.clauseDays } }) : () => Placement.deleteOne({ _id: placementId, companyId: actor.companyId });
  const cleanups = [restorePlacement, () => Candidate.updateOne({ _id: current._id, companyId: actor.companyId, stage: 'JOINED', 'stageHistory._id': historyId }, { $set: { stage: current.stage, progressionRank: current.progressionRank, actualDoj: current.actualDoj || null }, $pull: { stageHistory: { _id: historyId } } }), () => AuditEvent.deleteOne({ _id: auditId })];
  try {
    const placement = await Placement.findOneAndUpdate(existing ? { _id: placementId, companyId: actor.companyId, actualDoj: existing.actualDoj } : { companyId: actor.companyId, candidateId: current._id }, { $set: { jobOpeningId: job._id, vendorId: vendor?._id || null, companyName: vendor?.name || job.companyName || null, clauseDays, actualDoj: joinedAt, invoiceDueDate, invoiceState, invoiceAmount: job.vendorPayment || null }, $setOnInsert: { _id: placementId, companyId: actor.companyId, candidateId: current._id } }, { upsert: !existing, new: true, runValidators: true });
    if (!placement) throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, 'Placement changed concurrently; reload and retry');
    const updated = await Candidate.findOneAndUpdate({ _id: current._id, companyId: actor.companyId, stage: current.stage, progressionRank: current.progressionRank }, { $set: { stage: 'JOINED', progressionRank, actualDoj: joinedAt }, $push: { stageHistory: { _id: historyId, fromStage: current.stage, toStage: 'JOINED', recruiterEmployeeId: current.recruiterEmployeeId, changedBy: actor.userId, changedAt: joinedAt } } }, { new: true, runValidators: true });
    if (!updated) throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, 'Candidate changed concurrently; reload and retry');
    await audit(actor, { _id: auditId, action: 'CRM_JOINED', entityType: 'Candidate', entityId: current._id, before: { stage: current.stage, actualDoj: current.actualDoj }, after: { stage: 'JOINED', actualDoj: joinedAt, placementId, invoiceAmount: job.vendorPayment || null } });
    return updated;
  } catch (error) { return rollbackAndRethrow(error, cleanups); }
}

async function transitionCandidate(actor, id, input) {
  const { stage: toStage, interviewDate = null, expectedDoj = null } = typeof input === 'string' ? { stage: input } : input;
  const current = await getCandidate(actor, id);
  if (!current) throw new AppError('CRM_NOT_OWNER', 404, 'Candidate not found or not owned by actor');
  if (!canTransitionCandidate(current.stage, toStage, current.progressionRank)) throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, `Cannot transition ${current.stage} to ${toStage}`);
  const progressionRank = CRM_STAGE_RANK[toStage] == null ? current.progressionRank : Math.max(current.progressionRank, CRM_STAGE_RANK[toStage]);
  if (toStage === 'JOINED') return syncCandidateProfile(actor, await joinCandidate(actor, current, progressionRank));
  if (toStage !== 'SELECTED') {
    if (toStage === 'INTERVIEW_SCHEDULED' && !interviewDate) throw new AppError('VALIDATION_ERROR', 400, 'Interview date and time are required');
    const schedule = toStage === 'INTERVIEW_SCHEDULED' ? { interviewDate, interviewStatus: 'SCHEDULED' } : {};
    const history = { fromStage: current.stage, toStage, recruiterEmployeeId: current.recruiterEmployeeId, changedBy: actor.userId, changedAt: new Date(), ...(interviewDate ? { interviewDate } : {}) };
    const updated = await Candidate.findOneAndUpdate({ _id: current._id, companyId: actor.companyId, stage: current.stage, progressionRank: current.progressionRank }, { $set: { stage: toStage, progressionRank, ...schedule }, $push: { stageHistory: history } }, { new: true, runValidators: true });
    if (!updated) throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, 'Candidate changed concurrently; reload and retry'); return syncCandidateProfile(actor, updated);
  }
  if (!expectedDoj) throw new AppError('VALIDATION_ERROR', 400, 'Expected date of joining is required');
  const job = await JobOpening.findOne({ _id: current.jobOpeningId, companyId: actor.companyId, deletedAt: null }).select('+vendorPayment'); if (!job) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate job not found');
  const vendor = job.vendorId ? await Vendor.findOne({ _id: job.vendorId, companyId: actor.companyId, deletedAt: null }) : null;
  if (job.vendorId && !vendor) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Candidate vendor not found');
  const Company = model('Company'); const company = await Company.findById(actor.companyId).select('settings.invoiceClauseDaysDefault');
  const clauseDays = job.clauseDays ?? job.clauseDaysOverride ?? vendor?.clauseDaysDefault ?? company?.settings?.invoiceClauseDaysDefault ?? 45;
  const placementId = new mongoose.Types.ObjectId();
  const historyId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId();
  const cleanups = [
    () => Placement.deleteOne({ _id: placementId }),
    () => Candidate.updateOne({ _id: current._id, companyId: actor.companyId, stage: 'SELECTED', 'stageHistory._id': historyId }, { $set: { stage: current.stage, progressionRank: current.progressionRank, expectedDoj: current.expectedDoj || null }, $pull: { stageHistory: { _id: historyId } } }),
    () => AuditEvent.deleteOne({ _id: auditId }),
  ];
  try {
    await Placement.findOneAndUpdate({ companyId: actor.companyId, candidateId: current._id }, { $setOnInsert: { _id: placementId, companyId: actor.companyId, candidateId: current._id, jobOpeningId: job._id, vendorId: vendor?._id || null, companyName: vendor?.name || job.companyName || null, clauseDays, actualDoj: current.actualDoj || null, invoiceDueDate: current.actualDoj ? addClauseDays(current.actualDoj, clauseDays) : null, invoiceState: current.actualDoj ? deriveInvoiceState({ actualDoj: current.actualDoj, invoiceDueDate: addClauseDays(current.actualDoj, clauseDays) }) : 'NOT_READY', invoiceAmount: job.vendorPayment || null } }, { upsert: true, new: true });
    const updated = await Candidate.findOneAndUpdate({ _id: current._id, companyId: actor.companyId, stage: current.stage, progressionRank: current.progressionRank }, { $set: { stage: 'SELECTED', progressionRank, expectedDoj }, $push: { stageHistory: { _id: historyId, fromStage: current.stage, toStage: 'SELECTED', recruiterEmployeeId: current.recruiterEmployeeId, changedBy: actor.userId, changedAt: new Date() } } }, { new: true, runValidators: true });
    if (!updated) throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, 'Candidate changed concurrently; reload and retry');
    await audit(actor, { _id: auditId, action: 'CRM_SELECTED', entityType: 'Candidate', entityId: current._id, before: { stage: current.stage, expectedDoj: current.expectedDoj }, after: { stage: 'SELECTED', expectedDoj } });
    return syncCandidateProfile(actor, updated);
  } catch (error) {
    return rollbackAndRethrow(error, cleanups);
  }
}
async function updateInterview(actor, id, input) {
  const current = await getCandidate(actor, id);
  if (current.stage !== 'INTERVIEW_SCHEDULED') throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, 'Interview can only be changed at the Interview Scheduled stage');
  if (input.action === 'CANCEL' && current.interviewStatus === 'CANCELLED') throw new AppError('CRM_INTERVIEW_ALREADY_CANCELLED', 409, 'Interview is already cancelled');
  const eventType = input.action === 'CANCEL' ? 'INTERVIEW_CANCELLED' : 'INTERVIEW_RESCHEDULED';
  const nextDate = input.action === 'CANCEL' ? null : input.interviewDate;
  const historyDate = input.action === 'CANCEL' ? current.interviewDate : input.interviewDate;
  const updated = await Candidate.findOneAndUpdate({ _id: current._id, companyId: actor.companyId, stage: 'INTERVIEW_SCHEDULED', interviewStatus: current.interviewStatus, interviewDate: current.interviewDate }, { $set: { interviewDate: nextDate, interviewStatus: input.action === 'CANCEL' ? 'CANCELLED' : 'SCHEDULED' }, $push: { stageHistory: { fromStage: 'INTERVIEW_SCHEDULED', toStage: 'INTERVIEW_SCHEDULED', eventType, interviewDate: historyDate, recruiterEmployeeId: current.recruiterEmployeeId, changedBy: actor.userId, changedAt: new Date() } } }, { new: true, runValidators: true });
  if (!updated) throw new AppError('CRM_INVALID_STAGE_TRANSITION', 409, 'Interview schedule changed concurrently; reload and retry');
  await audit(actor, { action: eventType, entityType: 'Candidate', entityId: current._id, before: { interviewDate: current.interviewDate, interviewStatus: current.interviewStatus }, after: { interviewDate: updated.interviewDate, interviewStatus: updated.interviewStatus } });
  return updated;
}
async function candidateHistory(actor, id) { return (await getCandidate(actor, id)).stageHistory; }
// --- CRM monitoring, analytics and drill-down ---------------------------------
// `crmEventCounts` and everything below share one definition of "a CRM activity
// event": a STAGE_TRANSITION entry in `Candidate.stageHistory`, attributed to a
// recruiter, whose `changedAt` falls inside the reporting range. Interview
// reschedules and cancellations are deliberately excluded so counts stay
// comparable with the recruiter-facing monitor.
const CRM_EVENT_TYPES = ['STAGE_TRANSITION', null];
const CRM_SNAPSHOT_DIMENSIONS = ['PIPELINE_STAGE', 'INVOICE_STATE'];

function crmEventStages(range, employeeId, extra = []) {
  const changedAt = { $gte: range.startInstant, $lt: range.endExclusive };
  const recruiter = employeeId ? objectId(String(employeeId), 'employeeId') : { $ne: null };
  const element = { changedAt, recruiterEmployeeId: recruiter, eventType: { $in: CRM_EVENT_TYPES } };
  return [
    { $match: { stageHistory: { $elemMatch: element } } },
    { $unwind: '$stageHistory' },
    { $match: { 'stageHistory.changedAt': changedAt, 'stageHistory.recruiterEmployeeId': recruiter, 'stageHistory.eventType': element.eventType, 'stageHistory.toStage': { $in: CANDIDATE_STAGES } } },
    ...extra,
  ];
}

const zeroFilledStages = (rows, key = '_id') => Object.fromEntries(CANDIDATE_STAGES.map((stage) => [stage, rows.find((row) => row[key] === stage)?.count || 0]));

async function crmEventCounts(match, range, employeeId) {
  const rows = await Candidate.aggregate([
    { $match: match },
    ...crmEventStages(range, employeeId),
    { $group: { _id: '$stageHistory.toStage', count: { $sum: 1 } } },
  ]);
  return zeroFilledStages(rows);
}

// Candidate-level filters shared by the analytics payload and every drill-down,
// so a drill-down opened from a filtered chart stays inside that same slice.
async function crmFilterMatch(companyId, query = {}) {
  const match = {};
  if (query.jobOpeningId) match.jobOpeningId = objectId(String(query.jobOpeningId), 'jobOpeningId');
  else if (query.vendorId) match.jobOpeningId = { $in: await JobOpening.find({ companyId, vendorId: objectId(String(query.vendorId), 'vendorId'), deletedAt: null }).distinct('_id') };
  if (query.candidateType) match.candidateType = query.candidateType;
  if (query.source) match.source = query.source;
  if (query.location) match.location = query.location;
  return match;
}

// Active recruiters plus anyone historically attributed on a stage event, so a
// former recruiter's numbers never silently vanish from a past period.
async function recruiterOptions(companyId) {
  const Employee = model('Employee'); const User = model('User');
  const [activeUserIds, historicalIds] = await Promise.all([
    User.find({ companyId, role: 'RECRUITER', status: 'ACTIVE', deletedAt: null }).distinct('_id'),
    Candidate.distinct('stageHistory.recruiterEmployeeId', { companyId }),
  ]);
  const attributedHistoricalIds = historicalIds.filter(Boolean);
  const [activeEmployees, historicalEmployees] = await Promise.all([
    Employee.find({ companyId, userId: { $in: activeUserIds }, employmentStatus: 'ACTIVE', deletedAt: null }).select('_id firstName lastName workEmail').lean(),
    attributedHistoricalIds.length ? Employee.find({ companyId, _id: { $in: attributedHistoricalIds } }).select('_id firstName lastName workEmail employmentStatus deletedAt').lean() : [],
  ]);
  const activeIds = new Set(activeEmployees.map((employee) => String(employee._id)));
  const optionsById = new Map();
  for (const employee of [...activeEmployees, ...historicalEmployees]) optionsById.set(String(employee._id), { employeeId: employee._id, name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.workEmail || 'Former recruiter', status: activeIds.has(String(employee._id)) ? 'ACTIVE' : 'FORMER' });
  return { optionsById, options: [...optionsById.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

async function crmMonitoring(actor, query = {}, now = new Date()) {
  const companyId = objectId(String(actor.companyId));
  if (!isOwner(actor) && query.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiters cannot view another employee CRM report');
  if (!isOwner(actor) && !actor.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiter employee profile required');
  const timeZone = await companyTimeZone(companyId);
  const { optionsById, options: employeeOptions } = await recruiterOptions(companyId);
  let selectedEmployeeId = isOwner(actor) ? query.employeeId || null : String(actor.employeeId);
  if (selectedEmployeeId && !optionsById.has(String(selectedEmployeeId))) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'CRM employee was not found in this company');
  selectedEmployeeId = selectedEmployeeId ? objectId(String(selectedEmployeeId), 'employeeId') : null;
  const todayRange = dashboardReportRange({ preset: 'today' }, timeZone, now); const periodRange = dashboardReportRange({ ...query, preset: query.preset || 'month' }, timeZone, now);
  const [todayCounts, periodCounts] = await Promise.all([crmEventCounts({ companyId }, todayRange, selectedEmployeeId), crmEventCounts({ companyId }, periodRange, selectedEmployeeId)]);
  const selected = selectedEmployeeId ? optionsById.get(String(selectedEmployeeId)) : null;
  const publicRange = (range) => ({ preset: range.preset, startDate: range.startDate, endDate: range.endDate, timezone: timeZone });
  return { today: { range: publicRange(todayRange), counts: todayCounts }, period: { range: publicRange(periodRange), counts: periodCounts }, scope: selected ? { type: 'EMPLOYEE', ...selected } : { type: 'ALL', name: 'All recruiters' }, employeeOptions: isOwner(actor) ? employeeOptions : [] };
}

// --- Analytics ---------------------------------------------------------------
const KPI_STAGE = { submissions: 'NEW_LEAD', interviews: 'INTERVIEW_SCHEDULED', selected: 'SELECTED', joined: 'JOINED', rejected: 'REJECTED' };
const toNumber = (value) => (value == null ? 0 : Number(value.toString()));
// Grouping by calendar day in the company timezone (rather than $dateTrunc) keeps
// this working on older MongoDB servers; week/month roll-up happens in memory.
async function crmDailyEvents(match, range, employeeId, timeZone) {
  return Candidate.aggregate([
    { $match: match },
    ...crmEventStages(range, employeeId),
    { $group: { _id: { day: dayKeyExpr('$stageHistory.changedAt', timeZone), stage: '$stageHistory.toStage' }, count: { $sum: 1 } } },
  ]);
}

function buildTimeseries(rows, range, granularity) {
  const stages = Object.values(KPI_STAGE);
  const empty = () => Object.fromEntries(stages.map((stage) => [stage, 0]));
  const buckets = new Map(bucketKeys(range, granularity).map((bucket) => [bucket, { bucket, total: 0, ...empty() }]));
  for (const row of rows) {
    const target = buckets.get(bucketKeyFor(row._id.day, granularity));
    if (!target) continue;
    target.total += row.count;
    if (stages.includes(row._id.stage)) target[row._id.stage] += row.count;
  }
  return [...buckets.values()];
}

// A cohort funnel: the population is the candidates SUBMITTED in this period,
// and each step counts how many of them ever got at least that far. Counting
// "reached stage X during the period" instead would let a candidate submitted
// last month inflate a later step above the one before it, which is how a
// funnel ends up wider at the bottom than the top. Using the progressionRank
// high-water mark also keeps the funnel monotone when a recruiter legitimately
// skips a stage — stage transitions here are forward-only but not contiguous.
async function crmFunnel(match, range, employeeId) {
  const cohort = await Candidate.aggregate([
    { $match: match },
    ...crmEventStages(range, employeeId, [{ $match: { 'stageHistory.toStage': 'NEW_LEAD' } }]),
    { $group: { _id: '$_id', progressionRank: { $first: '$progressionRank' }, stage: { $first: '$stage' } } },
    { $group: { _id: null, total: { $sum: 1 }, ranks: { $push: '$progressionRank' } } },
  ]);
  const ranks = cohort[0]?.ranks || [];
  const top = ranks.length;
  return CRM_MAIN_STAGES.map((stage, index) => {
    const count = ranks.filter((rank) => (Number(rank) || 0) >= CRM_STAGE_RANK[stage]).length;
    const previous = index === 0 ? count : ranks.filter((rank) => (Number(rank) || 0) >= CRM_STAGE_RANK[CRM_MAIN_STAGES[index - 1]]).length;
    return {
      stage, count,
      conversionFromPrev: index === 0 ? 100 : (previous > 0 ? Number(((count / previous) * 100).toFixed(1)) : 0),
      conversionFromTop: top > 0 ? Number(((count / top) * 100).toFixed(1)) : 0,
      dropOff: index === 0 ? 0 : Math.max(0, previous - count),
    };
  });
}

async function crmLeaderboard(match, range, employeeId, optionsById) {
  const rows = await Candidate.aggregate([
    { $match: match },
    ...crmEventStages(range, employeeId),
    { $group: { _id: { recruiter: '$stageHistory.recruiterEmployeeId', stage: '$stageHistory.toStage' }, count: { $sum: 1 } } },
  ]);
  const byRecruiter = new Map();
  for (const row of rows) {
    const key = String(row._id.recruiter);
    if (!byRecruiter.has(key)) byRecruiter.set(key, { employeeId: row._id.recruiter, name: optionsById.get(key)?.name || 'Former recruiter', status: optionsById.get(key)?.status || 'FORMER', counts: Object.fromEntries(CANDIDATE_STAGES.map((stage) => [stage, 0])), total: 0 });
    const entry = byRecruiter.get(key);
    entry.counts[row._id.stage] = (entry.counts[row._id.stage] || 0) + row.count;
    entry.total += row.count;
  }
  return [...byRecruiter.values()]
    .map((entry) => ({ ...entry, conversionRate: entry.counts.NEW_LEAD > 0 ? Number(((entry.counts.JOINED / entry.counts.NEW_LEAD) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// One pass over the period's candidates, deduplicated, then split every way the
// portfolio panel offers. Job and vendor labels are resolved afterwards in memory.
async function crmBreakdowns(companyId, match, range, employeeId) {
  const rank = (rows) => rows.map((row) => ({ key: row._id == null ? '' : String(row._id), label: row._id == null || row._id === '' ? 'Unspecified' : String(row._id), count: row.count })).sort((a, b) => b.count - a.count);
  const group = (field) => [{ $group: { _id: field, count: { $sum: 1 } } }];
  const [facets] = await Candidate.aggregate([
    { $match: match },
    ...crmEventStages(range, employeeId),
    { $group: { _id: '$_id', jobOpeningId: { $first: '$jobOpeningId' }, candidateType: { $first: '$candidateType' }, source: { $first: '$source' }, location: { $first: '$location' }, languages: { $first: '$languages' } } },
    { $facet: {
      byJob: group('$jobOpeningId'),
      byCandidateType: group('$candidateType'),
      bySource: group('$source'),
      byLocation: group('$location'),
      byLanguage: [{ $unwind: { path: '$languages', preserveNullAndEmptyArrays: true } }, ...group('$languages')],
    } },
  ]);
  const jobRows = facets?.byJob || [];
  const jobs = jobRows.length ? await JobOpening.find({ companyId, _id: { $in: jobRows.map((row) => row._id).filter(Boolean) } }).select('title companyName vendorId').lean() : [];
  const jobById = new Map(jobs.map((job) => [String(job._id), job]));
  const vendorIds = [...new Set(jobs.map((job) => job.vendorId).filter(Boolean).map(String))];
  const vendors = vendorIds.length ? await Vendor.find({ companyId, _id: { $in: vendorIds } }).select('name').lean() : [];
  const vendorById = new Map(vendors.map((vendor) => [String(vendor._id), vendor.name]));

  const byJob = jobRows.map((row) => { const job = jobById.get(String(row._id)); return { key: String(row._id), label: job?.title ? `${job.title}${job.companyName ? ` · ${job.companyName}` : ''}` : 'Unknown job', count: row.count }; }).sort((a, b) => b.count - a.count);
  const vendorTotals = new Map();
  for (const row of jobRows) {
    const job = jobById.get(String(row._id));
    const key = job?.vendorId ? String(job.vendorId) : '';
    const label = job?.vendorId ? (vendorById.get(String(job.vendorId)) || 'Unknown vendor') : (job?.companyName || 'Direct client');
    const entry = vendorTotals.get(key + label) || { key, label, count: 0 };
    entry.count += row.count; vendorTotals.set(key + label, entry);
  }
  return { byJob, byVendor: [...vendorTotals.values()].sort((a, b) => b.count - a.count), byCandidateType: rank(facets?.byCandidateType || []), bySource: rank(facets?.bySource || []), byLocation: rank(facets?.byLocation || []), byLanguage: rank(facets?.byLanguage || []) };
}

// Revenue reads Placement.invoiceAmount, never JobOpening.vendorPayment, which is
// `select: false` and must not leak into a dashboard payload.
async function crmRevenue(companyId, match, range, scoped) {
  const candidateFilter = scoped ? { candidateId: { $in: await Candidate.find(match).distinct('_id') } } : {};
  const amount = { $toDouble: { $ifNull: ['$invoiceAmount', 0] } };
  const [byState, earned, upcoming] = await Promise.all([
    Placement.aggregate([{ $match: { companyId, ...candidateFilter } }, { $group: { _id: '$invoiceState', count: { $sum: 1 }, amount: { $sum: amount } } }]),
    Placement.aggregate([{ $match: { companyId, ...candidateFilter, actualDoj: { $gte: range.startInstant, $lt: range.endExclusive } } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: amount } } }]),
    Placement.find({ companyId, ...candidateFilter, invoiceState: { $in: ['FUTURE_DUE', 'DUE', 'GENERATED', 'READY_TO_RAISE'] } })
      .sort({ invoiceDueDate: 1 }).limit(10)
      .populate('candidateId', 'name').populate('jobOpeningId', 'title companyName').populate('vendorId', 'name').lean(),
  ]);
  const stateRow = (state) => byState.find((row) => row._id === state);
  const sumStates = (states) => Number(states.reduce((total, state) => total + (stateRow(state)?.amount || 0), 0).toFixed(2));
  const countStates = (states) => states.reduce((total, state) => total + (stateRow(state)?.count || 0), 0);
  return {
    byInvoiceState: INVOICE_STATES.map((state) => ({ state, count: stateRow(state)?.count || 0, amount: Number((stateRow(state)?.amount || 0).toFixed(2)) })),
    totalInvoiced: Number(byState.reduce((total, row) => total + row.amount, 0).toFixed(2)),
    raisedAmount: Number((stateRow('RAISED')?.amount || 0).toFixed(2)),
    periodRevenue: Number((earned[0]?.amount || 0).toFixed(2)),
    periodPlacements: earned[0]?.count || 0,
    dueCount: (stateRow('DUE')?.count || 0) + (stateRow('READY_TO_RAISE')?.count || 0),
    // Snapshot balances (all-time, not date-ranged): money owed is a running
    // total, not a period flow, so an invoice raised last quarter and still
    // unpaid must keep showing here regardless of the selected range.
    dueForInvoicingAmount: sumStates(['DUE']), dueForInvoicingCount: countStates(['DUE']),
    invoicedPipelineAmount: sumStates(['GENERATED', 'READY_TO_RAISE', 'RAISED']), invoicedPipelineCount: countStates(['GENERATED', 'READY_TO_RAISE', 'RAISED']),
    paidAmount: sumStates(['PAID']), paidCount: countStates(['PAID']),
    upcomingDue: upcoming.map((placement) => ({
      _id: placement._id, candidateName: placement.candidateId?.name || 'Unknown candidate',
      jobTitle: placement.jobOpeningId?.title || '—', client: placement.vendorId?.name || placement.companyName || placement.jobOpeningId?.companyName || 'Direct client',
      actualDoj: placement.actualDoj, invoiceDueDate: placement.invoiceDueDate, invoiceState: placement.invoiceState,
      invoiceAmount: placement.invoiceAmount == null ? null : toNumber(placement.invoiceAmount),
    })),
  };
}

// Combines the actor's permission scope with the filters they picked, using $and
// so the two INTERSECT. Spreading them would let a recruiter's `jobOpeningId`
// filter overwrite the scope's assigned-job restriction and widen their access.
// candidateScope() is the same rule the candidate list uses: for a recruiter,
// own candidates on jobs they are still assigned to.
async function crmScopedMatch(actor, query, extra = null) {
  // Same rule as candidateScope(), but with ids cast explicitly: find() casts a
  // string id for you, aggregate() does not, and a string companyId silently
  // matches nothing.
  const companyId = objectId(String(actor.companyId));
  const scope = { companyId };
  if (!isOwner(actor)) {
    if (!actor.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiter employee profile required');
    scope.recruiterEmployeeId = objectId(String(actor.employeeId), 'employeeId');
    scope.jobOpeningId = { $in: await recruiterJobIds(actor) };
  }
  const conditions = [scope, await crmFilterMatch(companyId, query)];
  if (extra) conditions.push(extra);
  const active = conditions.filter((condition) => Object.keys(condition).length);
  return active.length === 1 ? active[0] : { $and: active };
}

// Recruiters are always pinned to themselves; only the owner may pick an employee
// or view the collective. Mirrors the guard on /crm/monitoring.
function crmActorScope(actor, query, optionsById) {
  if (!isOwner(actor)) {
    if (query.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiters cannot view another employee CRM report');
    if (!actor.employeeId) throw new AppError('PERMISSION_DENIED', 403, 'Recruiter employee profile required');
    return objectId(String(actor.employeeId), 'employeeId');
  }
  if (query.employeeId && !optionsById.has(String(query.employeeId))) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'CRM employee was not found in this company');
  return query.employeeId ? objectId(String(query.employeeId), 'employeeId') : null;
}

async function crmAnalytics(actor, query = {}, now = new Date()) {
  const companyId = objectId(String(actor.companyId));
  const owner = isOwner(actor);
  const timeZone = await companyTimeZone(companyId);
  // Recruiters never receive the roster of their colleagues.
  const { optionsById, options: employeeOptions } = owner ? await recruiterOptions(companyId) : { optionsById: new Map(), options: [] };
  const employeeId = crmActorScope(actor, query, optionsById);

  const range = dashboardReportRange({ ...query, preset: query.preset || 'month' }, timeZone, now);
  const span = daysBetweenKeys(range.startDate, range.endDate);
  const comparison = dashboardReportRange({ preset: 'custom', startDate: addDateKeyDays(range.startDate, -span), endDate: addDateKeyDays(range.startDate, -1) }, timeZone, now);
  const todayRange = dashboardReportRange({ preset: 'today' }, timeZone, now);
  const granularity = query.granularity || autoGranularity(range);

  const match = await crmScopedMatch(actor, query);
  // The live-pipeline and join-speed figures read candidate documents rather than
  // events, so the selected recruiter is applied as a document filter here.
  const pipelineMatch = await crmScopedMatch(actor, query, employeeId ? { recruiterEmployeeId: employeeId } : null);
  // Jobs and vendors a recruiter may filter by are limited to their assignments.
  const jobFilter = { companyId, deletedAt: null, ...(owner ? {} : { assignedRecruiterIds: actor.employeeId }) };

  const [todayCounts, periodCounts, previousCounts, dailyRows, funnel, leaderboard, breakdowns, revenue, pipelineRows, activePipeline, joinSpeed, jobOptions, sourceOptions, locationOptions] = await Promise.all([
    crmEventCounts(match, todayRange, employeeId),
    crmEventCounts(match, range, employeeId),
    crmEventCounts(match, comparison, employeeId),
    crmDailyEvents(match, range, employeeId, timeZone),
    crmFunnel(match, range, employeeId),
    // Peer performance and placement revenue are owner-only data.
    owner ? crmLeaderboard(match, range, employeeId, optionsById) : null,
    crmBreakdowns(companyId, match, range, employeeId),
    owner ? crmRevenue(companyId, match, range, Boolean(query.jobOpeningId || query.vendorId || query.candidateType || query.source || query.location)) : null,
    Candidate.aggregate([{ $match: pipelineMatch }, { $group: { _id: '$stage', count: { $sum: 1 } } }]),
    Candidate.countDocuments({ $and: [pipelineMatch, { stage: { $nin: CRM_TERMINAL_STAGES } }] }),
    Candidate.aggregate([
      { $match: { $and: [pipelineMatch, { actualDoj: { $gte: range.startInstant, $lt: range.endExclusive } }] } },
      { $group: { _id: null, days: { $avg: { $divide: [{ $subtract: ['$actualDoj', '$createdAt'] }, 86400000] } } } },
    ]),
    JobOpening.find(jobFilter).select('title companyName vendorId status').sort({ title: 1 }).limit(500).lean(),
    Candidate.distinct('source', match),
    Candidate.distinct('location', match),
  ]);

  const vendorIds = [...new Set(jobOptions.map((job) => job.vendorId).filter(Boolean).map(String))];
  const vendorOptions = vendorIds.length ? await Vendor.find({ companyId, _id: { $in: vendorIds }, deletedAt: null }).select('name').sort({ name: 1 }).lean() : [];

  const stageMetric = (stage) => metric(periodCounts[stage] || 0, previousCounts[stage] || 0);
  const submissions = periodCounts[KPI_STAGE.submissions] || 0; const joined = periodCounts[KPI_STAGE.joined] || 0;
  const previousSubmissions = previousCounts[KPI_STAGE.submissions] || 0; const previousJoined = previousCounts[KPI_STAGE.joined] || 0;
  const conversion = submissions > 0 ? Number(((joined / submissions) * 100).toFixed(1)) : 0;
  const previousConversion = previousSubmissions > 0 ? Number(((previousJoined / previousSubmissions) * 100).toFixed(1)) : 0;
  const publicRange = (value) => ({ preset: value.preset, startDate: value.startDate, endDate: value.endDate, timezone: timeZone });
  const selected = employeeId ? optionsById.get(String(employeeId)) : null;

  return {
    range: publicRange(range), comparisonRange: publicRange(comparison), granularity,
    viewer: { role: actor.role, owner },
    scope: owner ? (selected ? { type: 'EMPLOYEE', ...selected } : { type: 'ALL', name: 'All recruiters' }) : { type: 'SELF', name: 'My pipeline' },
    kpis: {
      submissions: stageMetric(KPI_STAGE.submissions), interviews: stageMetric(KPI_STAGE.interviews),
      selected: stageMetric(KPI_STAGE.selected), joined: stageMetric(KPI_STAGE.joined), rejected: stageMetric(KPI_STAGE.rejected),
      conversionRate: { ...metric(conversion, previousConversion), unit: 'percent' },
      activePipeline: metric(activePipeline, activePipeline),
      avgDaysToJoin: { value: joinSpeed[0]?.days ? Number(joinSpeed[0].days.toFixed(1)) : 0, previous: 0, deltaPct: 0, unit: 'days' },
      ...(owner ? {
        placementRevenue: { value: revenue.periodRevenue, previous: 0, deltaPct: 0, unit: 'currency' },
        invoicesDue: metric(revenue.dueCount, revenue.dueCount),
        dueForInvoicing: { value: revenue.dueForInvoicingAmount, previous: 0, deltaPct: 0, unit: 'currency' },
        invoicedPipeline: { value: revenue.invoicedPipelineAmount, previous: 0, deltaPct: 0, unit: 'currency' },
        paidInvoices: { value: revenue.paidAmount, previous: 0, deltaPct: 0, unit: 'currency' },
      } : {}),
    },
    stageCounts: { today: todayCounts, period: periodCounts, previous: previousCounts },
    timeseries: buildTimeseries(dailyRows, range, granularity),
    funnel, breakdowns,
    ...(owner ? { leaderboard, revenue } : {}),
    pipelineSnapshot: CANDIDATE_STAGES.map((stage) => ({ stage, count: pipelineRows.find((row) => row._id === stage)?.count || 0 })),
    filterOptions: {
      recruiters: employeeOptions,
      jobs: jobOptions.map((job) => ({ key: String(job._id), label: `${job.title}${job.companyName ? ` · ${job.companyName}` : ''}`, status: job.status })),
      vendors: vendorOptions.map((vendor) => ({ key: String(vendor._id), label: vendor.name })),
      candidateTypes: ['IT', 'NON_IT'],
      sources: sourceOptions.filter(Boolean).sort(),
      locations: locationOptions.filter(Boolean).sort(),
    },
  };
}

// --- Drill-down --------------------------------------------------------------
// Resolves any chart click to the candidate set behind it, then returns both a
// charted summary (level 2) and a paginated row list whose rows open level 3.
const DRILLDOWN_ID_CAP = 5000;

// Owner-only dimensions read data a recruiter has no access to at all.
const CRM_OWNER_ONLY_DIMENSIONS = ['RECRUITER', 'INVOICE_STATE'];

async function crmDrilldown(actor, query = {}, now = new Date()) {
  const companyId = objectId(String(actor.companyId));
  const owner = isOwner(actor);
  const timeZone = await companyTimeZone(companyId);
  const { optionsById } = owner ? await recruiterOptions(companyId) : { optionsById: new Map() };
  const range = dashboardReportRange({ ...query, preset: query.preset || 'month' }, timeZone, now);
  const dimension = query.dimension || 'ALL';
  const value = query.value == null ? '' : String(query.value);
  let label = 'All CRM activity';

  if (!owner && CRM_OWNER_ONLY_DIMENSIONS.includes(dimension)) throw new AppError('PERMISSION_DENIED', 403, 'This drill-down is not available to recruiters');
  let employeeId = crmActorScope(actor, query, optionsById);
  if (dimension === 'RECRUITER') {
    if (!optionsById.has(value)) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'CRM employee was not found in this company');
    employeeId = objectId(value, 'employeeId'); label = optionsById.get(value)?.name || 'Recruiter';
  }

  // Dimension narrowing is a separate condition $and-ed onto the actor's scope,
  // so a drill-down can never widen past what the viewer is allowed to see.
  const narrow = {};
  if (dimension === 'JOB') { narrow.jobOpeningId = objectId(value, 'jobOpeningId'); label = (await JobOpening.findOne({ _id: narrow.jobOpeningId, companyId }).select('title').lean())?.title || 'Job opening'; }
  if (dimension === 'VENDOR') { const vendorId = value ? objectId(value, 'vendorId') : null; narrow.jobOpeningId = { $in: await JobOpening.find({ companyId, ...(vendorId ? { vendorId } : { vendorId: null }), deletedAt: null }).distinct('_id') }; label = vendorId ? ((await Vendor.findOne({ _id: vendorId, companyId }).select('name').lean())?.name || 'Vendor') : 'Direct clients'; }
  if (dimension === 'CANDIDATE_TYPE') { narrow.candidateType = value; label = value === 'NON_IT' ? 'Non-IT candidates' : 'IT candidates'; }
  if (dimension === 'SOURCE') { narrow.source = value || null; label = value || 'Unspecified source'; }
  if (dimension === 'LOCATION') { narrow.location = value || null; label = value || 'Unspecified location'; }
  if (dimension === 'LANGUAGE') { narrow.languages = value; label = value; }
  if (dimension === 'PIPELINE_STAGE') { narrow.stage = value; label = `Currently ${value.replaceAll('_', ' ').toLowerCase()}`; }
  if (dimension === 'INVOICE_STATE') { const states = value.split(',').map((state) => state.trim()).filter(Boolean); narrow._id = { $in: await Placement.find({ companyId, invoiceState: { $in: states } }).distinct('candidateId') }; label = `Invoices ${states.map((state) => state.replaceAll('_', ' ').toLowerCase()).join(', ')}`; }
  if (dimension === 'STAGE') label = `Moved to ${value.replaceAll('_', ' ').toLowerCase()}`;

  const match = await crmScopedMatch(actor, query, Object.keys(narrow).length ? narrow : null);
  const snapshot = CRM_SNAPSHOT_DIMENSIONS.includes(dimension);
  const idRows = await Candidate.aggregate([
    { $match: match },
    ...(snapshot ? [] : crmEventStages(range, employeeId, dimension === 'STAGE' ? [{ $match: { 'stageHistory.toStage': value } }] : [])),
    { $group: { _id: '$_id' } },
    { $limit: DRILLDOWN_ID_CAP },
  ]);
  const ids = idRows.map((row) => row._id);
  const total = ids.length;
  const { page: p, limit } = page(query);

  const [rows, byStage, byRecruiter, byJob, dailyRows] = await Promise.all([
    Candidate.find({ _id: { $in: ids }, companyId })
      .select('name contact candidateType qualification languages location source stage interviewDate interviewStatus expectedDoj actualDoj createdAt updatedAt jobOpeningId recruiterEmployeeId')
      .populate({ path: 'jobOpeningId', select: 'title companyName vendorId', populate: { path: 'vendorId', select: 'name' } })
      .populate('recruiterEmployeeId', 'firstName lastName workEmail')
      .sort({ updatedAt: -1 }).skip((p - 1) * limit).limit(limit).lean(),
    Candidate.aggregate([{ $match: { _id: { $in: ids }, companyId } }, { $group: { _id: '$stage', count: { $sum: 1 } } }]),
    Candidate.aggregate([{ $match: { _id: { $in: ids }, companyId } }, { $group: { _id: '$recruiterEmployeeId', count: { $sum: 1 } } }]),
    Candidate.aggregate([{ $match: { _id: { $in: ids }, companyId } }, { $group: { _id: '$jobOpeningId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    snapshot ? [] : crmDailyEvents({ companyId, _id: { $in: ids } }, range, employeeId, timeZone),
  ]);
  const jobs = byJob.length ? await JobOpening.find({ companyId, _id: { $in: byJob.map((row) => row._id).filter(Boolean) } }).select('title companyName').lean() : [];
  const jobById = new Map(jobs.map((job) => [String(job._id), job]));

  return {
    summary: {
      dimension, value, label, total,
      range: { preset: range.preset, startDate: range.startDate, endDate: range.endDate, timezone: timeZone },
      byStage: CANDIDATE_STAGES.map((stage) => ({ key: stage, label: stage.replaceAll('_', ' ').toLowerCase(), count: byStage.find((row) => row._id === stage)?.count || 0 })).filter((row) => row.count > 0),
      byRecruiter: owner ? byRecruiter.map((row) => ({ key: String(row._id), label: optionsById.get(String(row._id))?.name || 'Unassigned', count: row.count })).sort((a, b) => b.count - a.count) : [],
      byJob: byJob.map((row) => ({ key: String(row._id), label: jobById.get(String(row._id))?.title || 'Unknown job', count: row.count })),
      trend: buildTimeseries(dailyRows, range, autoGranularity(range)),
    },
    items: rows.map((row) => ({
      _id: row._id, name: row.name, contact: row.contact, candidateType: row.candidateType, qualification: row.qualification,
      languages: row.languages, location: row.location, source: row.source, stage: row.stage,
      interviewDate: row.interviewDate, interviewStatus: row.interviewStatus, expectedDoj: row.expectedDoj, actualDoj: row.actualDoj,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      jobTitle: row.jobOpeningId?.title || '—',
      client: row.jobOpeningId?.vendorId?.name || row.jobOpeningId?.companyName || 'Direct client',
      recruiterName: row.recruiterEmployeeId ? `${row.recruiterEmployeeId.firstName || ''} ${row.recruiterEmployeeId.lastName || ''}`.trim() || row.recruiterEmployeeId.workEmail : 'Unassigned',
    })),
    page: p, limit, total, pages: Math.max(1, Math.ceil(total / limit)),
    capped: total >= DRILLDOWN_ID_CAP,
  };
}

async function listPlacements(actor, query) {
  const { page: p, limit } = page(query); const filter = { companyId: actor.companyId }; if (query.invoiceState) filter.invoiceState = query.invoiceState;
  const populate = [{ path: 'candidateId', select: 'name recruiterEmployeeId', populate: { path: 'recruiterEmployeeId', select: 'firstName lastName workEmail' } }, { path: 'jobOpeningId', select: 'title companyName vendorId', populate: { path: 'vendorId', select: 'name' } }];
  const [items, total] = await Promise.all([Placement.find(filter).populate(populate).sort({ invoiceDueDate: 1 }).skip((p - 1) * limit).limit(limit), Placement.countDocuments(filter)]);
  return { items: items.map((row) => { const value = row.toObject(); const recruiter = value.candidateId?.recruiterEmployeeId; return { ...value, candidateName: value.candidateId?.name || 'Candidate unavailable', jobTitle: value.jobOpeningId?.title || 'Job unavailable', clientName: value.companyName || value.jobOpeningId?.vendorId?.name || value.jobOpeningId?.companyName || 'Client unavailable', recruiterName: recruiter ? `${recruiter.firstName || ''} ${recruiter.lastName || ''}`.trim() || recruiter.workEmail : 'Unassigned', invoiceState: deriveInvoiceState(row) }; }), page: p, limit, total };
}
async function getPlacement(actor, id) { const placement = await Placement.findOne({ _id: objectId(id), companyId: actor.companyId }); if (!placement) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Placement not found'); return { ...placement.toObject(), invoiceState: deriveInvoiceState(placement) }; }
async function updateJoining(actor, id, actualDoj) { const existing = await Placement.findOne({ _id: objectId(id), companyId: actor.companyId }); if (!existing) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Placement not found'); const due = existing.dueDateOverridden ? existing.invoiceDueDate : addClauseDays(actualDoj, existing.clauseDays); existing.actualDoj = actualDoj; existing.invoiceDueDate = due; existing.invoiceState = deriveInvoiceState({ actualDoj, invoiceDueDate: due }); await existing.save(); await Candidate.updateOne({ _id: existing.candidateId, companyId: actor.companyId }, { $set: { actualDoj } }); return existing; }
async function overrideInvoiceDate(actor, id, date, reason) { const before = await Placement.findOne({ _id: objectId(id), companyId: actor.companyId }); if (!before) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Placement not found'); if (['RAISED', 'PAID'].includes(before.invoiceState)) throw new AppError('INVOICE_OVERRIDE_NOT_ALLOWED', 409, 'Raised invoice due date cannot be changed'); const updated = await Placement.findByIdAndUpdate(before._id, { $set: { invoiceDueDate: date, dueDateOverridden: true, overrideReason: reason, overriddenBy: actor.userId, invoiceState: deriveInvoiceState({ actualDoj: before.actualDoj, invoiceDueDate: date }) } }, { new: true }); await audit(actor, { action: 'INVOICE_DATE_OVERRIDE', entityType: 'Placement', entityId: updated._id, before: { invoiceDueDate: before.invoiceDueDate }, after: { invoiceDueDate: updated.invoiceDueDate }, reason }); return updated; }
async function invoiceTransition(actor, id, from, to, input = {}) { const placementId = objectId(id); if (to === 'GENERATED') { const current = await Placement.findOne({ _id: placementId, companyId: actor.companyId }); if (current && deriveInvoiceState(current) === 'DUE' && current.invoiceState !== 'DUE') { current.invoiceState = 'DUE'; await current.save(); } } if (to === 'RAISED') { const current = await Placement.findOne({ _id: placementId, companyId: actor.companyId }).select('invoiceAmount'); if (!current?.invoiceAmount) throw new AppError('INVOICE_AMOUNT_NOT_CONFIGURED', 409, 'Set vendor payment on the job opening before raising this invoice'); } const update = { invoiceState: to }; if (to === 'RAISED') Object.assign(update, { raisedAt: new Date(), raisedBy: actor.userId, invoiceReference: input.invoiceReference }); if (to === 'PAID') Object.assign(update, { paidAt: new Date(), paidBy: actor.userId }); if (to === 'READY_TO_RAISE' && [].concat(from).includes('RAISED')) Object.assign(update, { raisedAt: null, raisedBy: null }); const placement = await Placement.findOneAndUpdate({ _id: placementId, companyId: actor.companyId, invoiceState: { $in: [].concat(from) } }, { $set: update }, { new: true }); if (!placement) throw new AppError('INVOICE_OVERRIDE_NOT_ALLOWED', 409, `Invoice cannot transition to ${to}`); if (['RAISED', 'READY_TO_RAISE', 'PAID'].includes(to) || [].concat(from).includes('RAISED')) await audit(actor, { action: `INVOICE_${to}`, entityType: 'Placement', entityId: placement._id, after: { invoiceState: to, invoiceAmount: placement.invoiceAmount }, reason: input.reason || null }); return placement; }

// Builds the candidate/job/client fields the same way listPlacements does, for a single placement.
async function placementView(actor, id) {
  const populate = [{ path: 'candidateId', select: 'name recruiterEmployeeId' }, { path: 'jobOpeningId', select: 'title companyName vendorId', populate: { path: 'vendorId', select: 'name' } }];
  const placement = await Placement.findOne({ _id: objectId(id), companyId: actor.companyId }).populate(populate);
  if (!placement) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Placement not found');
  const value = placement.toObject();
  return { placement, candidateName: value.candidateId?.name || 'Candidate unavailable', jobTitle: value.jobOpeningId?.title || 'Job unavailable', clientName: value.companyName || value.jobOpeningId?.vendorId?.name || value.jobOpeningId?.companyName || 'Client unavailable' };
}
// Next sequential invoice number for the company/year, retried on a unique-index
// collision so two concurrent saves never race onto the same number.
async function nextInvoiceNumber(companyId, year, attempt = 0) {
  if (attempt >= 5) throw new AppError('INTERNAL_ERROR', 500, 'Could not allocate an invoice number');
  const prefix = `INV-${year}-`;
  const latest = await Invoice.findOne({ companyId, invoiceNumber: { $regex: `^${prefix}` } }).sort({ invoiceNumber: -1 }).select('invoiceNumber').lean();
  const nextSeq = latest ? Number(latest.invoiceNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}
function invoiceLineItems(input) { const rows = [].concat(input?.lineItems || []).map((row) => ({ label: String(row.label || '').trim(), amount: Number(row.amount) })).filter((row) => row.label && Number.isFinite(row.amount) && row.amount >= 0); if (!rows.length) throw new AppError('VALIDATION_ERROR', 400, 'At least one valid line item is required'); return rows; }
function invoiceTotal(lineItems) { return Number(lineItems.reduce((total, row) => total + row.amount, 0).toFixed(2)); }
// Draft view for the invoice modal: the saved Invoice if one exists, otherwise
// a seed built from the placement so the admin has something to edit.
async function invoiceDraft(actor, id) {
  const { placement, candidateName, jobTitle, clientName } = await placementView(actor, id);
  const existing = await Invoice.findOne({ placementId: placement._id, companyId: actor.companyId }).lean();
  const dueDate = placement.invoiceDueDate;
  const isEarly = Boolean(dueDate) && Date.now() < new Date(dueDate).getTime();
  if (existing) return { ...existing, lineItems: existing.lineItems.map((row) => ({ label: row.label, amount: Number(row.amount) })), total: Number(existing.total), candidateName, jobTitle, clientName, isEarly, saved: true };
  const year = new Date().getUTCFullYear();
  const lineItems = [{ label: `Placement fee — ${candidateName}`, amount: placement.invoiceAmount == null ? 0 : Number(placement.invoiceAmount) }];
  return { invoiceNumber: await nextInvoiceNumber(actor.companyId, year), issueDate: new Date(), dueDate, candidateName, jobTitle, clientName, lineItems, total: invoiceTotal(lineItems), isEarly, saved: false };
}
function invoiceDocumentLines(view) {
  const money = (value) => Number(value || 0).toFixed(2);
  const date = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '—');
  const items = view.lineItems.slice(0, 15);
  const overflow = view.lineItems.length - items.length;
  return [
    `${String(view.companyName || 'COMPANY').toUpperCase()} - TAX INVOICE`,
    `Invoice number: ${view.invoiceNumber}`,
    `Issue date: ${date(view.issueDate)}    Due date: ${date(view.dueDate)}`,
    '',
    'BILL TO',
    `  ${view.clientName || 'Client unavailable'}`,
    '',
    'PLACEMENT',
    `  Candidate: ${view.candidateName}`,
    `  Role: ${view.jobTitle}`,
    `  Date of joining: ${date(view.actualDoj)}`,
    '',
    'LINE ITEMS',
    ...items.map((row) => `  ${row.label}: ${money(row.amount)}`),
    ...(overflow > 0 ? [`  ...and ${overflow} more`] : []),
    '',
    `TOTAL: ${money(view.total)}`,
  ];
}
async function renderInvoicePdf(actor, placement, source) {
  const Company = model('Company'); const company = await Company.findById(actor.companyId).select('name').lean();
  const lines = invoiceDocumentLines({ ...source, companyName: company?.name, actualDoj: placement.actualDoj });
  const pdf = simplePdf(lines);
  return { contentBase64: pdf.toString('base64'), contentType: 'application/pdf', filename: `invoice-${source.invoiceNumber}.pdf` };
}
// Stateless: renders the posted draft without touching the database, for the
// modal's "Preview PDF" action.
async function previewInvoice(actor, id, input) {
  const { placement, candidateName, jobTitle, clientName } = await placementView(actor, id);
  const lineItems = invoiceLineItems(input);
  const existing = await Invoice.findOne({ placementId: placement._id, companyId: actor.companyId }).lean();
  const invoiceNumber = existing?.invoiceNumber || await nextInvoiceNumber(actor.companyId, new Date().getUTCFullYear());
  return renderInvoicePdf(actor, placement, { invoiceNumber, issueDate: existing?.issueDate || new Date(), dueDate: placement.invoiceDueDate, candidateName, jobTitle, clientName, lineItems, total: invoiceTotal(lineItems) });
}
// Persists the Invoice record and moves the placement to GENERATED. FUTURE_DUE
// is a valid `from` state so the admin can generate ahead of the due date.
async function saveInvoice(actor, id, input) {
  const { placement, candidateName, jobTitle, clientName } = await placementView(actor, id);
  const lineItems = invoiceLineItems(input);
  const total = invoiceTotal(lineItems);
  const dueDate = placement.invoiceDueDate;
  const isEarly = Boolean(dueDate) && Date.now() < new Date(dueDate).getTime();
  const existing = await Invoice.findOne({ placementId: placement._id, companyId: actor.companyId });
  const year = new Date().getUTCFullYear();
  // Two different placements can both read the same "next" number before either
  // writes; retry with a freshly allocated number on a unique-index collision.
  let invoice;
  for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
    const invoiceNumber = existing?.invoiceNumber || await nextInvoiceNumber(actor.companyId, year, attempt);
    try {
      invoice = await Invoice.findOneAndUpdate(
        { placementId: placement._id, companyId: actor.companyId },
        { $set: { candidateId: placement.candidateId, invoiceNumber, issueDate: existing?.issueDate || new Date(), dueDate, clientName, candidateName, jobTitle, lineItems: lineItems.map((row) => ({ label: row.label, amount: row.amount })), total, generatedAt: new Date(), generatedBy: actor.userId, generatedEarly: isEarly } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000 || existing) throw error;
    }
  }
  if (!invoice) throw new AppError('INTERNAL_ERROR', 500, 'Could not allocate an invoice number');
  await invoiceTransition(actor, id, ['DUE', 'FUTURE_DUE', 'GENERATED'], 'GENERATED');
  await audit(actor, { action: 'INVOICE_GENERATED', entityType: 'Placement', entityId: placement._id, after: { invoiceNumber: invoice.invoiceNumber, total, lineItems, early: isEarly }, reason: isEarly ? 'Generated before the invoice due date' : null });
  return invoice.toObject();
}
async function downloadInvoice(actor, id) {
  const { placement, candidateName, jobTitle, clientName } = await placementView(actor, id);
  const invoice = await Invoice.findOne({ placementId: placement._id, companyId: actor.companyId }).lean();
  if (!invoice) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'No invoice has been generated for this placement yet');
  return renderInvoicePdf(actor, placement, { invoiceNumber: invoice.invoiceNumber, issueDate: invoice.issueDate, dueDate: invoice.dueDate, candidateName: invoice.candidateName || candidateName, jobTitle: invoice.jobTitle || jobTitle, clientName: invoice.clientName || clientName, lineItems: invoice.lineItems.map((row) => ({ label: row.label, amount: Number(row.amount) })), total: Number(invoice.total) });
}

module.exports = { listVendors, createVendor, getVendor, updateVendor, listJobs, createJob, getJob, updateJob, setJobStatus, assignRecruiters, listCandidates, createCandidate, getCandidate, updateCandidate, reassignCandidate, transitionCandidate, updateInterview, candidateHistory, listCandidateProfiles, getCandidateProfile, createCandidateProfile, updateCandidateProfile, assignCandidateProfiles, submitCandidateProfile, crmMonitoring, crmAnalytics, crmDrilldown, listPlacements, getPlacement, updateJoining, overrideInvoiceDate, invoiceTransition, invoiceDraft, previewInvoice, saveInvoice, downloadInvoice };
