'use strict';

const crypto = require('crypto');
const { Conversation, Message, Notification, DocumentAsset, AuditEvent, PayrollPeriod, Candidate, Placement, JobOpening } = require('./models');
const { canonicalParticipants } = require('./rules');
const { AppError, objectId, page, dateRange, model, assertTenantEntity, audit } = require('./support');
const { getStorageAdapter, safeFilename, detectType } = require('./storage');
const analytics = require('./analytics');
const { dashboardReportRange, addDateKeyDays } = analytics;
// The workforce overview and its drill-downs are large enough to live on their
// own; they are re-exported here so the route layer keeps one reporting entry point.
const workforce = require('./workforce.service');
const { attendanceSummary, adminDashboard, liveWorkforce, workforceDrilldown } = workforce;

async function userProfiles(actor, userIds) {
  const User = model('User'); const Employee = model('Employee');
  const ids = [...new Set(userIds.map(String))].map((id) => objectId(id, 'userId'));
  if (!ids.length) return new Map();
  const [users, employees] = await Promise.all([
    User.find({ companyId: actor.companyId, _id: { $in: ids }, deletedAt: null }).select('_id displayName email role status').lean(),
    Employee.find({ companyId: actor.companyId, userId: { $in: ids }, deletedAt: null }).select('userId employeeCode firstName lastName designation department employmentStatus').lean(),
  ]);
  const employeeByUser = new Map(employees.map((employee) => [String(employee.userId), employee]));
  return new Map(users.map((user) => {
    const employee = employeeByUser.get(String(user._id));
    const employeeName = employee && [employee.firstName, employee.lastName].filter(Boolean).join(' ');
    return [String(user._id), { _id: user._id, displayName: user.displayName || employeeName || user.email, email: user.email, role: user.role, status: user.status, employeeCode: employee?.employeeCode || null, designation: employee?.designation || null, department: employee?.department || null, employmentStatus: employee?.employmentStatus || null }];
  }));
}
async function partners(actor) {
  const User = model('User');
  const users = await User.find({ companyId: actor.companyId, _id: { $ne: actor.userId }, status: 'ACTIVE', deletedAt: null }).select('_id').sort('displayName email').limit(200).lean();
  const profiles = await userProfiles(actor, users.map((user) => user._id));
  return users.map((user) => profiles.get(String(user._id))).filter(Boolean);
}
async function ensureConversation(actor, partnerUserId) {
  const User = model('User'); const partner = await User.findOne({ _id: objectId(partnerUserId, 'partnerUserId'), companyId: actor.companyId, status: 'ACTIVE', deletedAt: null });
  if (!partner) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Conversation partner not found');
  const [participantAId, participantBId] = canonicalParticipants(actor.userId, partner._id);
  return Conversation.findOneAndUpdate({ companyId: actor.companyId, participantAId, participantBId }, { $setOnInsert: { companyId: actor.companyId, participantAId, participantBId } }, { upsert: true, new: true });
}
async function assertParticipant(actor, conversationId) { const conversation = await Conversation.findOne({ _id: objectId(conversationId), companyId: actor.companyId, $or: [{ participantAId: actor.userId }, { participantBId: actor.userId }] }); if (!conversation) throw new AppError('MESSAGE_NOT_PARTICIPANT', 403, 'Not a conversation participant'); return conversation; }
async function conversations(actor) {
  const rows = await Conversation.find({ companyId: actor.companyId, $or: [{ participantAId: actor.userId }, { participantBId: actor.userId }] }).sort({ lastMessageAt: -1 }).lean();
  if (!rows.length) return [];
  const companyId = objectId(actor.companyId, 'companyId'); const actorUserId = objectId(actor.userId, 'userId');
  const partnerIds = rows.map((row) => String(row.participantAId) === String(actor.userId) ? row.participantBId : row.participantAId);
  const [profiles, activity] = await Promise.all([
    userProfiles(actor, partnerIds),
    Message.aggregate([
      { $match: { companyId, conversationId: { $in: rows.map((row) => row._id) } } },
      { $sort: { sentAt: -1, _id: -1 } },
      { $group: { _id: '$conversationId', lastMessage: { $first: '$$ROOT' }, unreadCount: { $sum: { $cond: [{ $and: [{ $ne: ['$senderId', actorUserId] }, { $eq: ['$readAt', null] }] }, 1, 0] } } } },
    ]),
  ]);
  const activityByConversation = new Map(activity.map((item) => [String(item._id), item]));
  return rows.map((row, index) => {
    const conversationActivity = activityByConversation.get(String(row._id));
    return { ...row, currentUserId: actor.userId, partner: profiles.get(String(partnerIds[index])) || null, lastMessage: conversationActivity?.lastMessage || null, unreadCount: conversationActivity?.unreadCount || 0 };
  });
}
async function thread(actor, id, query) {
  await assertParticipant(actor, id); const filter = { companyId: actor.companyId, conversationId: objectId(id) };
  if (query.since) {
    if (/^[0-9a-fA-F]{24}$/.test(query.since)) filter._id = { $gt: objectId(query.since) };
    else { const since = new Date(query.since); if (Number.isNaN(since.getTime())) throw new AppError('VALIDATION_ERROR', 400, 'Invalid since cursor'); filter.sentAt = { $gt: since }; }
  }
  const limit = Math.min(100, Number(query.limit) || 50);
  const messages = await Message.find(filter).sort(query.since ? { sentAt: 1, _id: 1 } : { sentAt: -1, _id: -1 }).limit(limit).lean();
  if (!query.since) messages.reverse();
  return messages.map((message) => ({ ...message, isMine: String(message.senderId) === String(actor.userId) }));
}
async function sendMessage(actor, id, body) { const conversation = await assertParticipant(actor, id); const message = await Message.create({ companyId: actor.companyId, conversationId: conversation._id, senderId: actor.userId, body }); await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: message.sentAt } }); return message; }
async function markRead(actor, id) { await assertParticipant(actor, id); const result = await Message.updateMany({ companyId: actor.companyId, conversationId: objectId(id), senderId: { $ne: actor.userId }, readAt: null }, { $set: { readAt: new Date() } }); return { modifiedCount: result.modifiedCount }; }
async function monitorConversations(actor, query) { const { page: p, limit } = page(query); const [items, total] = await Promise.all([Conversation.find({ companyId: actor.companyId }).sort({ lastMessageAt: -1 }).skip((p - 1) * limit).limit(limit), Conversation.countDocuments({ companyId: actor.companyId })]); await audit(actor, { action: 'CONVERSATION_MONITOR_ACCESSED', entityType: 'Company', entityId: objectId(String(actor.companyId)), after: { page: p } }); return { items, page: p, limit, total }; }

