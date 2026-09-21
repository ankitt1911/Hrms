import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTable, EmptyState, Pagination, SegmentedTabs, StatusBadge } from "../../custom/ui";
import OverviewFilterBar from "./OverviewFilterBar";
import KpiStrip from "./KpiStrip";
import PresenceTrendCard from "./PresenceTrendCard";
import CompositionCard from "./CompositionCard";
import LeavePostureCard from "./LeavePostureCard";
import PayrollSnapshotCard from "./PayrollSnapshotCard";
import ExceptionsPanel from "./ExceptionsPanel";
import MovementCard from "./MovementCard";
import AttendanceLeaderboardCard from "./AttendanceLeaderboardCard";
import { TABS, dateText, timeText } from "./constants";

const hours = (minutes) => (Number(minutes || 0) / 60).toFixed(2);

/*
 * The historical half of the page. Exactly one section renders at a time, which
 * is what keeps the page readable: the previous build stacked all of these into a
 * single 4,900px scroll with no hierarchy.
 *
 * The filter bar lives inside this region on purpose, so it visibly governs the
 * analysis and not the live panel above it.
 */
export default function OverviewTabs({ tab, onTabChange, filters, setFilters, onOpenCustomRange, data, loading, reduced, onDrill, onAttendancePage }) {
  const [hiddenSeries, setHiddenSeries] = useState([]);
  const toggleSeries = (key) => setHiddenSeries((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  const active = TABS.find((item) => item.value === tab) || TABS[0];
  const range = data?.range;
  const timeZone = range?.timezone || "UTC";
  const rangeLabel = range ? `${dateText(range.startDate)} – ${dateText(range.endDate)}` : "the selected period";
  const comparisonLabel = data?.comparisonRange ? `vs ${dateText(data.comparisonRange.startDate)} – ${dateText(data.comparisonRange.endDate)}` : "vs previous period";

  const kpiStrip = (
    <KpiStrip keys={active.kpis} kpis={data?.kpis} timeseries={data?.timeseries} comparisonLabel={comparisonLabel} reduced={reduced} onDrill={onDrill} />
  );

  const attendanceColumns = [
    { key: "employeeName", label: "Employee" },
    { key: "date", label: "Date", render: (value) => dateText(value) },
    { key: "loginAt", label: "Login", render: (value) => timeText(value, timeZone) },
    { key: "logoutAt", label: "Logout", render: (value) => timeText(value, timeZone) },
    { key: "status", label: "Status", render: StatusBadge },
    { key: "workedMinutes", label: "Work (hrs)", align: "right", render: hours },
    { key: "breakMinutes", label: "Break (hrs)", align: "right", render: hours },
  ];

  return (
    <section className="overview-analysis">
      <header className="overview-analysis__head">
        <div>
          <h2>Analysis</h2>
          <p>{rangeLabel} · {data?.scope?.name || "All employees"}</p>
        </div>
        <SegmentedTabs tabs={TABS} active={active.value} onChange={onTabChange} />
      </header>

      <OverviewFilterBar
        filters={filters}
        filterOptions={data?.filterOptions}
        rangeLabel={rangeLabel}
        granularity={filters.granularity || data?.granularity || "day"}
        onChange={setFilters}
        onClear={() => setFilters({ preset: "month", startDate: "", endDate: "", department: "", employeeId: "", granularity: "" })}
        onOpenCustomRange={onOpenCustomRange}
        busy={loading && !data}
      />

      {!data ? null : active.value === "attendance" ? (
        <>
          {kpiStrip}
          <PresenceTrendCard
            timeseries={data.timeseries} granularity={data.granularity} rangeLabel={rangeLabel}
            workingDays={data.workingDays} hidden={hiddenSeries} onToggleSeries={toggleSeries} onDrill={onDrill}
          />
          <AttendanceLeaderboardCard leaderboard={data.leaderboard} workingDays={data.workingDays} onDrill={onDrill} />
          <section className="surface dashboard-section">
            <header>
              <div><h2>Attendance register</h2><p>Every clock-in recorded in {rangeLabel.toLowerCase()} · times in {timeZone}.</p></div>
              <div className="chart-card__actions"><Link className="button button--quiet" to="/attendance">Open the register <ArrowUpRight size={15} /></Link></div>
            </header>
            {data.attendance?.items?.length
              ? <><DataTable rows={data.attendance.items} columns={attendanceColumns} /><Pagination page={data.attendance.page} pages={data.attendance.pages} onChange={onAttendancePage} /></>
              : <EmptyState title="No attendance records" description="Nobody clocked in during this date range." />}
          </section>
        </>
      ) : active.value === "leave" ? (
        <>{kpiStrip}<LeavePostureCard leave={data.leave} onDrill={onDrill} /></>
      ) : active.value === "people" ? (
        <>{kpiStrip}<CompositionCard composition={data.composition} onDrill={onDrill} /><MovementCard movement={data.movement} onDrill={onDrill} /></>
      ) : active.value === "attention" ? (
        <ExceptionsPanel counts={data.exceptions?.counts} onDrill={onDrill} />
      ) : (
        <PayrollSnapshotCard payroll={data.payroll} onDrill={onDrill} />
      )}
    </section>
  );
}
