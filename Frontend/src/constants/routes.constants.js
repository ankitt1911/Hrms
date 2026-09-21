export const ROUTES = Object.freeze({
  LOGIN: "/login", DASHBOARD: "/dashboard", PROFILE: "/profile", EMPLOYEES: "/employees", ATTENDANCE_ME: "/attendance/me", ATTENDANCE: "/attendance",
  LEAVE_ME: "/leave/me", LEAVE_QUEUE: "/leave/queue", PAYROLL: "/payroll", PAYSLIPS_ME: "/payslips/me", VENDORS: "/vendors",
  JOBS: "/jobs", ASSIGNED_JOBS: "/jobs/assigned", CRM_SUBMISSIONS: "/crm/submissions", CRM_SHORTLISTED: "/crm/shortlisted", CRM_INTERVIEW_SCHEDULED: "/crm/interview-scheduled", CRM_SELECTED: "/crm/selected", CRM_REJECTED: "/crm/rejected", CRM_JOINED: "/crm/joined", CRM_PIPELINE: "/crm/my-pipeline", CRM_CANDIDATES: "/crm/candidates", CRM_CANDIDATE_POOL: "/crm/candidate-pool", CRM_MY_CANDIDATES: "/crm/my-candidates", CRM_MONITORING: "/crm/monitoring", CRM_CALENDAR: "/crm/calendar", PLACEMENTS: "/placements",
  MESSAGES: "/messages", NOTIFICATIONS: "/notifications", DOCUMENTS_ME: "/documents/me", AUDIT: "/audit", REPORTS: "/reports",
  COMPANY_SETTINGS: "/admin/company", NOT_FOUND: "/not-found",
  employee: (id) => `/employees/${id}`,
  payrollPeriod: (id) => `/payroll/${id}`,
});
