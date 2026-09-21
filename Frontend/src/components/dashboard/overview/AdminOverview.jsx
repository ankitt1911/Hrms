import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import * as reports from "../../../Services/apiCalling/reportApis";
import { Button, ErrorState, Field, Modal, PageHeading, Skeleton } from "../../custom/ui";
import usePrefersReducedMotion from "../../../motion/usePrefersReducedMotion";
import LiveNowPanel from "./LiveNowPanel";
import OverviewTabs from "./OverviewTabs";
import WorkforceDrilldownModal from "./WorkforceDrilldownModal";
import { TABS } from "./constants";

const FILTER_KEYS = ["preset", "startDate", "endDate", "department", "employeeId", "granularity", "tab"];
const DEFAULT_FILTERS = { preset: "month", startDate: "", endDate: "", department: "", employeeId: "", granularity: "", tab: "attendance" };

/*
 * Two halves, deliberately separate.
 *
 *  - `LiveNowPanel` is always today and refreshes itself. It answers the question
 *    an admin actually opens this page with: who is working, right now.
 *  - `OverviewTabs` is the historical analysis, governed by the date filter, with
 *    one section on screen at a time.
 *
 * Keeping the date filter off the live panel is the point: a filter that silently
 * changed what "right now" means would make the top of the page untrustworthy.
 */
export default function AdminOverview({ title, meta }) {
  const reduced = usePrefersReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attendancePage, setAttendancePage] = useState(1);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftRange, setDraftRange] = useState({ startDate: "", endDate: "" });
  const [drilldown, setDrilldown] = useState(null);
  const requestRef = useRef(0);

  const filters = useMemo(() => {
    const next = { ...DEFAULT_FILTERS };
    for (const key of FILTER_KEYS) { const value = searchParams.get(key); if (value) next[key] = value; }
    if (!TABS.some((item) => item.value === next.tab)) next.tab = DEFAULT_FILTERS.tab;
    return next;
  }, [searchParams]);

  const setFilters = useCallback((patch) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
      return next;
    }, { replace: true });
    if (!("tab" in patch)) setAttendancePage(1);
  }, [setSearchParams]);

  // The scope a drill-down inherits: the window and filters, without the
  // presentation-only granularity or tab.
  const queryParams = useMemo(() => {
    const params = { preset: filters.preset };
    if (filters.preset === "custom") { params.startDate = filters.startDate; params.endDate = filters.endDate; }
    if (filters.department) params.department = filters.department;
    if (filters.employeeId) params.employeeId = filters.employeeId;
    return params;
  }, [filters]);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    try {
      // Recruiter performance lives on /crm/monitoring, so the server is told not
      // to compute it for this page.
      const next = await reports.handleGetAdminDashboard({ ...queryParams, exclude: "performance", attendancePage, attendanceLimit: 25, ...(filters.granularity ? { granularity: filters.granularity } : {}) });
      if (requestId === requestRef.current) setData(next);
    } catch (requestError) {
      if (requestId === requestRef.current) setError(requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [attendancePage, filters.granularity, queryParams]);

  useEffect(() => { load(); }, [load]);

  const openDrill = useCallback((dimension, value, label, overrides) => setDrilldown({ dimension, value: value || "", label, params: { ...queryParams, ...overrides } }), [queryParams]);
  // A row on the live board drills into that person's attendance for the period.
  const openEmployee = useCallback((row) => openDrill("PRESENT", "", `${row.employeeName} · attendance`, { employeeId: String(row.employeeId) }), [openDrill]);

  const rangeError = draftRange.startDate && draftRange.endDate && draftRange.startDate > draftRange.endDate ? "The end date must be on or after the start date." : "";
  const applyCustom = () => { if (!draftRange.startDate || !draftRange.endDate || rangeError) return; setFilters({ preset: "custom", ...draftRange }); setCustomOpen(false); };
  const openCustomRange = () => { setDraftRange({ startDate: filters.startDate, endDate: filters.endDate }); setCustomOpen(true); };

  return (
    <main className="page-content overview-page">
      <PageHeading
        meta={meta || "Workforce overview"}
        title={title || "Overview"}
        actions={<Link className="button button--secondary" to="/crm/monitoring">Recruitment monitor <ArrowUpRight size={15} /></Link>}
      />

      <LiveNowPanel onDrill={openDrill} onSelectEmployee={openEmployee} />

      {error ? <ErrorState message={error} onRetry={load} /> : loading && !data ? <Skeleton rows={6} /> : (
        <OverviewTabs
          tab={filters.tab}
          onTabChange={(value) => setFilters({ tab: value })}
          filters={filters}
          setFilters={setFilters}
          onOpenCustomRange={openCustomRange}
          data={data}
          loading={loading}
          reduced={reduced}
          onDrill={openDrill}
          onAttendancePage={setAttendancePage}
        />
      )}

      <Modal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Custom date range"
        description="Choose an inclusive reporting period for the analysis below."
        footer={<><Button variant="secondary" onClick={() => setCustomOpen(false)}>Cancel</Button><Button disabled={!draftRange.startDate || !draftRange.endDate || Boolean(rangeError)} onClick={applyCustom}>Apply range</Button></>}
      >
        <div className="form-stack">
          <Field label="From date"><input className="control" type="date" required value={draftRange.startDate} onChange={(event) => setDraftRange((current) => ({ ...current, startDate: event.target.value }))} /></Field>
          <Field label="To date" error={rangeError}><input className={`control ${rangeError ? "control--error" : ""}`} type="date" required min={draftRange.startDate || undefined} value={draftRange.endDate} onChange={(event) => setDraftRange((current) => ({ ...current, endDate: event.target.value }))} /></Field>
        </div>
      </Modal>

      <WorkforceDrilldownModal open={Boolean(drilldown)} request={drilldown} timeZone={data?.range?.timezone || "UTC"} onClose={() => setDrilldown(null)} />
    </main>
  );
}
