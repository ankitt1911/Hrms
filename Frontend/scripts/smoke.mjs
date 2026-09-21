import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const { calculateWorkedSeconds, dateKeyInTimeZone, estimateServerTimestamp } = await import("../src/Utlis/Common/attendanceTime.js");
const [app, endpoints, methods, apiService, polling, attendanceClock, downloads, resourceWorkspace, guards, coreWorkspaces, dashboard] = await Promise.all([
  read("src/App.jsx"), read("src/Services/apiConstant.jsx"), read("src/Services/apiMethod.jsx"), read("src/Services/apiService.jsx"),
  read("src/hooks/usePolling.js"), read("src/hooks/useAttendanceClock.js"), read("src/Utlis/Common/download.js"),
  read("src/components/custom/ResourceWorkspace.jsx"), read("src/components/custom/guards.jsx"), read("src/components/workspaces/CoreWorkspaces.jsx"), read("src/components/dashboard/Dashboard.jsx"),
]);
const [crmEntry, crmMonitor, crmFilters, crmDrilldown, crmApis, styles] = await Promise.all([
  read("src/components/crm/Crm.jsx"), read("src/components/crm/CrmMonitorDashboard.jsx"), read("src/components/crm/monitor/MonitorFilterBar.jsx"),
  read("src/components/crm/monitor/DrilldownModal.jsx"), read("src/Services/apiCalling/crmApis.jsx"), read("src/index.css"),
]);

const routes = ["/dashboard", "/profile", "/employees", "/attendance/me", "/attendance", "/leave/me", "/leave/queue", "/payroll", "/payslips/me", "/vendors", "/vendors/:id", "/jobs", "/jobs/assigned", "/crm/submissions", "/crm/shortlisted", "/crm/interview-scheduled", "/crm/selected", "/crm/rejected", "/crm/joined", "/crm/my-pipeline", "/crm/candidates", "/crm/monitoring", "/placements", "/messages", "/notifications", "/documents/me", "/audit", "/reports", "/admin/company"];
for (const route of routes) assert.ok(app.includes(`path="${route}"`), `Missing route ${route}`);
for (const removed of [["/admin/", "roles"].join(""), ["/jobs/", "active"].join("")]) assert.ok(!app.includes(`path="${removed}"`), `Obsolete route ${removed}`);
assert.match(app, /Gate role=\{ROLES\.SUPER_ADMIN\}/, "Owner routes need a fixed-role gate");
assert.match(app, /Gate role=\{ROLES\.RECRUITER\}/, "Recruiter routes need a fixed-role gate");
assert.match(guards, /user\?\.role/, "Route guards must inspect the fixed role");

