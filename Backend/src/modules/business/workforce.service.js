'use strict';

/*
 * The admin workforce overview: everything the owner sees on /dashboard, plus the
 * paginated drill-downs behind each figure.
 *
 * Two deliberate shapes here:
 *  - Every rate is computed from an explicit denominator (`workingDays`,
 *    `activeHeadcount`) so an empty period reads as 0 rather than NaN.
 *  - Anything the data model cannot answer is returned as `null`, never guessed.
 *    Punctuality has no meaning until an owner sets `settings.workdayStartTime`,
 *    and there is no holiday calendar, so "absent" is measured against the
 *    configured workweek only.
 */
const { Candidate, PayrollPeriod, PayrollLine, Payslip } = require('./models');
const { AppError, objectId, model } = require('./support');
const {
  dashboardReportRange, addDateKeyDays, daysBetweenKeys, dayOfWeekForKey,
  metric, ratio, autoGranularity, fillBuckets, dayKeyExpr,
  workdayShape, workingDaysInRange,
} = require('./analytics');
const { isValidTimeZone, dateKeyInTimeZone } = require('../../common/utils/dates');

const PRESENT_STATUSES = ['WORKING', 'ON_BREAK', 'COMPLETED'];
const OPEN_STATUSES = ['WORKING', 'ON_BREAK'];
const LIST_LIMIT = 10;            // exception and movement previews; the rest is in the drill-down
const LEADERBOARD_LIMIT = 12;
const QUEUE_LIMIT = 50;
const BREAKDOWN_LIMIT = 8;        // past this a categorical palette stops separating, so fold into "Other"
const LONG_BREAK_MINUTES = 90;
const ANNIVERSARY_WINDOW_DAYS = 30;
const STALE_PENDING_DAYS = 5;
const TENURE_BANDS = [
  { key: 'LT_3M', label: 'Under 3 months', from: 0, to: 90 },
  { key: 'M3_6', label: '3–6 months', from: 90, to: 180 },
  { key: 'M6_12', label: '6–12 months', from: 180, to: 365 },
  { key: 'Y1_2', label: '1–2 years', from: 365, to: 730 },
  { key: 'Y2_5', label: '2–5 years', from: 730, to: 1825 },
  { key: 'Y5_PLUS', label: 'Over 5 years', from: 1825, to: Infinity },
];
const LEAVE_AGE_BANDS = [
  { key: 'LT_2D', label: 'Under 2 days', from: 0, to: 2 },
  { key: 'D2_5', label: '2–5 days', from: 2, to: 5 },
  { key: 'D5_10', label: '5–10 days', from: 5, to: 10 },
  { key: 'D10_PLUS', label: 'Over 10 days', from: 10, to: Infinity },
];

const toNumber = (value) => (value == null ? 0 : Number(value.toString()));
const round1 = (value) => Number(Number(value || 0).toFixed(1));
const minutesToHours = (minutes) => round1(Number(minutes || 0) / 60);
const displayName = (employee) => (employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') || employee.workEmail || employee.employeeCode || 'Unknown employee' : 'Unknown employee');
const addMinutesToClock = (clock, minutes) => {
  const [hour, minute] = String(clock).split(':').map(Number);
  const total = Math.min(24 * 60 - 1, hour * 60 + minute + Number(minutes || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const bandFor = (bands, value) => bands.find((band) => value >= band.from && value < band.to) || bands.at(-1);
// Days-ago window for a band, as a Mongo range on a date field. The `from` edge is
// the most recent instant in the band; the `to` edge is omitted when the band is
// open-ended, because there is no oldest date to bound it with.
const daysAgoRange = (band, now) => ({
  $lte: new Date(now.getTime() - band.from * 86400000),
  ...(Number.isFinite(band.to) && band.to < 36500 ? { $gt: new Date(now.getTime() - band.to * 86400000) } : {}),
});

// Past BREAKDOWN_LIMIT slices a chart stops being readable, so the tail becomes
// one "Other" row that still carries its true count.
function foldOther(rows, limit = BREAKDOWN_LIMIT) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const tail = sorted.slice(limit - 1);
  return [...head, { key: '__OTHER__', label: `Other (${tail.length})`, count: tail.reduce((sum, row) => sum + row.count, 0), activeCount: tail.reduce((sum, row) => sum + (row.activeCount || 0), 0) }];
}

// --- Existing contract -------------------------------------------------------
// Unchanged: the attendance register rows on the dashboard and the drill-downs
// both derive login/logout and minutes the same way.
function attendanceSummary(record, now) {
  const segments = record.segments || [];
  const loginAt = segments.reduce((earliest, segment) => !earliest || segment.startedAt < earliest ? segment.startedAt : earliest, null);
  const ended = segments.map((segment) => segment.endedAt).filter(Boolean);
  const logoutAt = record.status === 'COMPLETED' && ended.length ? ended.reduce((latest, value) => value > latest ? value : latest) : null;
  const minutes = (type) => segments.reduce((total, segment) => {
    if (segment.type !== type) return total;
    const start = new Date(segment.startedAt); const end = segment.endedAt ? new Date(segment.endedAt) : now;
    return total + Math.max(0, Math.floor((end - start) / 60000));
  }, 0);
  return {
    _id: record._id, employeeId: record.employeeId?._id || record.employeeId,
    employeeName: record.employeeId ? [record.employeeId.firstName, record.employeeId.lastName].filter(Boolean).join(' ') || record.employeeId.employeeCode : 'Unknown employee',
    date: record.workDate, loginAt, logoutAt, status: record.status, workedMinutes: minutes('WORK'), breakMinutes: minutes('BREAK'),
  };
}

// --- Shared request context --------------------------------------------------
/*
 * Resolves timezone, workday shape, the reporting range, the equal-length
 * comparison window and the employee scope once, so the overview and every
 * drill-down read the same numbers from the same filters.
 */
async function reportContext(actor, query, now) {
  const Company = model('Company'); const Employee = model('Employee');
  const companyId = objectId(String(actor.companyId));
  const company = await Company.findById(companyId).select('timezone settings').lean();
  const timeZone = isValidTimeZone(company?.timezone) ? company.timezone : 'UTC';
  const workday = workdayShape(company?.settings || {});
  const range = dashboardReportRange(query, timeZone, now);
  const span = daysBetweenKeys(range.startDate, range.endDate);
  const comparison = dashboardReportRange({ preset: 'custom', startDate: addDateKeyDays(range.startDate, -span), endDate: addDateKeyDays(range.startDate, -1) }, timeZone, now);
  const granularity = ['day', 'week', 'month'].includes(query.granularity) ? query.granularity : autoGranularity(range);
  const todayKey = dateKeyInTimeZone(now, timeZone);
  const todayCanonical = new Date(`${todayKey}T00:00:00.000Z`);

  // A department or employee filter narrows to a concrete id set once; an empty
  // set is a real answer (nobody matched) and every block then reads as empty.
  let scopeIds = null; let scopeLabel = 'All employees';
  if (query.employeeId) {
    const employee = await Employee.findOne({ _id: objectId(String(query.employeeId), 'employeeId'), companyId, deletedAt: null }).select('firstName lastName workEmail employeeCode').lean();
    if (!employee) throw new AppError('REFERENCED_ENTITY_NOT_FOUND', 404, 'Employee was not found in this company');
    scopeIds = [employee._id]; scopeLabel = displayName(employee);
  } else if (query.department) {
    scopeIds = await Employee.find({ companyId, department: query.department, deletedAt: null }).distinct('_id');
    scopeLabel = query.department;
  }
  return {
    companyId, timeZone, workday, range, comparison, granularity, span, now, todayKey, todayCanonical,
    scopeIds, scopeLabel,
    attendanceScope: scopeIds ? { employeeId: { $in: scopeIds } } : {},
    employeeScope: scopeIds ? { _id: { $in: scopeIds } } : {},
    workingDays: workingDaysInRange(range, workday.workweek),
    lateAfter: workday.workdayStartTime ? addMinutesToClock(workday.workdayStartTime, workday.workdayGraceMinutes) : null,
  };
}

// --- Attendance --------------------------------------------------------------
// Minutes come from the segments, counting an unclosed segment up to `now`, which
// is what the attendance register shows for someone still on the clock.
const segmentMinutes = (type, now) => ({
  $sum: { $map: {
    input: { $filter: { input: { $ifNull: ['$segments', []] }, as: 'segment', cond: { $eq: ['$$segment.type', type] } } },
    as: 'segment',
    in: { $max: [0, { $floor: { $divide: [{ $subtract: [{ $ifNull: ['$$segment.endedAt', now] }, '$$segment.startedAt'] }, 60000] } }] },
  } },
});

function attendanceDeriveStages(context) {
  const { now, timeZone, todayCanonical, workday, lateAfter } = context;
  return [
    { $addFields: {
      dayKey: dayKeyExpr('$workDate', 'UTC'),
      workMinutes: segmentMinutes('WORK', now),
      breakMinutesTotal: segmentMinutes('BREAK', now),
      firstLoginAt: { $min: '$segments.startedAt' },
      correctionCount: { $size: { $ifNull: ['$corrections', []] } },
    } },
    { $addFields: {
      present: { $cond: [{ $in: ['$status', PRESENT_STATUSES] }, 1, 0] },
      // A day left open in the past is a missing clock-out; still open today is
      // simply someone at work, so today is excluded.
      missingLogout: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $lt: ['$workDate', todayCanonical] }] }, 1, 0] },
      workingNow: { $cond: [{ $and: [{ $eq: ['$status', 'WORKING'] }, { $eq: ['$workDate', todayCanonical] }] }, 1, 0] },
      onBreakNow: { $cond: [{ $and: [{ $eq: ['$status', 'ON_BREAK'] }, { $eq: ['$workDate', todayCanonical] }] }, 1, 0] },
      zeroHour: { $cond: [{ $and: [{ $eq: ['$status', 'COMPLETED'] }, { $eq: ['$workMinutes', 0] }] }, 1, 0] },
      fullDay: { $cond: [{ $gte: ['$workMinutes', workday.standardWorkMinutes] }, 1, 0] },
      shortDay: { $cond: [{ $and: [{ $eq: ['$status', 'COMPLETED'] }, { $gt: ['$workMinutes', 0] }, { $lt: ['$workMinutes', workday.standardWorkMinutes] }] }, 1, 0] },
      overtime: { $cond: [{ $gt: ['$workMinutes', workday.standardWorkMinutes] }, 1, 0] },
      longBreak: { $cond: [{ $gt: ['$breakMinutesTotal', LONG_BREAK_MINUTES] }, 1, 0] },
      corrected: { $cond: [{ $gt: ['$correctionCount', 0] }, 1, 0] },
      loginClock: { $cond: [{ $gt: [{ $ifNull: ['$firstLoginAt', null] }, null] }, { $dateToString: { format: '%H:%M', date: '$firstLoginAt', timezone: timeZone } }, null] },
    } },
    { $addFields: {
      // HH:MM strings compare correctly lexicographically, so no extra date maths.
      late: lateAfter ? { $cond: [{ $and: [{ $ne: ['$loginClock', null] }, { $gt: ['$loginClock', lateAfter] }] }, 1, 0] } : 0,
      punctual: lateAfter ? { $cond: [{ $and: [{ $ne: ['$loginClock', null] }, { $lte: ['$loginClock', lateAfter] }] }, 1, 0] } : 0,
    } },
  ];
}

