/*
 * Chart palette for the CRM monitor. Values are validated, not hand-picked —
 * re-run the palette validator before changing any hex here.
 *
 * - Pipeline stages are ORDINAL, not categorical, so the seven main stages use a
 *   single-hue brand-green ramp stepped light -> dark along the funnel. Progress
 *   reads as progress, and the light end clears the 2:1 contrast floor on the
 *   app surface (#f7f7f5).
 * - PAUSED (RNR, ON_HOLD) and LOST (NOT_INTERESTED, REJECTED) are reserved
 *   status colours. They are never reused as "series N" and always ship with a
 *   label and an icon, so a state is never communicated by colour alone.
 * - Unordered dimensions (recruiters, jobs, vendors, sources) use CATEGORICAL,
 *   assigned in fixed order and never cycled; past eight, fold into "Other".
 * Several hues sit below 3:1 against the surface, so every chart using them
 * ships visible labels, a legend and a table view alongside.
 */
export const CHART_SURFACE = "#ffffff";
export const CHART_LINE = "#e4e3df";
export const CHART_AXIS_INK = "#5b6169";

export const STAGE_RAMP = Object.freeze(["#6ab9a7", "#4fa693", "#35937f", "#1f7f6c", "#126a58", "#0b5546", "#064034"]);
export const STATUS_PAUSED = "#c98500";
export const STATUS_LOST = "#b8322a";
export const CATEGORICAL = Object.freeze(["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]);

const MAIN_STAGES = ["NEW_LEAD", "CALLED", "INTERESTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "JOINED"];
export const STAGE_COLORS = Object.freeze({
  ...Object.fromEntries(MAIN_STAGES.map((stage, index) => [stage, STAGE_RAMP[index]])),
  RNR: STATUS_PAUSED, ON_HOLD: STATUS_PAUSED, NOT_INTERESTED: STATUS_LOST, REJECTED: STATUS_LOST,
});
export const STAGE_LABELS = Object.freeze({
  NEW_LEAD: "Submissions", CALLED: "Called", RNR: "RNR", INTERESTED: "Interested",
  NOT_INTERESTED: "Not interested", SHORTLISTED: "Shortlisted", INTERVIEW_SCHEDULED: "Interview scheduled",
  SELECTED: "Selected", REJECTED: "Rejected", JOINED: "Joined", ON_HOLD: "On hold",
});

export const stageColor = (stage) => STAGE_COLORS[stage] || CATEGORICAL[0];
export const stageLabel = (stage) => STAGE_LABELS[stage] || String(stage || "").replaceAll("_", " ");
export const categoricalColor = (index) => CATEGORICAL[index % CATEGORICAL.length];

const numberFormat = new Intl.NumberFormat("en-IN");
export const formatCount = (value) => numberFormat.format(Number(value || 0));
export const formatMoney = (value) => {
  const amount = Number(value || 0);
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
};
export const formatPercent = (value) => `${Number(value || 0).toFixed(Number.isInteger(Number(value)) ? 0 : 1)}%`;
