# API contract

Base path: `/api/v1`. Except login and credential recovery, endpoints require `Authorization: Bearer <accessToken>`. Responses use `{ success, message, data, requestId }`; errors add a stable `code`. `OWNER` below means `SUPER_ADMIN`; `RECRUITER` means an active linked employee; `BOTH` means either role with resource ownership still enforced.

## Authentication and profile

| Access | Operations |
|---|---|
| Public | `POST /auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/request-otp`, `/auth/verify-otp`, `/auth/reset-password` |
| BOTH | `POST /auth/logout`, `/auth/logout-all`, `/auth/change-password`; `GET /auth/sessions`; `DELETE /auth/sessions/:id`; `GET/PATCH /me` |

Login and recovery payloads contain email/password or token data only—never `companyId`. Authentication returns `user.role` and nullable `user.employee`; it does not return role collections, permission arrays, CRM flags, or company selection.

## People operations

| Access | Operations |
|---|---|
| OWNER | `GET/POST /employees`; `GET/PATCH /employees/:id`; `PATCH /employees/:id/status`; `PATCH /employees/:id/recruiter-access`; `POST /employees/:id/credentials/reset`; `PATCH /employees/:id/bank-details` |
| RECRUITER self | `GET /employees/:id`; `GET /employees/:id/bank-details`; `GET /attendance/me/state`; `POST /attendance/me/clock-in`, `/break`, `/resume`, `/clock-out`; `GET /attendance/me/history` |
| OWNER | `GET /attendance`; `PATCH /attendance/:id/correction`; `GET /leave-requests`; `POST /leave-requests/:id/approve`, `/:id/reject` |
| RECRUITER self | `POST /leave-requests`; `GET /leave-requests/me`; `POST /leave-requests/:id/cancel`; `GET /leave-types` |

Employee creation accepts personal/work data (`phone`, `qualification`), compensation (`salaryType`, `monthlyCtc`, `takeHomeSalary`, `hourlyRate`), optional `recruiterAccount: { temporaryPassword }`, and `bankDetails: { accountHolder, bankName, accountNumber, ifscOrRouting, pan, aadhaar }`. Account number, PAN, and Aadhaar are encrypted at rest and returned only as masked values through the scoped bank-details endpoint. Recruiter access uses `{ enabled, temporaryPassword? }`.

## Recruitment and CRM

| Access | Operations |
|---|---|
| OWNER | `GET/POST /vendors`; `GET/PATCH /vendors/:id`; `GET/POST /vendors/:id/documents` |
| BOTH | `GET /job-openings`, `GET /job-openings/:id` (recruiter results are assignment-scoped and omit internal commercial fields) |
| OWNER | `POST /job-openings`; `PATCH /job-openings/:id`, `/:id/status`; `PATCH /job-openings/:id/recruiters` with `{ recruiterEmployeeIds: [] }` |
| BOTH | `GET/POST /crm/candidates`; `GET/PATCH /crm/candidates/:id`; `POST /crm/candidates/:id/stage`; `GET /crm/candidates/:id/history` (recruiter access is ownership and assignment-scoped) |
| OWNER | `PATCH /crm/candidates/:id/recruiter` with `{ recruiterEmployeeId: string|null }` |
| BOTH | `GET /crm/monitoring` (owner may view all or filter a recruiter; recruiter is always self-scoped) |
| BOTH | `GET /crm/monitoring/analytics`; `GET /crm/monitoring/drilldown` (recruiters are scoped to their own candidates on assigned jobs and receive no owner-only sections) |
| OWNER | `GET /placements`, `/placements/:id`; `PATCH /placements/:id/joining`, `/:id/invoice-date-override`; `POST /placements/:id/invoice/generate`, `/ready`, `/raise`, `/reverse` |

Job opening create/update fields include `vendorId` or `companyName` (one company source is required), `title`, `process` (`VOICE` or `NON_VOICE`), `skills`, `salaryRange`, `monthlyCtc`, `takeHomeSalary`, `vendorPayment`, `clauseDays`, `jobType` (`IT` or `NON_IT`), and `requirements`, plus the existing location, openings, status, and description fields. `vendorPayment` is selected only for owner responses and is removed from recruiter/employee responses. Jobs using a free-text company name can still progress into placements without a saved vendor.