const attendanceMatch = (context, range) => ({ companyId: context.companyId, workDate: { $gte: range.attendanceStart, $lte: range.attendanceEnd }, ...context.attendanceScope });

const TOTALS_GROUP = {
  $group: {
    _id: null, records: { $sum: 1 }, presentRecords: { $sum: '$present' },
    presentEmployees: { $addToSet: { $cond: [{ $eq: ['$present', 1] }, '$employeeId', '$$REMOVE'] } },
    workedMinutes: { $sum: '$workMinutes' }, breakMinutes: { $sum: '$breakMinutesTotal' },
    fullDays: { $sum: '$fullDay' }, shortDays: { $sum: '$shortDay' }, overtimeDays: { $sum: '$overtime' },
    zeroHourDays: { $sum: '$zeroHour' }, longBreak: { $sum: '$longBreak' }, corrected: { $sum: '$corrected' },
    missingLogout: { $sum: '$missingLogout' }, workingNow: { $sum: '$workingNow' }, onBreakNow: { $sum: '$onBreakNow' },
    lateDays: { $sum: '$late' }, punctualDays: { $sum: '$punctual' },
  },
};

const exceptionBranch = (flag, sort) => [
  { $match: { [flag]: 1 } },
  { $sort: sort },
  { $limit: LIST_LIMIT },
  { $project: { employeeId: 1, workDate: 1, status: 1, workMinutes: 1, breakMinutesTotal: 1, firstLoginAt: 1, correctionReason: 1, correctedBy: 1, corrections: { $slice: [{ $ifNull: ['$corrections', []] }, -1] } } },
];

async function attendanceFacets(context) {
  const Attendance = model('AttendanceRecord');
  const [result] = await Attendance.aggregate([
    { $match: attendanceMatch(context, context.range) },
    ...attendanceDeriveStages(context),
    { $facet: {
      daily: [
        { $group: {
          _id: '$dayKey',
          presentEmployees: { $addToSet: { $cond: [{ $eq: ['$present', 1] }, '$employeeId', '$$REMOVE'] } },
          workedMinutes: { $sum: '$workMinutes' }, breakMinutes: { $sum: '$breakMinutesTotal' },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } }, missingLogout: { $sum: '$missingLogout' },
        } },
        { $project: { present: { $size: '$presentEmployees' }, workedMinutes: 1, breakMinutes: 1, completed: 1, missingLogout: 1 } },
      ],
      perEmployee: [
        { $group: {
          _id: '$employeeId', presentDays: { $sum: '$present' }, workedMinutes: { $sum: '$workMinutes' }, breakMinutes: { $sum: '$breakMinutesTotal' },
          fullDays: { $sum: '$fullDay' }, overtimeDays: { $sum: '$overtime' }, lateDays: { $sum: '$late' }, punctualDays: { $sum: '$punctual' },
        } },
      ],
      totals: [TOTALS_GROUP],
      missingLogoutRows: exceptionBranch('missingLogout', { workDate: -1, _id: -1 }),
      longBreakRows: exceptionBranch('longBreak', { breakMinutesTotal: -1, _id: -1 }),
      zeroHourRows: exceptionBranch('zeroHour', { workDate: -1, _id: -1 }),
      shortDayRows: exceptionBranch('shortDay', { workMinutes: 1, _id: -1 }),
      lateRows: context.lateAfter ? exceptionBranch('late', { workDate: -1, _id: -1 }) : [{ $match: { _id: { $exists: false } } }],
      correctedRows: exceptionBranch('corrected', { workDate: -1, _id: -1 }),
    } },
  ]);
  return result || { daily: [], perEmployee: [], totals: [], missingLogoutRows: [], longBreakRows: [], zeroHourRows: [], shortDayRows: [], lateRows: [], correctedRows: [] };
}

async function attendanceTotalsFor(context, range) {
  const Attendance = model('AttendanceRecord');
  const [row] = await Attendance.aggregate([
    { $match: attendanceMatch(context, range) },
    ...attendanceDeriveStages(context),
    TOTALS_GROUP,
  ]);
  return row || null;
}

const emptyTotals = { records: 0, presentRecords: 0, presentEmployees: [], workedMinutes: 0, breakMinutes: 0, fullDays: 0, shortDays: 0, overtimeDays: 0, zeroHourDays: 0, longBreak: 0, corrected: 0, missingLogout: 0, workingNow: 0, onBreakNow: 0, lateDays: 0, punctualDays: 0 };

// --- Leave -------------------------------------------------------------------
const leaveOverlapFilter = (context, range) => ({ companyId: context.companyId, startDate: { $lte: range.attendanceEnd }, endDate: { $gte: range.attendanceStart }, ...context.attendanceScope });

// Leave days are counted as the portion of the request that falls inside the
// reporting range, so a request straddling the boundary is not double-counted.
function overlapDayKeys(request, range) {
  const from = dateKeyInTimeZone(request.startDate, 'UTC') < range.startDate ? range.startDate : dateKeyInTimeZone(request.startDate, 'UTC');
  const to = dateKeyInTimeZone(request.endDate, 'UTC') > range.endDate ? range.endDate : dateKeyInTimeZone(request.endDate, 'UTC');
  const keys = [];
  for (let cursor = from; cursor <= to; cursor = addDateKeyDays(cursor, 1)) keys.push(cursor);
  return keys;
}