async function notifications(actor, query) { const filter = { companyId: actor.companyId, recipientUserId: actor.userId }; if (query.since) { if (/^[0-9a-fA-F]{24}$/.test(query.since)) filter._id = { $gt: objectId(query.since) }; else { const since = new Date(query.since); if (Number.isNaN(since.getTime())) throw new AppError('VALIDATION_ERROR', 400, 'Invalid since cursor'); filter.createdAt = { $gt: since }; } } return Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(Math.min(100, Number(query.limit) || 30)); }
async function readNotification(actor, id) { const row = await Notification.findOneAndUpdate({ _id: objectId(id), companyId: actor.companyId, recipientUserId: actor.userId }, { $set: { readAt: new Date() } }, { new: true }); if (!row) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Notification not found'); return row; }
async function readAll(actor) { const result = await Notification.updateMany({ companyId: actor.companyId, recipientUserId: actor.userId, readAt: null }, { $set: { readAt: new Date() } }); return { modifiedCount: result.modifiedCount }; }

async function authorizeOwner(actor, ownerType, ownerId, write = false) {
  if (ownerType === 'VENDOR') { if (actor.role !== 'SUPER_ADMIN') throw new AppError('PERMISSION_DENIED', 403, 'Vendor documents require owner access'); return assertTenantEntity('Vendor', ownerId, actor.companyId); }
  const Employee = model('Employee'); const employee = await Employee.findOne({ _id: objectId(ownerId, 'ownerId'), companyId: actor.companyId, deletedAt: null });
  if (!employee) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Employee not found');
  const isSelf = String(employee._id) === String(actor.employeeId); if (!isSelf && actor.role !== 'SUPER_ADMIN') throw new AppError('PERMISSION_DENIED', 403, 'Document owner access denied');
  if (write && actor.role !== 'SUPER_ADMIN') throw new AppError('PERMISSION_DENIED', 403, 'Only the owner may upload documents'); return employee;
}
async function uploadDocument(actor, input, file) {
  if (!file?.buffer?.length) throw new AppError('VALIDATION_ERROR', 400, 'A file is required');
  const max = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024); if (file.size > max) throw new AppError('FILE_TOO_LARGE', 413, `File exceeds ${max} bytes`);
  const contentType = detectType(file.buffer); if (!contentType || !['application/pdf', 'image/png', 'image/jpeg'].includes(contentType)) throw new AppError('FILE_TYPE_NOT_ALLOWED', 415, 'Only genuine PDF, PNG and JPEG files are allowed');
  await authorizeOwner(actor, input.ownerType, input.ownerId, true);
  const cleanName = safeFilename(file.originalname); const key = `${String(actor.companyId)}/${input.ownerType.toLowerCase()}/${String(input.ownerId)}/${crypto.randomUUID()}-${cleanName}`;
  await getStorageAdapter().put({ key, buffer: file.buffer, contentType });
  try { return await DocumentAsset.create({ companyId: actor.companyId, ownerType: input.ownerType, ownerId: input.ownerId, category: input.category, objectKey: key, originalName: cleanName, contentType, sizeBytes: file.size, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'), visibleToOwner: Boolean(input.visibleToOwner), uploadedBy: actor.userId }); }
  catch (error) { await getStorageAdapter().remove({ key }).catch(() => null); throw error; }
}
async function getDocument(actor, id, forDownload = false) { const row = await DocumentAsset.findOne({ _id: objectId(id), companyId: actor.companyId, deletedAt: null }); if (!row) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Document not found'); await authorizeOwner(actor, row.ownerType, row.ownerId); const isSelf = String(row.ownerId) === String(actor.employeeId); if (isSelf && !row.visibleToOwner) throw new AppError('PERMISSION_DENIED', 403, 'Document is not visible to its owner'); if (forDownload && row.scanStatus !== 'CLEAN') throw new AppError('FILE_TYPE_NOT_ALLOWED', 409, 'Document is not cleared for download'); return row; }
async function downloadDocument(actor, id) { const row = await getDocument(actor, id, true); const expiresIn = Number(process.env.SIGNED_URL_TTL_SECONDS || 900); const url = await getStorageAdapter().signedDownloadUrl({ key: row.objectKey, expiresIn }); await audit(actor, { action: 'DOCUMENT_DOWNLOADED', entityType: 'DocumentAsset', entityId: row._id, after: { category: row.category } }); return { url, expiresIn }; }
async function deleteDocument(actor, id, reason) { const row = await getDocument(actor, id); if (actor.role !== 'SUPER_ADMIN') throw new AppError('PERMISSION_DENIED', 403, 'Document delete requires owner access'); row.deletedAt = new Date(); await row.save(); await audit(actor, { action: 'DOCUMENT_DELETED', entityType: 'DocumentAsset', entityId: row._id, after: { deletedAt: row.deletedAt }, reason }); return row; }
async function updateScanStatus(actor, id, scanStatus, reason) { const row = await DocumentAsset.findOneAndUpdate({ _id: objectId(id), companyId: actor.companyId, deletedAt: null, scanStatus: { $in: ['PENDING', 'FAILED'] } }, { $set: { scanStatus } }, { new: true }); if (!row) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Pending document not found'); await audit(actor, { action: 'DOCUMENT_SCAN_UPDATED', entityType: 'DocumentAsset', entityId: row._id, after: { scanStatus }, reason }); return row; }
async function listOwnerDocuments(actor, ownerType, ownerId) { await authorizeOwner(actor, ownerType, ownerId); const filter = { companyId: actor.companyId, ownerType, ownerId: objectId(ownerId), deletedAt: null }; if (String(ownerId) === String(actor.employeeId)) filter.visibleToOwner = true; return DocumentAsset.find(filter).select('-objectKey'); }

async function auditEvents(actor, query, global = false) { const { page: p, limit } = page(query); const filter = global ? {} : { companyId: actor.companyId }; if (query.action) filter.action = query.action; if (query.entityType) filter.entityType = query.entityType; if (query.entityId) filter.entityId = objectId(query.entityId); const [items, total] = await Promise.all([AuditEvent.find(filter).sort({ createdAt: -1, _id: -1 }).skip((p - 1) * limit).limit(limit), AuditEvent.countDocuments(filter)]); return { items, page: p, limit, total }; }


async function recruiterDashboard(actor, query) { const { start, end } = dateRange(query); const jobs = await JobOpening.find({ companyId: actor.companyId, assignedRecruiterIds: actor.employeeId, deletedAt: null }).distinct('_id'); const match = { companyId: objectId(String(actor.companyId)), recruiterEmployeeId: objectId(String(actor.employeeId)), jobOpeningId: { $in: jobs }, createdAt: { $gte: start, $lte: end } }; const [byStage, upcomingInterviews] = await Promise.all([Candidate.aggregate([{ $match: match }, { $group: { _id: '$stage', count: { $sum: 1 } } }]), Candidate.find({ companyId: actor.companyId, recruiterEmployeeId: actor.employeeId, jobOpeningId: { $in: jobs }, interviewDate: { $gte: new Date() }, stage: 'INTERVIEW_SCHEDULED' }).sort({ interviewDate: 1 }).limit(20)]); return { range: { start, end, timezone: query.timezone || 'UTC' }, byStage, upcomingInterviews }; }
async function exportReport(actor, input) { const allowed = { candidates: Candidate, placements: Placement, payroll: PayrollPeriod, audit: AuditEvent }; const Model = allowed[input.report]; if (!Model) throw new AppError('VALIDATION_ERROR', 400, 'Unsupported report'); const { start, end } = dateRange(input); const rows = await Model.find({ companyId: actor.companyId, createdAt: { $gte: start, $lte: end } }).limit(10000).lean(); const keys = [...new Set(rows.flatMap(Object.keys))].filter((key) => !/contact|internalPayment|objectKey/i.test(key)); const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`; const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n'); await audit(actor, { action: 'REPORT_EXPORTED', entityType: 'Company', entityId: objectId(String(actor.companyId)), after: { report: input.report, start, end, rows: rows.length } }); return { contentType: 'text/csv', filename: `${input.report}-${Date.now()}.csv`, contentBase64: Buffer.from(csv).toString('base64'), rows: rows.length };
}
module.exports = { addDateKeyDays, liveWorkforce, workforceDrilldown, partners, ensureConversation, conversations, thread, sendMessage, markRead, monitorConversations, notifications, readNotification, readAll, uploadDocument, getDocument, downloadDocument, deleteDocument, updateScanStatus, listOwnerDocuments, auditEvents, dashboardReportRange, attendanceSummary, adminDashboard, recruiterDashboard, exportReport };
