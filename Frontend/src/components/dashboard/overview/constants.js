import { CATEGORICAL, STAGE_RAMP, STATUS_LOST, STATUS_PAUSED } from "../../../constants/chart.constants";

export const PRESETS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

export const GRANULARITIES = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

/*
 * Presence is a status, not a series index: worked / on leave / absent always
 * carry the same three colours so the eye learns them once. Brand green reads as
 * the good outcome, and the two reserved status hues carry the other two — each
 * always shipped with a label, never colour alone.
 */
export const PRESENCE_COLORS = Object.freeze({ present: STAGE_RAMP[4], onLeave: STATUS_PAUSED, absent: STATUS_LOST });
export const HOURS_COLORS = Object.freeze({ workedHours: STAGE_RAMP[3], breakHours: CATEGORICAL[3] });

export const COMPOSITION_TABS = [
  { value: "byDepartment", label: "Department", dimension: "DEPARTMENT" },
  { value: "byDesignation", label: "Designation", dimension: "DESIGNATION" },
  { value: "bySalaryType", label: "Salary type", dimension: "SALARY_TYPE" },
  { value: "byStatus", label: "Employment", dimension: "EMPLOYMENT_STATUS" },
  { value: "tenureBands", label: "Tenure", dimension: "TENURE_BAND" },
];

export const dateText = (value) => (value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(typeof value === "string" && value.length === 10 ? `${value}T00:00:00.000Z` : value)) : "—");
export const timeText = (value, timeZone) => (value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value)) : "—");
export const bucketTick = (value) => (typeof value === "string" && value.length === 10 ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)) : value);
export const initialsOf = (name) => String(name || "?").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";

/*
 * KPI definitions, keyed by the field on `data.kpis`. The tabs pick the handful
 * that belong beside their charts rather than stacking all ten above the page —
 * a metric read next to the chart that explains it is worth more than a metric
 * in a wall of tiles.
 *
 * `positive: false` marks a metric where going up is bad, so the delta tone
 * follows the meaning rather than the sign.
 */
export const KPI_DEFINITIONS = {
  presenceRate: { label: "Presence rate", icon: "Percent", spark: "present", color: PRESENCE_COLORS.present, drill: ["PRESENT", "", "Present days"] },
  avgWorkedHours: { label: "Avg hours worked", icon: "Clock3", spark: "workedHours", color: STAGE_RAMP[3] },
  avgBreakHours: { label: "Avg break hours", icon: "Coffee", spark: "breakHours", color: PRESENCE_COLORS.onLeave, positive: false },
  fullDayRate: { label: "Full days", icon: "CheckCircle2", spark: "present", color: PRESENCE_COLORS.present },
  punctualityRate: { label: "Punctuality", icon: "AlarmClock", spark: "present", color: PRESENCE_COLORS.present, drill: ["LATE", "", "Late arrivals"] },
  overtimeDays: { label: "Overtime days", icon: "Hourglass", spark: "workedHours", color: STAGE_RAMP[2], drill: ["OVERTIME", "", "Overtime days"] },
  onLeave: { label: "On leave", icon: "CalendarClock", spark: "onLeave", color: PRESENCE_COLORS.onLeave, positive: false, drill: ["ON_LEAVE", "", "On approved leave"] },
  pendingLeave: { label: "Awaiting approval", icon: "CalendarX2", spark: "onLeave", color: PRESENCE_COLORS.onLeave, positive: false, drill: ["LEAVE_STATUS", "PENDING", "Leave awaiting decision"] },
  headcount: { label: "Headcount", icon: "UsersRound", spark: "present", color: STAGE_RAMP[5], drill: ["EMPLOYMENT_STATUS", "ACTIVE", "Active employees"] },
  joiners: { label: "New joiners", icon: "UserPlus", spark: "present", color: STAGE_RAMP[2], drill: ["JOINERS", "", "New joiners"] },
  leavers: { label: "Leavers", icon: "UserMinus", spark: "present", color: PRESENCE_COLORS.absent, positive: false, drill: ["LEAVERS", "", "Leavers"] },
  attritionRate: { label: "Attrition", icon: "TrendingDown", spark: "present", color: PRESENCE_COLORS.absent, positive: false, drill: ["LEAVERS", "", "Leavers"] },
};

export const TABS = [
  { value: "attendance", label: "Attendance", kpis: ["presenceRate", "avgWorkedHours", "avgBreakHours", "fullDayRate", "punctualityRate", "overtimeDays"] },
  { value: "leave", label: "Leave", kpis: ["onLeave", "pendingLeave"] },
  { value: "people", label: "People", kpis: ["headcount", "joiners", "leavers", "attritionRate"] },
  { value: "attention", label: "Needs attention", kpis: [] },
  { value: "payroll", label: "Payroll", kpis: [] },
];