// --- Workforce composition ---------------------------------------------------
async function compositionFacets(context) {
  const Employee = model('Employee');
  const { now, range } = context;
  const groupBy = (field, fallback) => [
    { $group: { _id: { $ifNull: [field, fallback] }, count: { $sum: 1 }, activeCount: { $sum: { $cond: [{ $eq: ['$employmentStatus', 'ACTIVE'] }, 1, 0] } } } },
  ];
  // Anniversary month-days for the coming window, matched as strings so this needs
  // no per-document date maths and stays index-friendly enough at this scale.
  const anniversaryKeys = [];
  for (let offset = 0; offset < ANNIVERSARY_WINDOW_DAYS; offset += 1) anniversaryKeys.push(addDateKeyDays(context.todayKey, offset).slice(5));
  const joinedWindow = { $gte: range.attendanceStart, $lt: new Date(`${addDateKeyDays(range.endDate, 1)}T00:00:00.000Z`) };

  const [result] = await Employee.aggregate([
    { $match: { companyId: context.companyId, deletedAt: null, ...context.employeeScope } },
    { $addFields: { tenureDays: { $cond: [{ $ifNull: ['$joiningDate', false] }, { $max: [0, { $divide: [{ $subtract: [now, '$joiningDate'] }, 86400000] }] }, null] } } },
    { $facet: {
      byDepartment: groupBy('$department', 'Unassigned'),
      byDesignation: groupBy('$designation', 'Unassigned'),
      bySalaryType: groupBy('$salaryType', 'SALARIED'),
      byStatus: groupBy('$employmentStatus', 'ACTIVE'),
      tenure: [
        { $match: { employmentStatus: 'ACTIVE', tenureDays: { $ne: null } } },
        { $bucket: { groupBy: '$tenureDays', boundaries: [0, 90, 180, 365, 730, 1825], default: 'Y5_PLUS', output: { count: { $sum: 1 } } } },
      ],
      joiners: [
        { $match: { joiningDate: joinedWindow } },
        { $sort: { joiningDate: -1 } }, { $limit: LIST_LIMIT },
        { $project: { firstName: 1, lastName: 1, workEmail: 1, employeeCode: 1, department: 1, designation: 1, joiningDate: 1 } },
      ],
      joinerCount: [{ $match: { joiningDate: joinedWindow } }, { $count: 'count' }],
      leavers: [
        { $match: { employmentStatus: 'TERMINATED', terminationDate: joinedWindow } },
        { $sort: { terminationDate: -1 } }, { $limit: LIST_LIMIT },
        { $project: { firstName: 1, lastName: 1, workEmail: 1, employeeCode: 1, department: 1, joiningDate: 1, terminationDate: 1 } },
      ],
      leaverCount: [{ $match: { employmentStatus: 'TERMINATED', terminationDate: joinedWindow } }, { $count: 'count' }],
      anniversaries: [
        { $match: { employmentStatus: 'ACTIVE', joiningDate: { $ne: null, $lt: new Date(`${context.todayKey}T00:00:00.000Z`) } } },
        { $addFields: { monthDay: { $dateToString: { format: '%m-%d', date: '$joiningDate', timezone: 'UTC' } } } },
        { $match: { monthDay: { $in: anniversaryKeys } } },
        { $project: { firstName: 1, lastName: 1, workEmail: 1, employeeCode: 1, department: 1, joiningDate: 1, monthDay: 1 } },
        { $limit: LIST_LIMIT },
      ],
      activeHeadcount: [{ $match: { employmentStatus: 'ACTIVE' } }, { $count: 'count' }],
    } },
  ]);
  return result || {};
}

const labelFor = (value) => String(value ?? '').replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
const breakdownRows = (rows) => foldOther((rows || []).map((row) => ({ key: String(row._id), label: labelFor(row._id), count: row.count, activeCount: row.activeCount || 0 })));

function tenureRows(rows) {
  const byBoundary = new Map((rows || []).map((row) => [String(row._id), row.count]));
  return TENURE_BANDS.map((band) => ({ key: band.key, label: band.label, count: byBoundary.get(band.key === 'Y5_PLUS' ? 'Y5_PLUS' : String(band.from)) || 0 }));
}

