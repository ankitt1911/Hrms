'use strict';

const mongoose = require('mongoose');
const { Placement, Notification, PayrollPeriod } = require('./models');
const { deriveInvoiceState } = require('./rules');

async function invoiceReminderJob(now = new Date()) {
  const open = await Placement.find({ invoiceState: { $nin: ['RAISED', 'PAID', 'CANCELLED'] } });
  let updated = 0; let notifications = 0;
  for (const placement of open) {
    const state = deriveInvoiceState(placement, now);
    if (state !== placement.invoiceState) { placement.invoiceState = state; await placement.save(); updated += 1; }
    if (state !== 'DUE') continue;
    let User; try { User = mongoose.model('User'); } catch { continue; }
    const recipients = await User.find({ companyId: placement.companyId, role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null }).distinct('_id');
    for (const recipientUserId of recipients) {
      await Notification.updateOne({ recipientUserId, type: 'INVOICE_DUE_REMINDER', linkEntityId: placement._id }, { $setOnInsert: { companyId: placement.companyId, recipientUserId, type: 'INVOICE_DUE_REMINDER', title: 'Placement invoice is due', linkEntityType: 'Placement', linkEntityId: placement._id } }, { upsert: true }).catch(() => null); notifications += 1;
    }
  }
  return { examined: open.length, updated, notifications };
}
async function payslipReminderJob(now = new Date()) { const month = now.getUTCMonth() + 1; const year = now.getUTCFullYear(); const periods = await PayrollPeriod.find({ periodMonth: month, periodYear: year, status: { $in: ['DRAFT', 'CALCULATED', 'UNDER_REVIEW'] } }); let notifications = 0; let User; try { User = mongoose.model('User'); } catch { return { pendingPeriods: periods.length, notifications }; } for (const period of periods) { const recipients = await User.find({ companyId: period.companyId, role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null }).distinct('_id'); for (const recipientUserId of recipients) { await Notification.updateOne({ recipientUserId, type: 'PAYROLL_PENDING_REMINDER', linkEntityId: period._id }, { $setOnInsert: { companyId: period.companyId, recipientUserId, type: 'PAYROLL_PENDING_REMINDER', title: 'Payroll needs attention', linkEntityType: 'PayrollPeriod', linkEntityId: period._id } }, { upsert: true }).catch(() => null); notifications += 1; } } return { pendingPeriods: periods.length, notifications }; }
async function sessionCleanupJob(now = new Date(), retentionDays = 30) { let Session; try { Session = mongoose.model('Session'); } catch { return { deletedCount: 0 }; } const cutoff = new Date(now.getTime() - retentionDays * 86400000); const result = await Session.deleteMany({ revokedAt: { $ne: null, $lte: cutoff } }); return { deletedCount: result.deletedCount }; }
async function notificationDigestJob(now = new Date(), emailAdapter = null) { const rows = await Notification.find({ readAt: null, digestSentAt: null, createdAt: { $lte: new Date(now.getTime() - 3600000) } }).sort({ recipientUserId: 1, createdAt: 1 }).limit(5000); if (!emailAdapter?.sendDigest) return { pending: rows.length, sent: 0 }; const grouped = new Map(); for (const row of rows) { const key = String(row.recipientUserId); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); } let sent = 0; for (const [recipientUserId, notifications] of grouped) { try { await emailAdapter.sendDigest({ recipientUserId, notifications }); await Notification.updateMany({ _id: { $in: notifications.map((row) => row._id) }, digestSentAt: null }, { $set: { digestSentAt: now } }); sent += notifications.length; } catch { /* next digest retries unsent rows */ } } return { pending: rows.length, sent }; }
function registerBusinessSchedules(options = {}) {
  if (String(process.env.SCHEDULER_ENABLED || 'true') !== 'true') return [];
  // Kept lazy so importing the API does not start schedules in tests.
  const cron = require('node-cron');
  const jobs = [
    cron.schedule(process.env.INVOICE_REMINDER_CRON || '0 8 * * *', () => invoiceReminderJob().catch(options.onError || (() => {}))),
    cron.schedule(process.env.PAYSLIP_REMINDER_CRON || '0 9 25 * *', () => payslipReminderJob().catch(options.onError || (() => {}))),
    cron.schedule(process.env.SESSION_CLEANUP_CRON || '0 3 * * *', () => sessionCleanupJob().catch(options.onError || (() => {}))),
    cron.schedule(process.env.NOTIFICATION_DIGEST_CRON || '0 * * * *', () => notificationDigestJob().catch(options.onError || (() => {}))),
  ];
  return jobs;
}

module.exports = { invoiceReminderJob, payslipReminderJob, sessionCleanupJob, notificationDigestJob, registerBusinessSchedules };
