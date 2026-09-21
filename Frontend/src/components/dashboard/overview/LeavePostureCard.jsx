import { AlertTriangle } from "lucide-react";
import { BarChart, ChartCard, DonutChart } from "../../custom/charts";
import { DataTable, DateText } from "../../custom/ui";
import { categoricalColor, formatCount } from "../../../constants/chart.constants";
import { PRESENCE_COLORS } from "./constants";

const STALE_AFTER_DAYS = 5;

/*
 * Two questions in one card: how long people have been waiting for a decision, and
 * who is about to be away. The oldest-pending callout is the one number an owner
 * acts on, so it is stated in words above the chart rather than left to be read
 * off an axis.
 */
export default function LeavePostureCard({ leave, onDrill }) {
  const aging = (leave?.queue?.aging || []).map((row, index) => ({ ...row, value: row.count, color: index >= 2 ? PRESENCE_COLORS.absent : categoricalColor(index) }));
  const types = (leave?.byType || []).map((row, index) => ({ key: row.leaveTypeId, label: row.label, value: row.days, count: row.days, color: categoricalColor(index) }));
  const oldest = leave?.queue?.oldestPendingDays || 0;
  const pending = leave?.queue?.pending || 0;

  return (
    <ChartCard
      title="Leave and approvals"
      description={pending ? `${formatCount(pending)} request${pending === 1 ? "" : "s"} awaiting a decision. Select a band or slice to review them.` : "Nothing is waiting for a decision."}
      empty={!pending && !types.length && !(leave?.upcoming || []).length}
      emptyDescription="No leave was requested or approved in this period."
      className="overview-leave-card"
      footer={(leave?.upcoming || []).length ? (
        <DataTable
          rows={leave.upcoming}
          columns={[
            { key: "employeeName", label: "Away next" },
            { key: "leaveTypeName", label: "Leave type" },
            { key: "startDate", label: "From", render: (value) => <DateText value={value} /> },
            { key: "endDate", label: "To", render: (value) => <DateText value={value} /> },
            { key: "days", label: "Days", align: "right" },
          ]}
        />
      ) : <p className="muted">Nobody has approved leave coming up.</p>}
    >
      {oldest >= STALE_AFTER_DAYS ? (
        <p className="overview-callout" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>The oldest request has been waiting <b className="tabular">{oldest} days</b>{leave.queue.stale > 1 ? `, and ${formatCount(leave.queue.stale)} have waited over ${STALE_AFTER_DAYS} days` : ""}.</span>
          <button type="button" onClick={() => onDrill("LEAVE_STATUS", "PENDING", "Leave awaiting decision")}>Review the queue</button>
        </p>
      ) : null}
      <div className="crm-monitor-mix">
        <BarChart
          data={aging}
          series={[{ key: "count", label: "Requests waiting" }]}
          layout="vertical"
          height={Math.max(180, aging.length * 38 + 50)}
          onBarClick={(row) => row && row.count > 0 && onDrill("LEAVE_PENDING_AGE", row.key, `Pending ${row.label.toLowerCase()}`)}
          ariaLabel="Pending leave requests by how long they have been waiting"
        />
        <DonutChart
          data={types}
          height={240}
          centerLabel="Leave days"
          onSliceClick={(slice) => slice && onDrill("LEAVE_TYPE", slice.key, `Leave type: ${slice.label}`)}
          ariaLabel="Leave days requested by leave type"
        />
      </div>
    </ChartCard>
  );
}