Candidate submission requires `jobOpeningId`, `name`, `contact.phone`, `candidateType` (`IT` or `NON_IT`), at least one `languages` value, and `consentGiven: true`; email, qualification, other language, location, and remarks are optional. Candidate lists accept `bucket=SUBMISSIONS|SHORTLISTED`, `stage`, `jobOpeningId`, `search`, `page`, and `limit`. New candidates begin at `NEW_LEAD`; supported stages are `NEW_LEAD`, `CALLED`, `RNR`, `INTERESTED`, `NOT_INTERESTED`, `SHORTLISTED`, `INTERVIEW_SCHEDULED`, `SELECTED`, `REJECTED`, `JOINED`, and `ON_HOLD`. Stage changes are forward-only, with `RNR` and `ON_HOLD` acting as resumable pauses.

`GET /crm/monitoring` accepts `preset=week|month|custom` (default `month`), with inclusive `startDate` and `endDate` required for a custom range. Owners may pass `employeeId`; omitting it returns collective recruiter activity. Recruiters cannot pass `employeeId` and always receive their own activity. The response contains `today` and `period` objects with company-timezone ranges and zero-filled counts for every candidate stage, plus `scope` and owner-only `employeeOptions`. Counts represent attributed stage-transition events; interview reschedules and cancellations are excluded.

`GET /crm/monitoring/analytics` powers the CRM monitor dashboard for the owner and the same dashboard on the recruiter Overview. It accepts `preset=today|week|month|quarter|custom` (default `month`) with inclusive `startDate`/`endDate` for a custom range, the optional slice filters `employeeId`, `jobOpeningId`, `vendorId`, `candidateType`, `source` and `location`, and an optional `granularity=day|week|month` (otherwise derived from the range length). It returns `range` and `comparisonRange` (the preceding window of equal length), `kpis` where each entry is `{ value, previous, deltaPct }`, `stageCounts` (`today`, `period`, `previous`), a zero-filled `timeseries`, a cohort `funnel` over the main stages — its population is the candidates submitted inside the period and each step counts how many of them ever reached at least that stage, so it is monotone and never widens further down — with per-step conversion and drop-off, a recruiter `leaderboard`, `breakdowns` (by job, vendor, candidate type, source, location, language), a `pipelineSnapshot` of current candidate stages, `revenue` derived from placement invoices, and `filterOptions`. Monetary values come from `Placement.invoiceAmount`; `JobOpening.vendorPayment` is never included.

Both endpoints self-scope by role rather than refusing recruiters outright. A recruiter is always pinned to their own `employeeId` (passing one returns 403) and every aggregation is intersected with the same rule the candidate list uses — own candidates on jobs they are still assigned to — so a filter can narrow their view but never widen it. Unassigning a recruiter from a job removes that job's candidates from their dashboard immediately. The owner-only sections (`leaderboard`, `revenue`, and the `placementRevenue` and `invoicesDue` KPIs) are omitted from a recruiter's payload rather than hidden in the UI, `filterOptions.recruiters` is empty, and jobs and vendors are limited to their assignments. The response carries `viewer: { role, owner }` and `scope.type` is `SELF` for a recruiter. On the drill-down, the `RECRUITER` and `INVOICE_STATE` dimensions return 403 for a recruiter and `summary.byRecruiter` is empty.

`GET /crm/monitoring/drilldown` resolves one dashboard figure to the candidates behind it. It accepts the same range and slice filters plus `dimension` (`ALL`, `STAGE`, `PIPELINE_STAGE`, `RECRUITER`, `JOB`, `VENDOR`, `SOURCE`, `CANDIDATE_TYPE`, `LOCATION`, `LANGUAGE`, `INVOICE_STATE`), a `value` required for every dimension except `ALL`, and `page`/`limit`. `PIPELINE_STAGE` and `INVOICE_STATE` describe the present and therefore ignore the reporting range; all other dimensions are scoped to attributed events inside it. The response contains a `summary` (totals plus `byStage`, `byRecruiter`, `byJob` and `trend` for the nested charts), a paginated `items` array of candidate rows, and `capped: true` when the match exceeds the 5000-candidate resolution cap.

