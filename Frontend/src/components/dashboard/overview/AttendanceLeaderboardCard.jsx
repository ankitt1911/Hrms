import { useState } from "react";
import { BarChart, ChartCard } from "../../custom/charts";
import { DataTable, SegmentedTabs } from "../../custom/ui";
import { HOURS_COLORS } from "./constants";
import { formatCount, formatPercent } from "../../../constants/chart.constants";

const VIEWS = [{ value: "topAttendance", label: "Most present" }, { value: "bottomAttendance", label: "Least present" }];

const SERIES = [
  { key: "workedHours", label: "Worked hours", color: HOURS_COLORS.workedHours },
  { key: "breakHours", label: "Break hours", color: HOURS_COLORS.breakHours },
];

/*
 * "Least present" is the view an owner actually needs, but it is the second tab on
 * purpose: opening on a list of the worst performers frames the whole dashboard as
 * a disciplinary tool rather than an operational one.
 */
export default function AttendanceLeaderboardCard({ leaderboard, workingDays, onDrill }) {
  const [view, setView] = useState("topAttendance");
  const rows = leaderboard?.[view] || [];
  const data = rows.map((row) => ({ ...row, label: row.employeeName }));

  return (
    <ChartCard
      title="Attendance by employee"
      description={`Hours worked and taken as breaks per person, out of ${workingDays} working ${workingDays === 1 ? "day" : "days"}. Select a bar to see that person's records.`}
      actions={<SegmentedTabs tabs={VIEWS} active={view} onChange={setView} />}
      empty={!rows.length}
      emptyDescription="No attendance was recorded for anyone in this period."
      className="overview-leaderboard-card"
      footer={(
        <DataTable
          rows={rows}
          rowKey="employeeId"
          columns={[
            { key: "employeeName", label: "Employee" },
            { key: "department", label: "Department" },
            { key: "presentDays", label: "Days present", align: "right", render: formatCount },
            { key: "presenceRate", label: "Presence", align: "right", render: (value) => formatPercent(value) },
            { key: "workedHours", label: "Worked (hrs)", align: "right" },
            { key: "breakHours", label: "Break (hrs)", align: "right" },
            { key: "fullDays", label: "Full days", align: "right", render: formatCount },
            { key: "overtimeDays", label: "Overtime", align: "right", render: formatCount },
          ]}
        />
      )}
    >
      <BarChart
        data={data}
        series={SERIES}
        stacked
        layout="vertical"
        height={Math.max(220, data.length * 40 + 60)}
        onBarClick={(row) => row && onDrill("PRESENT", "", `${row.label} · attendance`, { employeeId: String(row.employeeId) })}
        ariaLabel="Hours worked and taken as breaks per employee"
      />
    </ChartCard>
  );
}
