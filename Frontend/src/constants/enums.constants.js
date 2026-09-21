export const ATTENDANCE_STATUSES = Object.freeze(["NOT_STARTED", "WORKING", "ON_BREAK", "COMPLETED"]);
export const LEAVE_STATUSES = Object.freeze(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export const PAYROLL_STATUSES = Object.freeze(["DRAFT", "CALCULATED", "UNDER_REVIEW", "APPROVED", "LOCKED", "REOPENED"]);
export const PAYSLIP_STATUSES = Object.freeze(["DRAFT", "APPROVED", "PUBLISHED", "WITHDRAWN"]);
export const JOB_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "ON_HOLD", "CLOSED", "INACTIVE"]);
export const JOB_PROCESSES = Object.freeze(["VOICE", "NON_VOICE"]);
export const JOB_TYPES = Object.freeze(["IT", "NON_IT"]);
export const CANDIDATE_STAGES = Object.freeze(["NEW_LEAD", "CALLED", "RNR", "INTERESTED", "NOT_INTERESTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "JOINED", "ON_HOLD"]);
export const CANDIDATE_LANGUAGES = Object.freeze(["ENGLISH", "KANNADA", "HINDI", "TAMIL", "TELUGU", "MALAYALAM", "MARATHI", "BENGALI", "GUJARATI", "URDU", "OTHER"]);
export const CANDIDATE_PROFILE_STATUSES = Object.freeze(["NEW", "ASSIGNED", "SUBMITTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "JOINED", "ON_HOLD"]);
const CANDIDATE_MAIN_STAGES = Object.freeze(["NEW_LEAD", "CALLED", "INTERESTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "JOINED"]);
const CANDIDATE_STAGE_RANK = Object.freeze(Object.fromEntries(CANDIDATE_MAIN_STAGES.map((stage,index)=>[stage,index])));
export const candidateAllowedNextStages = (candidate = {}) => {
  if (["NOT_INTERESTED","REJECTED","JOINED"].includes(candidate.stage)) return [];
  const rank=Math.max(0,Number(candidate.progressionRank)||0);
  const allowed=CANDIDATE_MAIN_STAGES.filter(stage=>(CANDIDATE_STAGE_RANK[stage]>rank||(["RNR","ON_HOLD"].includes(candidate.stage)&&CANDIDATE_STAGE_RANK[stage]>=rank))&&(stage!=="JOINED"||rank>=CANDIDATE_STAGE_RANK.SELECTED));
  if(rank<CANDIDATE_STAGE_RANK.SHORTLISTED)allowed.push("RNR","NOT_INTERESTED");
  if(rank<CANDIDATE_STAGE_RANK.JOINED&&candidate.stage!=="ON_HOLD")allowed.push("ON_HOLD");
  if(rank>=CANDIDATE_STAGE_RANK.SHORTLISTED&&rank<CANDIDATE_STAGE_RANK.JOINED)allowed.push("REJECTED");
  return [...new Set(allowed)].filter(stage=>stage!==candidate.stage);
};
export const INVOICE_STATES = Object.freeze(["NOT_READY", "FUTURE_DUE", "DUE", "GENERATED", "READY_TO_RAISE", "RAISED", "CANCELLED"]);
export const DOCUMENT_SCAN_STATUSES = Object.freeze(["PENDING", "CLEAN", "INFECTED", "FAILED"]);
export const SALARY_TYPES = Object.freeze(["SALARIED", "HOURLY", "PER_JOINING"]);
export const EMPLOYMENT_STATUSES = Object.freeze(["ACTIVE", "TERMINATED"]);
export const REPORT_TYPES = Object.freeze(["candidates", "placements", "payroll", "audit"]);

export const STATUS_TONES = Object.freeze({
  NOT_STARTED: "neutral", DRAFT: "neutral", INACTIVE: "neutral", CANCELLED: "neutral", WITHDRAWN: "neutral",
  WORKING: "success", COMPLETED: "success", APPROVED: "success", PUBLISHED: "success", ACTIVE: "success", JOINED: "success", CLEAN: "success", RAISED: "success",
  ON_BREAK: "warning", PENDING: "warning", UNDER_REVIEW: "warning", ON_HOLD: "warning", FUTURE_DUE: "warning", GENERATED: "warning", READY_TO_RAISE: "warning",
  REJECTED: "danger", NOT_INTERESTED: "danger", TERMINATED: "danger", INFECTED: "danger", FAILED: "danger",
  CALCULATED: "info", REOPENED: "info", NEW: "neutral", ASSIGNED: "info", SUBMITTED: "info", PER_JOINING: "info", NEW_LEAD: "info", CALLED: "info", RNR: "warning", INTERESTED: "info", SHORTLISTED: "info", INTERVIEW_SCHEDULED: "info", SELECTED: "info", DUE: "info", LOCKED: "danger",
});