## Payroll, communication, documents, and administration

| Access | Operations |
|---|---|
| OWNER | `POST /payroll-periods`; `GET /payroll-periods/:id`; `POST /payroll-periods/:id/calculate`, `/approve`, `/reopen`; `PATCH /payroll-lines/:id`; `POST /payroll-lines/:id/payslip`; `POST /payslips/:id/approve`, `/publish` |
| RECRUITER self | `GET /payslips/me`, `/payslips/:id/download` |
| BOTH | `GET /messages/partners`, `/messages/conversations`, `/messages/conversations/:id`; `POST /messages/conversations`, `/messages/conversations/:id/messages`, `/read`; `GET /notifications`; `POST /notifications/read-all`, `/notifications/:id/read` |
| OWNER | `GET /admin/conversations`; `GET/PATCH /admin/companies`; `GET /audit-events`; `GET /reports/dashboard/admin`, `/admin/live`, `/admin/drilldown`; `POST /reports/export` |
| RECRUITER | `GET /reports/dashboard/recruiter` |
| BOTH scoped | `GET /employees/:id/documents`; `GET /documents/:id`, `/documents/:id/download` |
| OWNER | `POST /employees/:id/documents`, `/documents`; `DELETE /documents/:id`; `PATCH /documents/:id/scan-status` |

Approval, reopen, credential reset, and invoice-raise requests that carry financial or retry risk require an `Idempotency-Key` header where enforced by the route.

### Admin dashboard report

`GET /reports/dashboard/admin` accepts `preset=today|week|month|quarter|year|custom` (default `today`), plus `startDate` and `endDate` as inclusive `YYYY-MM-DD` values when `preset=custom`. It also accepts `department` and `employeeId` to narrow every block to one slice of the workforce, `granularity=day|week|month` to override the bucket size of `timeseries` (otherwise derived from the range length), `exclude=performance` to skip the recruiter-attribution aggregation, and `attendancePage`/`attendanceLimit` (maximum 100) for the attendance rows. Today, Monday-based week, month, quarter, and year boundaries are calculated in the saved company timezone.

`exclude=performance` is the only way the payload differs from earlier versions: `performance` is still computed by default, so existing callers are unaffected, but the admin Overview passes `exclude=performance` because recruiter activity has its own page at `GET /crm/monitoring/analytics`.

The response data has this shape:

```json
{
  "range": { "preset": "today", "startDate": "2026-09-15", "endDate": "2026-09-15", "timezone": "Asia/Kolkata" },
  "cards": { "headcount": 20, "activeHeadcount": 18, "working": 12, "onLeave": 2, "pendingLeave": 3, "approvedLeave": 2 },
  "attendance": { "items": [], "page": 1, "limit": 25, "total": 0, "pages": 0 },
  "workingHours": [],
  "performance": [],

  "comparisonRange": { "preset": "custom", "startDate": "2026-09-14", "endDate": "2026-09-14", "timezone": "Asia/Kolkata" },
  "granularity": "day",
  "workingDays": 14,
  "scope": { "type": "ALL", "name": "All employees", "employeeId": null, "department": null },
  "workday": { "workdayStartTime": "09:30", "workdayGraceMinutes": 10, "standardWorkMinutes": 480, "workweek": [1,2,3,4,5], "punctualityAvailable": true, "lateAfter": "09:40" },
  "filterOptions": { "departments": [], "employees": [] },
  "kpis": { "presenceRate": { "value": 71.4, "previous": 68.0, "deltaPct": 5.0, "unit": "percent" } },
  "timeseries": [{ "bucket": "2026-09-15", "present": 3, "onLeave": 0, "absent": 1, "workedHours": 23.8, "breakHours": 2.9, "completed": 3, "missingLogout": 0 }],
  "composition": { "byDepartment": [], "byDesignation": [], "bySalaryType": [], "byStatus": [], "tenureBands": [] },
  "movement": { "joiners": [], "leavers": [], "anniversaries": [] },
  "leave": { "byType": [], "byStatus": [], "queue": { "pending": 2, "oldestPendingDays": 14, "stale": 1, "aging": [], "items": [] }, "upcoming": [] },
  "payroll": { "latest": null, "history": [] },
  "exceptions": { "counts": {}, "missingLogout": [], "longBreak": [], "zeroHour": [], "shortDay": [], "late": [], "corrected": [], "neverClockedIn": [] },
  "leaderboard": { "topAttendance": [], "bottomAttendance": [] }
}
```

