import { useState } from "react";
import { ChartCard, TrendChart } from "../../custom/charts";
import { DataTable, SegmentedTabs } from "../../custom/ui";
import { HOURS_COLORS, PRESENCE_COLORS, bucketTick } from "./constants";
import { formatCount } from "../../../constants/chart.constants";

const VIEWS = [{ value: "presence", label: "Presence" }, { value: "hours", label: "Hours" }];

const PRESENCE_SERIES = [
  { key: "present", label: "At work", color: PRESENCE_COLORS.present },
  { key: "onLeave", label: "On leave", color: PRESENCE_COLORS.onLeave },
  { key: "absent", label: "Unaccounted", color: PRESENCE_COLORS.absent },
];
const HOURS_SERIES = [
  { key: "workedHours", label: "Worked hours", color: HOURS_COLORS.workedHours },
  { key: "breakHours", label: "Break hours", color: HOURS_COLORS.breakHours },
];

/*
 * The table under the chart is not decoration: several palette hues sit below the
 * 3:1 contrast floor on this surface, so every charted figure is also readable as
 * a number.
 */
export default function PresenceTrendCard({ timeseries, granularity, rangeLabel, workingDays, hidden, onToggleSeries, onDrill }) {
  const [view, setView] = useState("presence");
  const series = view === "presence" ? PRESENCE_SERIES : HOURS_SERIES;
  const empty = !timeseries?.some((bucket) => series.some((item) => bucket[item.key] > 0));
  const perBucket = granularity === "day" ? "day" : granularity === "week" ? "week" : "month";

  return (
    <ChartCard
      title="Attendance and presence"
      description={view === "presence"
        ? `Employees at work, on approved leave, and unaccounted for per ${perBucket} across ${rangeLabel}. ${workingDays} working ${workingDays === 1 ? "day" : "days"} in this period. Select a legend key to hide a series.`
        : `Total hours worked and taken as breaks per ${perBucket} across ${rangeLabel}.`}
      actions={<SegmentedTabs tabs={VIEWS} active={view} onChange={setView} />}
      empty={empty}
      emptyDescription="No attendance was recorded in this period."
      className="overview-trend-card"
      footer={(
        <DataTable
          rowKey="bucket"
          rows={(timeseries || []).slice(-12)}
          columns={[
            { key: "bucket", label: perBucket === "day" ? "Day" : perBucket === "week" ? "Week of" : "Month", render: bucketTick },
            { key: "present", label: "At work", align: "right", render: formatCount },
            { key: "onLeave", label: "On leave", align: "right", render: formatCount },
            { key: "absent", label: "Unaccounted", align: "right", render: formatCount },
            { key: "workedHours", label: "Worked (hrs)", align: "right" },
            { key: "breakHours", label: "Break (hrs)", align: "right" },
            { key: "missingLogout", label: "No clock-out", align: "right", render: formatCount },
          ]}
        />
      )}
    >
      <TrendChart
        data={timeseries || []}
        series={series}
        hidden={hidden}
        onToggleSeries={onToggleSeries}
        onPointClick={view === "presence" ? () => onDrill("PRESENT", "", "Present days") : undefined}
        xTickFormat={bucketTick}
        height={320}
        brush
        ariaLabel={view === "presence" ? `Employees at work, on leave and unaccounted for per ${perBucket} across ${rangeLabel}` : `Hours worked and taken as breaks per ${perBucket} across ${rangeLabel}`}
      />
    </ChartCard>
  );
}