const registryKeys = new Set([...endpoints.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]));
for (const match of methods.matchAll(/^export const (\w+Api) = .*?apiConstant\.(\w+)/gm)) assert.ok(registryKeys.has(match[2]), `${match[1]} references unknown endpoint ${match[2]}`);
for (const name of ["ResetEmployeeCredentialsApi", "ApprovePayrollPeriodApi", "ReopenPayrollPeriodApi", "RaiseInvoiceApi"]) {
  const line = methods.split("\n").find((sourceLine) => sourceLine.startsWith(`export const ${name} `));
  assert.match(line || "", /idempotencyHeaders\(key\)/, `${name} must send an Idempotency-Key`);
}
assert.match(apiService, /normalized\.statusCode === 401 && normalized\.code === "AUTH_TOKEN_EXPIRED"/);
assert.match(apiService, /refreshPromise/);
assert.match(polling, /document\.visibilityState !== "hidden"/);
assert.match(attendanceClock, /effectiveRecord\?\.serverNow/);
assert.match(downloads, /\["http:", "https:"\]/);
assert.match(resourceWorkspace, /requestRef\.current/);
for (const field of ["companyName", "process", "skills", "salaryRange", "monthlyCtc", "takeHomeSalary", "vendorPayment", "clauseDays", "jobType", "requirements"]) assert.ok(coreWorkspaces.includes(`name:\"${field}\"`), `Missing job opening field ${field}`);
assert.match(coreWorkspaces, /isOwner&&<JobDetail[^>]+label=\"Vendor payment · Internal\"/, "Internal vendor payment must be owner-gated in job details");
for (const label of ["Headcount", "Active headcount", "Working", "On leave", "Pending leave", "Approved leave", "Custom date range", "Working hours", "Employee performance"]) assert.ok(dashboard.includes(label), `Missing admin dashboard element: ${label}`);
assert.match(dashboard, /preset === \"custom\" \? customRange/, "Custom dashboard dates must be sent with the shared report request");
assert.match(dashboard, /setAttendancePage\(1\)/, "Dashboard filter changes must reset attendance pagination");
// Both roles render the same dashboard; the server decides what each may see.
assert.match(dashboard, /if \(!admin\) return <CrmMonitorDashboard/, "Recruiter overview must reuse the CRM monitor dashboard");

// The owner-only CRM monitor is a separate component: the recruiter Overview
// must keep rendering the untouched shared activity dashboard.
assert.match(crmEntry, /export function CrmMonitoring\(\) \{\s*return <CrmMonitorDashboard\/>;/, "CRM monitoring must render the owner dashboard");
for (const label of ["Activity trend", "Conversion funnel", "Live pipeline", "Recruiter performance", "Portfolio mix", "Revenue and invoices", "Stage counters"]) {
  assert.ok(crmMonitor.includes(label), `Missing CRM monitor section: ${label}`);
}
assert.match(crmMonitor, /requestRef\.current/, "CRM monitor must discard stale analytics responses");
assert.match(crmMonitor, /useSearchParams/, "CRM monitor filters must live in the URL so a filtered view is shareable");
assert.match(crmMonitor, /params: queryParams/, "Drill-downs must inherit the active dashboard filters");
assert.match(crmMonitor, /onClose=\{\(\) => \{ if \(!candidateId\) setDrilldown\(null\); \}\}/, "Escape must unwind one drill-down level at a time");
for (const preset of ["today", "week", "month", "quarter", "custom"]) {
  assert.ok(crmFilters.includes(`value: "${preset}"`), `Missing CRM monitor period preset: ${preset}`);
}
for (const slice of ["employeeId", "jobOpeningId", "vendorId", "candidateType", "source", "location"]) {
  assert.ok(crmFilters.includes(`key: "${slice}"`), `Missing CRM monitor slice filter: ${slice}`);
}
assert.match(crmDrilldown, /onSelectCandidate\(row\._id\)/, "Drill-down rows must open the candidate record");
// Owner-only sections must be gated on the server-supplied viewer flag, never
// merely filtered out of a payload the recruiter already received.
assert.match(crmMonitor, /const owner = data \? data\.viewer\?\.owner !== false : true;/, "Dashboard must read the viewer role from the payload");
for (const ownerOnly of ["Recruiter performance", "Revenue and invoices"]) {
  const index = crmMonitor.indexOf(`title="${ownerOnly}"`);
  assert.ok(index > 0, `Missing section ${ownerOnly}`);
  assert.ok(crmMonitor.lastIndexOf("{owner ? (", index) > crmMonitor.lastIndexOf(") : null}", index), `${ownerOnly} must be owner-gated`);
}
assert.match(crmFilters, /owner \? SLICES : SLICES\.filter/, "The recruiter picker must be hidden from recruiters");
// The candidate modal stacks on top of the drill-down. If its backdrop sits
// below, it still mounts but is painted behind an opaque backdrop and opening a
// row looks like nothing happened.
const backdropZ = Number(styles.match(/\.modal-backdrop \{[^}]*?z-index: (\d+)/)?.[1]);
const candidateZ = Number(styles.match(/\.modal-backdrop:has\(\.modal--crm-candidate\) \{ z-index: (\d+)/)?.[1]);
assert.ok(Number.isFinite(backdropZ) && Number.isFinite(candidateZ), "Modal stacking z-indexes must be declared");
assert.ok(candidateZ > backdropZ, `Candidate modal backdrop (${candidateZ}) must stack above the base modal backdrop (${backdropZ})`);
for (const handler of ["handleGetCrmAnalytics", "handleGetCrmDrilldown"]) {
  assert.ok(crmApis.includes(`export const ${handler}`), `Missing CRM API handler ${handler}`);
}

const skewedServerNow = estimateServerTimestamp({ serverNow: "2026-09-13T09:00:00.000Z", receivedAt: Date.parse("2031-01-01T00:00:00.000Z"), localNow: Date.parse("2031-01-01T00:00:05.000Z") });
assert.equal(skewedServerNow, Date.parse("2026-09-13T09:00:05.000Z"));
assert.equal(calculateWorkedSeconds({ workedMinutes: 17, segments: [] }, Date.now()), 1020);
assert.equal(dateKeyInTimeZone("2026-09-13T20:28:00.000Z", "Asia/Kolkata"), "2026-09-14");

async function sourceFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? sourceFiles(`${directory}${entry.name}/`) : [`${directory}${entry.name}`]));
  return nested.flat();
}
const forbidden = new RegExp(["role"+"Ids", "crm"+"Enabled", "permissions"+"\\.constants", "use"+"Permission", "components\\/custom\\/"+"Can"].join("|"));
for (const file of await sourceFiles("src/")) {
  if (!/\.(js|jsx)$/.test(file)) continue;
  const source = await read(file);
  assert.ok(!forbidden.test(source), `Obsolete authorization reference in ${file}`);
  if (file !== "src/Services/apiConstant.jsx") assert.ok(!/['"`]\/api\/v1/.test(source), `Raw API URL outside registry in ${file}`);
  if (file.startsWith("src/components/") || file.startsWith("src/pages/")) assert.ok(!/Services\/apiMethod|\baxios\b|\bapiRequest\s*\(/.test(source), `UI bypasses apiCalling layer in ${file}`);
}

console.log(`Two-role smoke contract passed: ${routes.length} protected workspaces and fixed-role authorization invariants.`);