Every `kpis` entry is `{ value, previous, deltaPct }` plus an optional `unit` of `percent` or `hours`, compared against `comparisonRange` — the preceding window of equal length. A KPI the data model cannot answer is returned as `null` rather than as zero, so the UI can omit it: `punctualityRate` and `lateDays` are `null` until an owner sets `settings.workdayStartTime`, and `presenceRate` is `null` when the range contains no working days. There is no holiday calendar, so `workingDays` and the `absent` series count `settings.workweek` days only.

Attendance items contain `employeeId`, `employeeName`, `date`, `loginAt`, `logoutAt`, `status`, `workedMinutes`, and `breakMinutes`. `workingHours` contains one row per employee with `employeeId`, `employeeName`, and accumulated `workedMinutes` and `breakMinutes` for the complete selected range. Performance items contain `employeeId`, `employeeName`, `submission`, `shortlisted`, `interviewScheduled`, `selected`, `rejected`, and `joined`. Leave metrics include requests whose leave dates overlap the selected period; recruitment metrics use historically stored recruiter attribution on stage events.

### Live workforce

`GET /reports/dashboard/admin/live` answers "who is working right now" and takes **no parameters** — it is always the current instant on the company's business date, so the Overview's date filter governs the analysis below it without ever changing what the live panel means.

The response carries `businessDate`, `timeZone` and `serverNow`; `serverNow` lets a browser correct for a skewed local clock and tick each duration forward between polls instead of re-fetching. `counters` holds `totalEmployees`, `working`, `onBreak`, `yetToClockIn`, `finished`, `onLeaveToday`, `upcomingLeave` (approved and starting within 30 days) and `pendingApprovals`; the five status counts always sum to `totalEmployees`. `employees` is one row per active employee — `employeeId`, `employeeName`, `employeeCode`, `department`, `designation`, `status` (`WORKING`, `ON_BREAK`, `COMPLETED`, `NOT_STARTED` or `ON_LEAVE`), `loginAt`, `currentSince`, `workedMinutes`, `breakMinutes`, the raw `segments`, and `leave` when approved leave covers today — ordered working, on break, yet to clock in, finished, on leave, then by name. An actual clock-in outranks approved leave, so someone who came in anyway reads as working. The roster is capped at 500 employees and `truncated` says whether the cap was hit. This is a read: it does not close stale shifts, so a forgotten clock-out stays visible as an exception rather than being silently repaired.

### Workforce drill-down

`GET /reports/dashboard/admin/drilldown` resolves one figure on the Overview to the records behind it. It takes the same range and scope parameters as the dashboard, plus `dimension`, an optional `value`, and `page`/`limit` (maximum 100).

Attendance dimensions: `PRESENT`, `MISSING_LOGOUT`, `CURRENTLY_WORKING`, `ON_BREAK_NOW`, `ZERO_HOUR`, `SHORT_DAY`, `OVERTIME`, `LONG_BREAK`, `LATE`, `CORRECTED`, and `ATTENDANCE_STATUS` (which requires a `value`). Employee dimensions: `DEPARTMENT`, `DESIGNATION`, `SALARY_TYPE`, `EMPLOYMENT_STATUS`, `TENURE_BAND`, `JOINERS`, `LEAVERS`, `ANNIVERSARIES`, `NEVER_CLOCKED_IN`, `ABSENT`. Leave dimensions: `LEAVE_STATUS`, `LEAVE_TYPE`, `LEAVE_UPCOMING`, `LEAVE_PENDING_AGE`, `ON_LEAVE`. Plus `PAYROLL_LINES`.

The response returns `dimension`, `value`, `label`, a `kind` of `ATTENDANCE`, `EMPLOYEE`, `LEAVE` or `PAYROLL`, the `columns` to render, a paginated `items` array, and `seeAll` — the in-app path and query that show the same records on their own page. `LATE` returns 400 until `settings.workdayStartTime` is configured, and an unknown dimension returns 400.