// --- Payroll -----------------------------------------------------------------
const PERIOD_LABEL = (period) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][period.periodMonth - 1]} ${period.periodYear}`;

async function payrollSnapshot(context) {
  const periods = await PayrollPeriod.find({ companyId: context.companyId }).sort({ periodYear: -1, periodMonth: -1 }).limit(6).select('periodMonth periodYear status employeeIds approvedAt').lean();
  if (!periods.length) return { latest: null, history: [] };
  const periodIds = periods.map((period) => period._id);
  const [lineTotals, payslipCounts] = await Promise.all([
    PayrollLine.aggregate([
      { $match: { companyId: context.companyId, payrollPeriodId: { $in: periodIds }, isCurrent: true } },
      { $group: { _id: '$payrollPeriodId', employeeCount: { $sum: 1 }, grossPay: { $sum: { $toDouble: '$grossPay' } }, netPay: { $sum: { $toDouble: '$netPay' } }, deductions: { $sum: { $toDouble: '$deductions' } } } },
    ]),
    // Payslips reach a period through their line, so the ids are resolved first
    // rather than joining a collection on every dashboard load.
    PayrollLine.find({ companyId: context.companyId, payrollPeriodId: periodIds[0], isCurrent: true }).distinct('_id')
      .then((lineIds) => (lineIds.length ? Payslip.aggregate([{ $match: { companyId: context.companyId, payrollLineId: { $in: lineIds } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]) : [])),
  ]);
  const totalsById = new Map(lineTotals.map((row) => [String(row._id), row]));
  const latestPeriod = periods[0];
  const latestTotals = totalsById.get(String(latestPeriod._id)) || { employeeCount: 0, grossPay: 0, netPay: 0, deductions: 0 };
  const slips = Object.fromEntries(payslipCounts.map((row) => [row._id, row.count]));
  return {
    latest: {
      _id: latestPeriod._id, periodMonth: latestPeriod.periodMonth, periodYear: latestPeriod.periodYear, periodLabel: PERIOD_LABEL(latestPeriod),
      status: latestPeriod.status, employeeCount: latestTotals.employeeCount || (latestPeriod.employeeIds || []).length,
      grossPay: round1(latestTotals.grossPay), netPay: round1(latestTotals.netPay), deductions: round1(latestTotals.deductions),
      payslips: {
        draft: slips.DRAFT || 0, approved: slips.APPROVED || 0, published: slips.PUBLISHED || 0, withdrawn: slips.WITHDRAWN || 0,
        total: Object.values(slips).reduce((sum, count) => sum + count, 0),
      },
    },
    history: [...periods].reverse().map((period) => ({ periodId: period._id, periodLabel: PERIOD_LABEL(period), status: period.status, netPay: round1((totalsById.get(String(period._id)) || {}).netPay || 0) })),
  };
}

// --- Overview ----------------------------------------------------------------
/*
 * Extends the long-standing admin dashboard payload. Every key the previous
 * contract returned (`range`, `cards`, `attendance`, `workingHours`,
 * `performance`) is still here with the same shape; the workforce blocks are
 * additive. `performance` is the one behavioural change: its recruiter
 * aggregation is expensive and the overview no longer renders it, so it is only
 * computed when the caller asks with `include=performance`.
 */
async function adminDashboard(actor, query, now = new Date()) {
  const Employee = model('Employee'); const Attendance = model('AttendanceRecord'); const Leave = model('LeaveRequest'); const LeaveType = model('LeaveType');
  const context = await reportContext(actor, query, now);
  const { companyId, range, comparison, timeZone, workday, granularity } = context;
  const excluded = String(query.exclude || '').split(',').map((part) => part.trim());
  const includePerformance = !excluded.includes('performance');

  const attendancePage = Math.max(1, Number(query.attendancePage) || 1);
  const attendanceLimit = Math.min(100, Math.max(1, Number(query.attendanceLimit) || 25));
  const presentFilter = { ...attendanceMatch(context, range), status: { $in: PRESENT_STATUSES } };
  const leaveNow = leaveOverlapFilter(context, range);
  const leavePrevious = leaveOverlapFilter(context, comparison);
  const pointInTime = (instant) => ({ companyId, deletedAt: null, ...context.employeeScope, joiningDate: { $lte: instant }, $or: [{ terminationDate: null }, { terminationDate: { $gt: instant } }] });
  const rangeEndInstant = new Date(`${addDateKeyDays(range.endDate, 1)}T00:00:00.000Z`);
  const comparisonEndInstant = new Date(`${addDateKeyDays(comparison.endDate, 1)}T00:00:00.000Z`);

  const [
    headcount, activeHeadcount, workingIds, onLeaveIds, pendingLeave, approvedLeave,
    attendanceRecords, attendanceTotal, workingHourCounts,
    facets, previousTotals, composition, payroll,
    leaveRequests, leaveTypes, leaveStatusCounts,
    previousOnLeaveIds, previousPending,
    headcountNow, headcountPrevious,
    departments, roster, upcomingLeave,
  ] = await Promise.all([
    Employee.countDocuments({ companyId, deletedAt: null, ...context.employeeScope }),
    Employee.countDocuments({ companyId, employmentStatus: 'ACTIVE', deletedAt: null, ...context.employeeScope }),
    Attendance.distinct('employeeId', presentFilter),
    Leave.distinct('employeeId', { ...leaveNow, status: 'APPROVED' }),
    Leave.countDocuments({ ...leaveNow, status: 'PENDING' }),
    Leave.countDocuments({ ...leaveNow, status: 'APPROVED' }),
    Attendance.find(presentFilter).populate('employeeId', 'employeeCode firstName lastName').sort({ workDate: -1, 'segments.startedAt': -1, _id: -1 }).skip((attendancePage - 1) * attendanceLimit).limit(attendanceLimit).lean(),
    Attendance.countDocuments(presentFilter),
    Attendance.aggregate([
      { $match: presentFilter }, { $unwind: '$segments' },
      { $project: { employeeId: 1, type: '$segments.type', minutes: { $max: [0, { $floor: { $divide: [{ $subtract: [{ $ifNull: ['$segments.endedAt', now] }, '$segments.startedAt'] }, 60000] } }] } } },
      { $group: { _id: { employeeId: '$employeeId', type: '$type' }, minutes: { $sum: '$minutes' } } },
    ]),
    attendanceFacets(context),
    attendanceTotalsFor(context, comparison),
    compositionFacets(context),
    payrollSnapshot(context),
    Leave.find({ ...leaveNow, status: { $in: ['PENDING', 'APPROVED'] } }).select('employeeId leaveTypeId startDate endDate status createdAt').sort({ startDate: 1 }).limit(5000).lean(),
    LeaveType.find({ companyId, deletedAt: null }).select('name isPaid').lean(),
    Leave.aggregate([{ $match: leaveNow }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Leave.distinct('employeeId', { ...leavePrevious, status: 'APPROVED' }),
    Leave.countDocuments({ ...leavePrevious, status: 'PENDING' }),
    Employee.countDocuments(pointInTime(rangeEndInstant)),
    Employee.countDocuments(pointInTime(comparisonEndInstant)),
    Employee.distinct('department', { companyId, deletedAt: null }),
    Employee.find({ companyId, deletedAt: null }).select('firstName lastName workEmail employeeCode department').sort({ firstName: 1, lastName: 1 }).limit(500).lean(),
    Leave.find({ companyId, ...context.attendanceScope, status: 'APPROVED', endDate: { $gte: context.todayCanonical }, startDate: { $lte: new Date(`${addDateKeyDays(context.todayKey, ANNIVERSARY_WINDOW_DAYS)}T00:00:00.000Z`) } }).select('employeeId leaveTypeId startDate endDate status').sort({ startDate: 1 }).limit(LIST_LIMIT).lean(),
  ]);

  const totals = facets.totals[0] || emptyTotals;
  const previous = previousTotals || emptyTotals;
  const presentEmployeeCount = (totals.presentEmployees || []).length;
  const previousPresentCount = (previous.presentEmployees || []).length;
  const activeCount = composition.activeHeadcount?.[0]?.count ?? activeHeadcount;
  const joiners = composition.joinerCount?.[0]?.count || 0;
  const leavers = composition.leaverCount?.[0]?.count || 0;

  // Presence is measured in employee-days: how many of the possible working days
  // across the active roster were actually worked.
  const possibleDays = activeCount * context.workingDays;
  const previousPossibleDays = activeCount * workingDaysInRange(comparison, workday.workweek);
  const perPresentDay = (minutes, days) => (days > 0 ? round1(minutes / days / 60) : 0);

  const kpis = {
    headcount: metric(headcountNow, headcountPrevious),
    activeHeadcount: metric(activeCount, activeCount),
    joiners: metric(joiners, 0),
    leavers: metric(leavers, 0),
    attritionRate: metric(ratio(leavers, activeCount + leavers), 0, 'percent'),
    presenceRate: possibleDays > 0 ? metric(ratio(totals.presentRecords, possibleDays), ratio(previous.presentRecords, previousPossibleDays), 'percent') : null,
    presentEmployees: metric(presentEmployeeCount, previousPresentCount),
    avgWorkedHours: metric(perPresentDay(totals.workedMinutes, totals.presentRecords), perPresentDay(previous.workedMinutes, previous.presentRecords), 'hours'),
    avgBreakHours: metric(perPresentDay(totals.breakMinutes, totals.presentRecords), perPresentDay(previous.breakMinutes, previous.presentRecords), 'hours'),
    fullDayRate: metric(ratio(totals.fullDays, totals.presentRecords), ratio(previous.fullDays, previous.presentRecords), 'percent'),
    overtimeDays: metric(totals.overtimeDays, previous.overtimeDays),
    onLeave: metric(onLeaveIds.length, previousOnLeaveIds.length),
    pendingLeave: metric(pendingLeave, previousPending),
    // Null until an owner sets a shift start: a punctuality figure with no shift
    // to measure against would be fiction, so the tile is omitted instead.
    punctualityRate: workday.workdayStartTime
      ? metric(ratio(totals.punctualDays, totals.punctualDays + totals.lateDays), ratio(previous.punctualDays, previous.punctualDays + previous.lateDays), 'percent')
      : null,
    lateDays: workday.workdayStartTime ? metric(totals.lateDays, previous.lateDays) : null,
  };

  // --- Timeseries: present / on leave / absent per bucket
  const onLeaveByDay = new Map();
  for (const request of leaveRequests) {
    if (request.status !== 'APPROVED') continue;
    for (const dayKey of overlapDayKeys(request, range)) {
      if (!onLeaveByDay.has(dayKey)) onLeaveByDay.set(dayKey, new Set());
      onLeaveByDay.get(dayKey).add(String(request.employeeId));
    }
  }
  const presentByDay = new Map(facets.daily.map((row) => [row._id, row]));
  const dayRows = [];
  for (let cursor = range.startDate; cursor <= range.endDate; cursor = addDateKeyDays(cursor, 1)) {
    const attendance = presentByDay.get(cursor);
    const present = attendance?.present || 0;
    const onLeave = onLeaveByDay.get(cursor)?.size || 0;
    const isWorkday = workday.workweek.includes(dayOfWeekForKey(cursor));
    dayRows.push({
      day: cursor, present, onLeave,
      absent: isWorkday ? Math.max(0, activeCount - present - onLeave) : 0,
      workedHours: minutesToHours(attendance?.workedMinutes || 0), breakHours: minutesToHours(attendance?.breakMinutes || 0),
      completed: attendance?.completed || 0, missingLogout: attendance?.missingLogout || 0,
      workdays: isWorkday ? 1 : 0,
    });
  }
  const zeroBucket = () => ({ present: 0, onLeave: 0, absent: 0, workedHours: 0, breakHours: 0, completed: 0, missingLogout: 0, workdays: 0 });
  const timeseries = fillBuckets(dayRows, range, granularity, zeroBucket, (row) => row.day, (bucket, row) => {
    // Headcount-style measures average across the bucket's days; volumes add up.
    bucket.present += row.present; bucket.onLeave += row.onLeave; bucket.absent += row.absent;
    bucket.workedHours = round1(bucket.workedHours + row.workedHours); bucket.breakHours = round1(bucket.breakHours + row.breakHours);
    bucket.completed += row.completed; bucket.missingLogout += row.missingLogout; bucket.workdays += row.workdays;
  }).map((bucket) => (granularity === 'day' ? bucket : {
    ...bucket,
    present: Math.round(bucket.present / Math.max(1, bucket.workdays)),
    onLeave: Math.round(bucket.onLeave / Math.max(1, bucket.workdays)),
    absent: Math.round(bucket.absent / Math.max(1, bucket.workdays)),
  }));

  // --- Names for every employee id the payload mentions, in one lookup
  const perEmployee = facets.perEmployee;
  const exceptionRows = [...facets.missingLogoutRows, ...facets.longBreakRows, ...facets.zeroHourRows, ...facets.shortDayRows, ...facets.lateRows, ...facets.correctedRows];
  const hoursByEmployee = new Map();
  for (const row of workingHourCounts) {
    const id = String(row._id.employeeId); const current = hoursByEmployee.get(id) || { workedMinutes: 0, breakMinutes: 0 };
    current[row._id.type === 'WORK' ? 'workedMinutes' : 'breakMinutes'] = row.minutes; hoursByEmployee.set(id, current);
  }
  const [neverClockedIn, neverClockedInCount, nameRows] = await Promise.all([
    Employee.find({ companyId, employmentStatus: 'ACTIVE', deletedAt: null, ...context.employeeScope, _id: { $nin: totals.presentEmployees || [] } }).select('firstName lastName workEmail employeeCode department joiningDate').limit(LIST_LIMIT).lean(),
    Employee.countDocuments({ companyId, employmentStatus: 'ACTIVE', deletedAt: null, ...context.employeeScope, _id: { $nin: totals.presentEmployees || [] } }),
    (() => {
      const ids = [...new Set([...perEmployee.map((row) => String(row._id)), ...exceptionRows.map((row) => String(row.employeeId)), ...leaveRequests.map((row) => String(row.employeeId)), ...upcomingLeave.map((row) => String(row.employeeId)), ...hoursByEmployee.keys()])].filter(Boolean);
      return ids.length ? Employee.find({ companyId, _id: { $in: ids.map((id) => objectId(id)) } }).select('firstName lastName workEmail employeeCode department designation').lean() : [];
    })(),
  ]);
  const employeeById = new Map(nameRows.map((employee) => [String(employee._id), employee]));
  const nameOf = (id) => displayName(employeeById.get(String(id)));
  const departmentOf = (id) => employeeById.get(String(id))?.department || null;

  // --- Leaderboards
  const leaderRows = perEmployee.map((row) => ({
    employeeId: row._id, employeeName: nameOf(row._id), department: departmentOf(row._id),
    presentDays: row.presentDays, workedMinutes: row.workedMinutes, breakMinutes: row.breakMinutes,
    workedHours: minutesToHours(row.workedMinutes), breakHours: minutesToHours(row.breakMinutes),
    fullDays: row.fullDays, overtimeDays: row.overtimeDays, lateDays: row.lateDays,
    avgWorkedMinutes: row.presentDays > 0 ? Math.round(row.workedMinutes / row.presentDays) : 0,
    presenceRate: ratio(row.presentDays, context.workingDays),
  }));
  const byPresence = [...leaderRows].sort((a, b) => b.presenceRate - a.presenceRate || b.workedMinutes - a.workedMinutes || a.employeeName.localeCompare(b.employeeName));

  // --- Leave posture
  const leaveTypeById = new Map(leaveTypes.map((type) => [String(type._id), type]));
  const daysByType = new Map();
  const pendingRows = [];
  for (const request of leaveRequests) {
    const days = overlapDayKeys(request, range).length;
    const typeId = String(request.leaveTypeId);
    const bucket = daysByType.get(typeId) || { requests: 0, days: 0 };
    bucket.requests += 1; bucket.days += days; daysByType.set(typeId, bucket);
    const row = {
      _id: request._id, employeeId: request.employeeId, employeeName: nameOf(request.employeeId),
      leaveTypeName: leaveTypeById.get(typeId)?.name || 'Leave',
      startDate: request.startDate, endDate: request.endDate, days, status: request.status, requestedAt: request.createdAt,
    };
    if (request.status === 'PENDING') pendingRows.push({ ...row, ageDays: Math.max(0, Math.floor((now - new Date(request.createdAt)) / 86400000)) });
  }
  pendingRows.sort((a, b) => b.ageDays - a.ageDays);
  const upcomingRows = upcomingLeave.map((request) => ({
    _id: request._id, employeeId: request.employeeId, employeeName: nameOf(request.employeeId),
    leaveTypeName: leaveTypeById.get(String(request.leaveTypeId))?.name || 'Leave',
    startDate: request.startDate, endDate: request.endDate, status: request.status,
    days: Math.max(1, Math.round((new Date(request.endDate) - new Date(request.startDate)) / 86400000) + 1),
  }));
  const agingCounts = new Map(LEAVE_AGE_BANDS.map((band) => [band.key, 0]));
  for (const row of pendingRows) { const band = bandFor(LEAVE_AGE_BANDS, row.ageDays); agingCounts.set(band.key, agingCounts.get(band.key) + 1); }

  const leave = {
    byType: [...daysByType.entries()].map(([typeId, bucket]) => ({ leaveTypeId: typeId, label: leaveTypeById.get(typeId)?.name || 'Leave', isPaid: leaveTypeById.get(typeId)?.isPaid ?? null, requests: bucket.requests, days: bucket.days })).sort((a, b) => b.days - a.days),
    byStatus: leaveStatusCounts.map((row) => ({ key: row._id, label: labelFor(row._id), count: row.count })).sort((a, b) => b.count - a.count),
    queue: {
      pending: pendingRows.length,
      oldestPendingDays: pendingRows[0]?.ageDays ?? 0,
      stale: pendingRows.filter((row) => row.ageDays >= STALE_PENDING_DAYS).length,
      aging: LEAVE_AGE_BANDS.map((band) => ({ key: band.key, label: band.label, count: agingCounts.get(band.key) })),
      items: pendingRows.slice(0, QUEUE_LIMIT),
    },
    upcoming: upcomingRows,
  };

  // --- Exceptions
  const exceptionRow = (row) => ({
    attendanceId: row._id, employeeId: row.employeeId, employeeName: nameOf(row.employeeId), workDate: row.workDate, status: row.status,
    workedMinutes: row.workMinutes, breakMinutes: row.breakMinutesTotal, loginAt: row.firstLoginAt || null,
    correctionReason: row.correctionReason || row.corrections?.[0]?.reason || null, correctedAt: row.corrections?.[0]?.correctedAt || null,
  });
  const exceptions = {
    counts: {
      missingLogout: totals.missingLogout, currentlyWorking: totals.workingNow, onBreakNow: totals.onBreakNow,
      zeroHourDays: totals.zeroHourDays, longBreak: totals.longBreak, shortDays: totals.shortDays,
      overtimeDays: totals.overtimeDays, correctedRecords: totals.corrected,
      lateDays: workday.workdayStartTime ? totals.lateDays : null,
      stalePendingLeave: leave.queue.stale, neverClockedIn: neverClockedInCount,
    },
    missingLogout: facets.missingLogoutRows.map(exceptionRow),
    longBreak: facets.longBreakRows.map(exceptionRow),
    zeroHour: facets.zeroHourRows.map(exceptionRow),
    shortDay: facets.shortDayRows.map(exceptionRow),
    late: facets.lateRows.map(exceptionRow),
    corrected: facets.correctedRows.map(exceptionRow),
    neverClockedIn: neverClockedIn.map((employee) => ({ employeeId: employee._id, employeeName: displayName(employee), department: employee.department || null, joiningDate: employee.joiningDate })),
  };

  // --- Legacy blocks, unchanged in shape
  const hourEmployeeIds = [...hoursByEmployee.keys()];
  const workingHours = hourEmployeeIds
    .map((id) => ({ employeeId: employeeById.get(id)?._id || id, employeeName: nameOf(id), ...hoursByEmployee.get(id) }))
    .sort((a, b) => b.workedMinutes - a.workedMinutes || a.employeeName.localeCompare(b.employeeName));
  const performance = includePerformance ? await recruiterPerformance(context) : [];

  const movementRow = (employee, extra) => ({ employeeId: employee._id, employeeName: displayName(employee), employeeCode: employee.employeeCode || null, department: employee.department || null, designation: employee.designation || null, joiningDate: employee.joiningDate, ...extra });

  return {
    range: { preset: range.preset, startDate: range.startDate, endDate: range.endDate, timezone: timeZone },
    comparisonRange: { preset: comparison.preset, startDate: comparison.startDate, endDate: comparison.endDate, timezone: timeZone },
    granularity,
    workingDays: context.workingDays,
    scope: { type: query.employeeId ? 'EMPLOYEE' : query.department ? 'DEPARTMENT' : 'ALL', name: context.scopeLabel, employeeId: query.employeeId || null, department: query.department || null },
    workday: { ...workday, punctualityAvailable: Boolean(workday.workdayStartTime), lateAfter: context.lateAfter },
    filterOptions: {
      departments: departments.filter(Boolean).sort(),
      employees: roster.map((employee) => ({ _id: employee._id, name: displayName(employee), employeeCode: employee.employeeCode || null, department: employee.department || null })),
    },
    cards: { headcount, activeHeadcount, working: workingIds.length, onLeave: onLeaveIds.length, pendingLeave, approvedLeave },
    kpis,
    timeseries,
    composition: {
      byDepartment: breakdownRows(composition.byDepartment),
      byDesignation: breakdownRows(composition.byDesignation),
      bySalaryType: breakdownRows(composition.bySalaryType),
      byStatus: breakdownRows(composition.byStatus),
      tenureBands: tenureRows(composition.tenure),
    },
    movement: {
      joiners: (composition.joiners || []).map((employee) => movementRow(employee)),
      leavers: (composition.leavers || []).map((employee) => movementRow(employee, { terminationDate: employee.terminationDate, tenureDays: employee.joiningDate && employee.terminationDate ? Math.max(0, Math.floor((new Date(employee.terminationDate) - new Date(employee.joiningDate)) / 86400000)) : null })),
      anniversaries: (composition.anniversaries || []).map((employee) => movementRow(employee, {
        onDate: `${context.todayKey.slice(0, 4)}-${employee.monthDay}`,
        years: Math.max(1, Number(context.todayKey.slice(0, 4)) - new Date(employee.joiningDate).getUTCFullYear()),
      })).sort((a, b) => a.onDate.localeCompare(b.onDate)),
    },
    leave,
    payroll,
    exceptions,
    leaderboard: { topAttendance: byPresence.slice(0, LEADERBOARD_LIMIT), bottomAttendance: [...byPresence].reverse().slice(0, LEADERBOARD_LIMIT) },
    attendance: { items: attendanceRecords.map((record) => attendanceSummary(record, now)), page: attendancePage, limit: attendanceLimit, total: attendanceTotal, pages: Math.ceil(attendanceTotal / attendanceLimit) },
    workingHours,
    performance,
  };
}

// Recruitment attribution, retained for the legacy `performance` block only.
async function recruiterPerformance(context) {
  const Employee = model('Employee'); const User = model('User');
  const { companyId, range } = context;
  const eventStages = ['NEW_LEAD', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'JOINED'];
  const historyMatch = { companyId, stageHistory: { $elemMatch: { changedAt: { $gte: range.startInstant, $lt: range.endExclusive }, recruiterEmployeeId: { $ne: null }, eventType: { $in: ['STAGE_TRANSITION', null] } } } };
  const [eventCounts, activeRecruiterUsers] = await Promise.all([
    Candidate.aggregate([
      { $match: historyMatch }, { $unwind: '$stageHistory' },
      { $match: { 'stageHistory.changedAt': { $gte: range.startInstant, $lt: range.endExclusive }, 'stageHistory.recruiterEmployeeId': { $ne: null }, 'stageHistory.eventType': { $in: ['STAGE_TRANSITION', null] }, 'stageHistory.toStage': { $in: eventStages } } },
      { $group: { _id: { recruiterEmployeeId: '$stageHistory.recruiterEmployeeId', stage: '$stageHistory.toStage' }, count: { $sum: 1 } } },
    ]),
    User.find({ companyId, role: 'RECRUITER', status: 'ACTIVE', deletedAt: null }).distinct('_id'),
  ]);
  const countsByRecruiter = new Map();
  for (const row of eventCounts) {
    const id = String(row._id.recruiterEmployeeId); const current = countsByRecruiter.get(id) || {};
    current[row._id.stage] = row.count; countsByRecruiter.set(id, current);
  }
  const activeRecruiters = await Employee.find({ companyId, userId: { $in: activeRecruiterUsers }, employmentStatus: 'ACTIVE', deletedAt: null }).select('_id').lean();
  const ids = [...new Set([...activeRecruiters.map((row) => String(row._id)), ...countsByRecruiter.keys()])].map((id) => objectId(id));
  const employees = ids.length ? await Employee.find({ companyId, _id: { $in: ids } }).select('employeeCode firstName lastName workEmail employmentStatus').lean() : [];
  return employees.map((employee) => {
    const counts = countsByRecruiter.get(String(employee._id)) || {};
    return { employeeId: employee._id, employeeName: displayName(employee), submission: counts.NEW_LEAD || 0, shortlisted: counts.SHORTLISTED || 0, interviewScheduled: counts.INTERVIEW_SCHEDULED || 0, selected: counts.SELECTED || 0, rejected: counts.REJECTED || 0, joined: counts.JOINED || 0 };
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

// --- Live now ----------------------------------------------------------------
/*
 * Today's roster, as of this instant, in the company timezone. Deliberately takes
 * no range parameters: the overview's date filter governs the analysis below it,
 * while this panel always answers "what is happening right now".
 *
 * `segments` and `serverNow` are both returned so the browser can tick each
 * duration forward between polls without re-fetching, and can correct for a
 * skewed local clock. This is a read: it does not close stale shifts — a
 * forgotten clock-out is surfaced as an exception rather than silently repaired.
 */
const LIVE_STATUS_RANK = { WORKING: 0, ON_BREAK: 1, NOT_STARTED: 2, COMPLETED: 3, ON_LEAVE: 4 };
const LIVE_ROSTER_LIMIT = 500;

async function liveWorkforce(actor, now = new Date()) {
  const Company = model('Company'); const Employee = model('Employee');
  const Attendance = model('AttendanceRecord'); const Leave = model('LeaveRequest'); const LeaveType = model('LeaveType');
  const companyId = objectId(String(actor.companyId));
  const company = await Company.findById(companyId).select('timezone settings').lean();
  const timeZone = isValidTimeZone(company?.timezone) ? company.timezone : 'UTC';
  const workday = workdayShape(company?.settings || {});
  const businessDate = dateKeyInTimeZone(now, timeZone);
  const todayCanonical = new Date(`${businessDate}T00:00:00.000Z`);
  const upcomingCutoff = new Date(`${addDateKeyDays(businessDate, ANNIVERSARY_WINDOW_DAYS)}T00:00:00.000Z`);

  const [employees, records, leaveToday, upcomingLeave, pendingApprovals, leaveTypes] = await Promise.all([
    Employee.find({ companyId, employmentStatus: 'ACTIVE', deletedAt: null }).select('firstName lastName workEmail employeeCode department designation').sort({ firstName: 1, lastName: 1 }).limit(LIVE_ROSTER_LIMIT).lean(),
    Attendance.find({ companyId, workDate: todayCanonical }).select('employeeId status segments workedMinutes breakMinutes').lean(),
    Leave.find({ companyId, status: 'APPROVED', startDate: { $lte: todayCanonical }, endDate: { $gte: todayCanonical } }).select('employeeId leaveTypeId startDate endDate').lean(),
    Leave.countDocuments({ companyId, status: 'APPROVED', startDate: { $gt: todayCanonical, $lte: upcomingCutoff } }),
    Leave.countDocuments({ companyId, status: 'PENDING' }),
    LeaveType.find({ companyId, deletedAt: null }).select('name').lean(),
  ]);

  const typeName = new Map(leaveTypes.map((type) => [String(type._id), type.name]));
  const recordByEmployee = new Map(records.map((record) => [String(record.employeeId), record]));
  const leaveByEmployee = new Map(leaveToday.map((request) => [String(request.employeeId), request]));

  const rows = employees.map((employee) => {
    const record = recordByEmployee.get(String(employee._id));
    const leave = leaveByEmployee.get(String(employee._id));
    const segments = (record?.segments || []).map((segment) => ({ type: segment.type, startedAt: segment.startedAt, endedAt: segment.endedAt || null }));
    const starts = segments.map((segment) => segment.startedAt).filter(Boolean);
    const open = segments.find((segment) => !segment.endedAt);
    const minutes = (type) => segments.reduce((total, segment) => {
      if (segment.type !== type) return total;
      const end = segment.endedAt ? new Date(segment.endedAt) : now;
      return total + Math.max(0, Math.floor((end - new Date(segment.startedAt)) / 60000));
    }, 0);
    // Approved leave outranks "not started": someone who is away has not simply
    // failed to clock in. An actual clock-in still wins, so a person who came in
    // anyway reads as working.
    const status = record?.status && record.status !== 'NOT_STARTED' ? record.status : leave ? 'ON_LEAVE' : 'NOT_STARTED';
    return {
      employeeId: employee._id, employeeName: displayName(employee), employeeCode: employee.employeeCode || null,
      department: employee.department || null, designation: employee.designation || null,
      status,
      loginAt: starts.length ? starts.reduce((earliest, value) => (value < earliest ? value : earliest)) : null,
      currentSince: open?.startedAt || null,
      workedMinutes: minutes('WORK'), breakMinutes: minutes('BREAK'),
      segments,
      leave: leave ? { leaveTypeName: typeName.get(String(leave.leaveTypeId)) || 'Leave', startDate: leave.startDate, endDate: leave.endDate } : null,
    };
  }).sort((a, b) => LIVE_STATUS_RANK[a.status] - LIVE_STATUS_RANK[b.status] || a.employeeName.localeCompare(b.employeeName));

  const countOf = (status) => rows.filter((row) => row.status === status).length;
  return {
    businessDate, timeZone, serverNow: now, workday: { ...workday, punctualityAvailable: Boolean(workday.workdayStartTime) },
    truncated: employees.length >= LIVE_ROSTER_LIMIT,
    counters: {
      totalEmployees: rows.length,
      working: countOf('WORKING'), onBreak: countOf('ON_BREAK'),
      yetToClockIn: countOf('NOT_STARTED'), finished: countOf('COMPLETED'),
      onLeaveToday: countOf('ON_LEAVE'), upcomingLeave, pendingApprovals,
    },
    employees: rows,
  };
}

// --- Drill-down --------------------------------------------------------------
/*
 * One paginated endpoint behind every figure on the overview. The server decides
 * the column set and the "see all" deep link so the modal stays generic, and each
 * dimension reuses exactly the filters the overview counted with.
 */
const ATTENDANCE_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'workDate', label: 'Date', type: 'date' },
  { key: 'loginAt', label: 'Login', type: 'time' },
  { key: 'logoutAt', label: 'Logout', type: 'time' },
  { key: 'status', label: 'Status', type: 'badge' },
  { key: 'workedHours', label: 'Work (hrs)', align: 'right' },
  { key: 'breakHours', label: 'Break (hrs)', align: 'right' },
];
const EMPLOYEE_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Code' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'employmentStatus', label: 'Status', type: 'badge' },
  { key: 'joiningDate', label: 'Joined', type: 'date' },
];
const LEAVE_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'leaveTypeName', label: 'Leave type' },
  { key: 'startDate', label: 'From', type: 'date' },
  { key: 'endDate', label: 'To', type: 'date' },
  { key: 'days', label: 'Days', align: 'right' },
  { key: 'status', label: 'Status', type: 'badge' },
];
const PAYROLL_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'workedHours', label: 'Worked (hrs)', align: 'right' },
  { key: 'grossPay', label: 'Gross', align: 'right', type: 'money' },
  { key: 'deductions', label: 'Deductions', align: 'right', type: 'money' },
  { key: 'netPay', label: 'Net pay', align: 'right', type: 'money' },
];

// Attendance dimensions map to a derived flag, or to a status value for PRESENT.
const ATTENDANCE_DIMENSIONS = {
  PRESENT: { label: 'Present', match: { present: 1 }, sort: { workDate: -1 } },
  MISSING_LOGOUT: { label: 'Missing clock-out', match: { missingLogout: 1 }, sort: { workDate: -1 } },
  CURRENTLY_WORKING: { label: 'Working right now', match: { workingNow: 1 }, sort: { workDate: -1 } },
  ON_BREAK_NOW: { label: 'On break right now', match: { onBreakNow: 1 }, sort: { workDate: -1 } },
  ZERO_HOUR: { label: 'Zero-hour days', match: { zeroHour: 1 }, sort: { workDate: -1 } },
  SHORT_DAY: { label: 'Short days', match: { shortDay: 1 }, sort: { workMinutes: 1 } },
  OVERTIME: { label: 'Overtime days', match: { overtime: 1 }, sort: { workMinutes: -1 } },
  LONG_BREAK: { label: 'Long breaks', match: { longBreak: 1 }, sort: { breakMinutesTotal: -1 } },
  LATE: { label: 'Late arrivals', match: { late: 1 }, sort: { workDate: -1 } },
  CORRECTED: { label: 'Corrected records', match: { corrected: 1 }, sort: { workDate: -1 } },
  ATTENDANCE_STATUS: { label: 'Attendance status', sort: { workDate: -1 }, valued: true },
};
const EMPLOYEE_DIMENSIONS = ['DEPARTMENT', 'DESIGNATION', 'SALARY_TYPE', 'EMPLOYMENT_STATUS', 'TENURE_BAND', 'JOINERS', 'LEAVERS', 'ANNIVERSARIES', 'NEVER_CLOCKED_IN', 'ABSENT'];
const LEAVE_DIMENSIONS = ['LEAVE_STATUS', 'LEAVE_TYPE', 'LEAVE_UPCOMING', 'LEAVE_PENDING_AGE', 'ON_LEAVE'];

async function workforceDrilldown(actor, query, now = new Date()) {
  const dimension = String(query.dimension || '').toUpperCase();
  const value = query.value == null || query.value === '' ? null : String(query.value);
  const context = await reportContext(actor, query, now);
  const pageNumber = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const skip = (pageNumber - 1) * limit;
  const baseQuery = { preset: context.range.preset, ...(context.range.preset === 'custom' ? { startDate: context.range.startDate, endDate: context.range.endDate } : {}), ...(query.department ? { department: query.department } : {}), ...(query.employeeId ? { employeeId: query.employeeId } : {}) };

  if (ATTENDANCE_DIMENSIONS[dimension]) return attendanceDrilldown(context, dimension, value, { pageNumber, limit, skip, baseQuery });
  if (EMPLOYEE_DIMENSIONS.includes(dimension)) return employeeDrilldown(context, dimension, value, { pageNumber, limit, skip, baseQuery, now });
  if (LEAVE_DIMENSIONS.includes(dimension)) return leaveDrilldown(context, dimension, value, { pageNumber, limit, skip, baseQuery, now });
  if (dimension === 'PAYROLL_LINES') return payrollDrilldown(context, value, { pageNumber, limit, skip });
  throw new AppError('VALIDATION_ERROR', 400, 'Unsupported drill-down dimension', [{ field: 'dimension', message: `must be one of ${[...Object.keys(ATTENDANCE_DIMENSIONS), ...EMPLOYEE_DIMENSIONS, ...LEAVE_DIMENSIONS, 'PAYROLL_LINES'].join(', ')}` }]);
}

async function attendanceDrilldown(context, dimension, value, { pageNumber, limit, skip, baseQuery }) {
  const Attendance = model('AttendanceRecord'); const Employee = model('Employee');
  const spec = ATTENDANCE_DIMENSIONS[dimension];
  if (spec.valued && !value) throw new AppError('VALIDATION_ERROR', 400, 'This drill-down requires a value', [{ field: 'value', message: 'is required for ATTENDANCE_STATUS' }]);
  if (dimension === 'LATE' && !context.lateAfter) throw new AppError('VALIDATION_ERROR', 400, 'Set a workday start time in company settings before reviewing late arrivals');
  const flagMatch = spec.valued ? { status: value } : spec.match;
  const [result] = await Attendance.aggregate([
    { $match: attendanceMatch(context, context.range) },
    ...attendanceDeriveStages(context),
    { $match: flagMatch },
    { $facet: {
      items: [{ $sort: { ...spec.sort, _id: -1 } }, { $skip: skip }, { $limit: limit }, { $project: { employeeId: 1, workDate: 1, status: 1, workMinutes: 1, breakMinutesTotal: 1, firstLoginAt: 1, segments: 1, corrections: { $slice: [{ $ifNull: ['$corrections', []] }, -1] } } }],
      total: [{ $count: 'count' }],
    } },
  ]);
  const rows = result?.items || [];
  const employees = rows.length ? await Employee.find({ companyId: context.companyId, _id: { $in: rows.map((row) => row.employeeId) } }).select('firstName lastName workEmail employeeCode').lean() : [];
  const nameById = new Map(employees.map((employee) => [String(employee._id), displayName(employee)]));
  const total = result?.total?.[0]?.count || 0;
  return {
    dimension, value, label: spec.valued ? `${spec.label}: ${labelFor(value)}` : spec.label, kind: 'ATTENDANCE',
    columns: ATTENDANCE_COLUMNS,
    items: rows.map((row) => {
      const summary = attendanceSummary({ ...row, employeeId: row.employeeId }, context.now);
      return {
        _id: row._id, employeeId: row.employeeId, employeeName: nameById.get(String(row.employeeId)) || 'Unknown employee',
        workDate: row.workDate, loginAt: summary.loginAt, logoutAt: summary.logoutAt, status: row.status,
        workedHours: minutesToHours(row.workMinutes), breakHours: minutesToHours(row.breakMinutesTotal),
        correctionReason: row.corrections?.[0]?.reason || null,
      };
    }),
    page: pageNumber, limit, total, pages: Math.ceil(total / limit),
    seeAll: { path: '/attendance', query: { ...baseQuery, ...(spec.valued ? { status: value } : {}), from: context.range.startDate, to: context.range.endDate } },
  };
}

async function employeeDrilldown(context, dimension, value, { pageNumber, limit, skip, baseQuery, now }) {
  const Employee = model('Employee'); const Attendance = model('AttendanceRecord'); const Leave = model('LeaveRequest');
  const filter = { companyId: context.companyId, deletedAt: null, ...context.employeeScope };
  const rangeEndExclusive = new Date(`${addDateKeyDays(context.range.endDate, 1)}T00:00:00.000Z`);
  let label = labelFor(dimension); let sort = { firstName: 1, lastName: 1 };
  let seeAllQuery = { ...baseQuery };

  if (dimension === 'DEPARTMENT') { filter.department = value === '__OTHER__' ? { $nin: [] } : value; label = `Department: ${value}`; seeAllQuery = { ...baseQuery, department: value }; }
  else if (dimension === 'DESIGNATION') { filter.designation = value; label = `Designation: ${value}`; }
  else if (dimension === 'SALARY_TYPE') { filter.salaryType = value; label = `Salary type: ${labelFor(value)}`; }
  else if (dimension === 'EMPLOYMENT_STATUS') { filter.employmentStatus = value; label = `Status: ${labelFor(value)}`; seeAllQuery = { ...baseQuery, status: value }; }
  else if (dimension === 'TENURE_BAND') {
    const band = TENURE_BANDS.find((item) => item.key === value);
    if (!band) throw new AppError('VALIDATION_ERROR', 400, 'Unknown tenure band');
    // Longer tenure means an earlier joining date, so the bounds invert.
    filter.employmentStatus = 'ACTIVE';
    filter.joiningDate = daysAgoRange(band, now);
    label = `Tenure: ${band.label}`; sort = { joiningDate: -1 };
  } else if (dimension === 'JOINERS') { filter.joiningDate = { $gte: context.range.attendanceStart, $lt: rangeEndExclusive }; label = 'New joiners'; sort = { joiningDate: -1 }; }
  else if (dimension === 'LEAVERS') { filter.employmentStatus = 'TERMINATED'; filter.terminationDate = { $gte: context.range.attendanceStart, $lt: rangeEndExclusive }; label = 'Leavers'; sort = { terminationDate: -1 }; seeAllQuery = { ...baseQuery, status: 'TERMINATED' }; }
  else if (dimension === 'ANNIVERSARIES') {
    const keys = [];
    for (let offset = 0; offset < ANNIVERSARY_WINDOW_DAYS; offset += 1) keys.push(addDateKeyDays(context.todayKey, offset).slice(5));
    const ids = await Employee.aggregate([
      { $match: { ...filter, employmentStatus: 'ACTIVE', joiningDate: { $ne: null, $lt: new Date(`${context.todayKey}T00:00:00.000Z`) } } },
      { $addFields: { monthDay: { $dateToString: { format: '%m-%d', date: '$joiningDate', timezone: 'UTC' } } } },
      { $match: { monthDay: { $in: keys } } }, { $project: { _id: 1 } },
    ]);
    filter._id = { $in: ids.map((row) => row._id) }; label = 'Upcoming work anniversaries'; sort = { joiningDate: 1 };
  } else if (dimension === 'NEVER_CLOCKED_IN' || dimension === 'ABSENT') {
    const presentIds = await Attendance.distinct('employeeId', { ...attendanceMatch(context, context.range), status: { $in: PRESENT_STATUSES } });
    const excluded = [...presentIds];
    if (dimension === 'ABSENT') excluded.push(...await Leave.distinct('employeeId', { ...leaveOverlapFilter(context, context.range), status: 'APPROVED' }));
    filter.employmentStatus = 'ACTIVE';
    filter._id = { ...(filter._id || {}), $nin: excluded };
    label = dimension === 'ABSENT' ? 'Absent without leave' : 'No attendance in this period';
  }

  const [rows, total] = await Promise.all([
    Employee.find(filter).select('firstName lastName workEmail employeeCode department designation employmentStatus salaryType joiningDate terminationDate').sort(sort).skip(skip).limit(limit).lean(),
    Employee.countDocuments(filter),
  ]);
  return {
    dimension, value, label, kind: 'EMPLOYEE',
    columns: dimension === 'LEAVERS' ? [...EMPLOYEE_COLUMNS, { key: 'terminationDate', label: 'Left', type: 'date' }] : EMPLOYEE_COLUMNS,
    items: rows.map((employee) => ({ _id: employee._id, employeeId: employee._id, employeeName: displayName(employee), employeeCode: employee.employeeCode || null, department: employee.department || null, designation: employee.designation || null, employmentStatus: employee.employmentStatus, salaryType: employee.salaryType, joiningDate: employee.joiningDate, terminationDate: employee.terminationDate || null })),
    page: pageNumber, limit, total, pages: Math.ceil(total / limit),
    seeAll: { path: '/employees', query: seeAllQuery },
  };
}

async function leaveDrilldown(context, dimension, value, { pageNumber, limit, skip, baseQuery, now }) {
  const Leave = model('LeaveRequest'); const LeaveType = model('LeaveType'); const Employee = model('Employee');
  const filter = { ...leaveOverlapFilter(context, context.range) };
  let label = labelFor(dimension); let sort = { startDate: -1 };
  let seeAllQuery = { ...baseQuery, from: context.range.startDate, to: context.range.endDate };
  let ageBand = null;

  if (dimension === 'LEAVE_STATUS') { filter.status = value; label = `Leave ${String(value || '').toLowerCase()}`; seeAllQuery = { ...seeAllQuery, status: value }; }
  else if (dimension === 'ON_LEAVE') { filter.status = 'APPROVED'; label = 'On approved leave'; seeAllQuery = { ...seeAllQuery, status: 'APPROVED' }; }
  else if (dimension === 'LEAVE_TYPE') { filter.leaveTypeId = objectId(String(value), 'leaveTypeId'); filter.status = { $in: ['PENDING', 'APPROVED'] }; label = 'Leave type'; }
  else if (dimension === 'LEAVE_UPCOMING') { filter.status = 'APPROVED'; filter.endDate = { $gte: new Date(`${context.todayKey}T00:00:00.000Z`) }; label = 'Upcoming approved leave'; sort = { startDate: 1 }; seeAllQuery = { ...seeAllQuery, status: 'APPROVED' }; }
  else if (dimension === 'LEAVE_PENDING_AGE') {
    ageBand = LEAVE_AGE_BANDS.find((band) => band.key === value);
    if (!ageBand) throw new AppError('VALIDATION_ERROR', 400, 'Unknown pending-age band');
    // Older requests were created earlier, so the day bounds invert here too.
    filter.status = 'PENDING';
    filter.createdAt = daysAgoRange(ageBand, now);
    label = `Pending ${ageBand.label.toLowerCase()}`; sort = { createdAt: 1 };
    seeAllQuery = { ...seeAllQuery, status: 'PENDING' };
  }

  const [rows, total, types] = await Promise.all([
    Leave.find(filter).select('employeeId leaveTypeId startDate endDate status createdAt reason').sort(sort).skip(skip).limit(limit).lean(),
    Leave.countDocuments(filter),
    LeaveType.find({ companyId: context.companyId }).select('name').lean(),
  ]);
  const typeName = new Map(types.map((type) => [String(type._id), type.name]));
  const employees = rows.length ? await Employee.find({ companyId: context.companyId, _id: { $in: rows.map((row) => row.employeeId) } }).select('firstName lastName workEmail employeeCode').lean() : [];
  const nameById = new Map(employees.map((employee) => [String(employee._id), displayName(employee)]));
  return {
    dimension, value, label, kind: 'LEAVE',
    columns: dimension === 'LEAVE_PENDING_AGE' ? [...LEAVE_COLUMNS, { key: 'ageDays', label: 'Waiting (days)', align: 'right' }] : LEAVE_COLUMNS,
    items: rows.map((row) => ({
      _id: row._id, employeeId: row.employeeId, employeeName: nameById.get(String(row.employeeId)) || 'Unknown employee',
      leaveTypeName: typeName.get(String(row.leaveTypeId)) || 'Leave', startDate: row.startDate, endDate: row.endDate,
      days: overlapDayKeys(row, context.range).length, status: row.status, reason: row.reason || null,
      ageDays: Math.max(0, Math.floor((now - new Date(row.createdAt)) / 86400000)),
    })),
    page: pageNumber, limit, total, pages: Math.ceil(total / limit),
    seeAll: { path: '/leave/queue', query: seeAllQuery },
  };
}

async function payrollDrilldown(context, value, { pageNumber, limit, skip }) {
  const Employee = model('Employee');
  const period = value
    ? await PayrollPeriod.findOne({ _id: objectId(String(value), 'payrollPeriodId'), companyId: context.companyId }).select('periodMonth periodYear status').lean()
    : await PayrollPeriod.findOne({ companyId: context.companyId }).sort({ periodYear: -1, periodMonth: -1 }).select('periodMonth periodYear status').lean();
  if (!period) return { dimension: 'PAYROLL_LINES', value, label: 'Payroll', kind: 'PAYROLL', columns: PAYROLL_COLUMNS, items: [], page: pageNumber, limit, total: 0, pages: 0, seeAll: { path: '/payroll', query: {} } };
  const filter = { companyId: context.companyId, payrollPeriodId: period._id, isCurrent: true, ...(context.scopeIds ? { employeeId: { $in: context.scopeIds } } : {}) };
  const [rows, total] = await Promise.all([
    PayrollLine.find(filter).select('employeeId workedHours grossPay deductions netPay').sort({ netPay: -1 }).skip(skip).limit(limit).lean(),
    PayrollLine.countDocuments(filter),
  ]);
  const employees = rows.length ? await Employee.find({ companyId: context.companyId, _id: { $in: rows.map((row) => row.employeeId) } }).select('firstName lastName workEmail employeeCode').lean() : [];
  const nameById = new Map(employees.map((employee) => [String(employee._id), displayName(employee)]));
  return {
    dimension: 'PAYROLL_LINES', value: String(period._id), label: `Payroll ${PERIOD_LABEL(period)}`, kind: 'PAYROLL', columns: PAYROLL_COLUMNS,
    items: rows.map((row) => ({ _id: row._id, employeeId: row.employeeId, employeeName: nameById.get(String(row.employeeId)) || 'Unknown employee', workedHours: round1(toNumber(row.workedHours)), grossPay: toNumber(row.grossPay), deductions: toNumber(row.deductions), netPay: toNumber(row.netPay) })),
    page: pageNumber, limit, total, pages: Math.ceil(total / limit),
    seeAll: { path: `/payroll/${period._id}`, query: {} },
  };
}

module.exports = { attendanceSummary, adminDashboard, liveWorkforce, workforceDrilldown };
