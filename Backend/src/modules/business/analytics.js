'use strict';

/*
 * Reporting primitives shared by every dashboard service. These used to live as
 * private helpers inside recruitment.service.js; the workforce overview needs the
 * same period-over-period and bucketing maths, so they moved here rather than
 * being duplicated. Nothing in this file may require operations.service or
 * recruitment.service — both import from here, so a back-import would be a cycle.
 */
const { AppError, model } = require('./support');
const { dateKeyInTimeZone, canonicalDateInTimeZone, startInstantOfDateInTimeZone, isValidTimeZone } = require('../../common/utils/dates');

// --- Date keys ---------------------------------------------------------------
// A "date key" is a calendar day as `YYYY-MM-DD`, interpreted as UTC midnight so
// string ordering and date arithmetic agree.
function addDateKeyDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const daysBetweenKeys = (from, to) => Math.round((new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) / 86400000) + 1;
const dayOfWeekForKey = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();

// --- Reporting range ---------------------------------------------------------
function dashboardReportRange(query, timeZone, now = new Date()) {
  const preset = query.preset || 'today';
  if (!['today', 'week', 'month', 'quarter', 'year', 'custom'].includes(preset)) throw new AppError('VALIDATION_ERROR', 400, 'Invalid dashboard date preset');
  const today = dateKeyInTimeZone(now, timeZone);
  let startDate = today; let endDate = today;
  if (preset === 'week') {
    const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    startDate = addDateKeyDays(today, -(day === 0 ? 6 : day - 1));
  } else if (preset === 'month') {
    startDate = `${today.slice(0, 7)}-01`;
  } else if (preset === 'quarter') {
    const month = Number(today.slice(5, 7));
    startDate = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, '0')}-01`;
  } else if (preset === 'year') {
    startDate = `${today.slice(0, 4)}-01-01`;
  } else if (preset === 'custom') {
    if (!validDateKey(query.startDate) || !validDateKey(query.endDate) || query.startDate > query.endDate) throw new AppError('VALIDATION_ERROR', 400, 'A valid custom date range is required');
    startDate = query.startDate; endDate = query.endDate;
  }
  const attendanceStart = canonicalDateInTimeZone(new Date(`${startDate}T12:00:00.000Z`), 'UTC');
  const attendanceEnd = canonicalDateInTimeZone(new Date(`${endDate}T12:00:00.000Z`), 'UTC');
  const startInstant = startInstantOfDateInTimeZone(startDate, timeZone);
  const endExclusive = startInstantOfDateInTimeZone(addDateKeyDays(endDate, 1), timeZone);
  return { preset, startDate, endDate, timeZone, attendanceStart, attendanceEnd, startInstant, endExclusive };
}

// --- Period-over-period ------------------------------------------------------
// A metric with no previous value reads as +100% when it appeared and 0% when it
// stayed at nothing, so a first-ever figure is visibly new rather than "flat".
const deltaPct = (value, previous) => (previous > 0 ? Number((((value - previous) / previous) * 100).toFixed(1)) : (value > 0 ? 100 : 0));
const metric = (value, previous, unit) => ({ value, previous, deltaPct: deltaPct(value, previous), ...(unit ? { unit } : {}) });
const ratio = (part, whole, digits = 1) => (whole > 0 ? Number(((part / whole) * 100).toFixed(digits)) : 0);

// --- Bucketing ---------------------------------------------------------------
function autoGranularity(range) {
  const span = daysBetweenKeys(range.startDate, range.endDate);
  return span <= 31 ? 'day' : span <= 180 ? 'week' : 'month';
}

// Monday-start weeks, matching the `week` preset in dashboardReportRange.
function bucketKeyFor(dateKey, granularity) {
  if (granularity === 'month') return `${dateKey.slice(0, 7)}-01`;
  if (granularity === 'week') { const day = dayOfWeekForKey(dateKey); return addDateKeyDays(dateKey, -(day === 0 ? 6 : day - 1)); }
  return dateKey;
}

function bucketKeys(range, granularity) {
  const keys = []; const seen = new Set();
  for (let cursor = range.startDate; cursor <= range.endDate; cursor = addDateKeyDays(cursor, 1)) {
    const key = bucketKeyFor(cursor, granularity);
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  return keys;
}

/*
 * Zero-fills a timeseries so a chart never draws a gap where the answer is
 * "nothing happened". `rows` are raw per-day aggregation rows; `dayOf` reads the
 * date key off one, and `apply` folds it into its bucket.
 */
function fillBuckets(rows, range, granularity, zeroRow, dayOf, apply) {
  const buckets = new Map(bucketKeys(range, granularity).map((bucket) => [bucket, { bucket, ...zeroRow() }]));
  for (const row of rows || []) {
    const target = buckets.get(bucketKeyFor(dayOf(row), granularity));
    if (target) apply(target, row);
  }
  return [...buckets.values()];
}

// Grouping by calendar day in the company timezone (rather than $dateTrunc) keeps
// this working on older MongoDB servers; week/month roll-up happens in memory.
const dayKeyExpr = (field, timeZone) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: timeZone } });

// --- Company ----------------------------------------------------------------
async function companyTimeZone(companyId) {
  const company = await model('Company').findById(companyId).select('timezone').lean();
  return isValidTimeZone(company?.timezone) ? company.timezone : 'UTC';
}

const DEFAULT_WORKDAY = Object.freeze({ workdayStartTime: null, workdayGraceMinutes: 10, standardWorkMinutes: 480, workweek: [1, 2, 3, 4, 5] });

/*
 * Workday shape with defaults applied. `workdayStartTime` deliberately stays
 * null when unset: punctuality is then reported as unavailable rather than
 * measured against a guessed shift.
 */
function workdayShape(settings = {}) {
  const workweek = Array.isArray(settings.workweek) && settings.workweek.length ? [...new Set(settings.workweek.map(Number).filter((day) => day >= 0 && day <= 6))] : DEFAULT_WORKDAY.workweek;
  return {
    workdayStartTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.workdayStartTime || '')) ? settings.workdayStartTime : null,
    workdayGraceMinutes: Number.isFinite(settings.workdayGraceMinutes) ? settings.workdayGraceMinutes : DEFAULT_WORKDAY.workdayGraceMinutes,
    standardWorkMinutes: Number.isFinite(settings.standardWorkMinutes) && settings.standardWorkMinutes > 0 ? settings.standardWorkMinutes : DEFAULT_WORKDAY.standardWorkMinutes,
    workweek: workweek.length ? workweek : DEFAULT_WORKDAY.workweek,
  };
}

// Working days in a range. There is no holiday calendar in the data model, so
// this counts workweek days only and will overcount a week containing a holiday.
function workingDaysInRange(range, workweek) {
  let count = 0;
  for (let cursor = range.startDate; cursor <= range.endDate; cursor = addDateKeyDays(cursor, 1)) if (workweek.includes(dayOfWeekForKey(cursor))) count += 1;
  return count;
}

module.exports = {
  dashboardReportRange,
  addDateKeyDays, validDateKey, daysBetweenKeys, dayOfWeekForKey,
  deltaPct, metric, ratio,
  autoGranularity, bucketKeyFor, bucketKeys, fillBuckets, dayKeyExpr,
  companyTimeZone, workdayShape, workingDaysInRange, DEFAULT_WORKDAY,
};
