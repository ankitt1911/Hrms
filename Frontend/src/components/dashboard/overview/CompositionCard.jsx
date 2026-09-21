import { useMemo, useState } from "react";
import { BarChart, ChartCard, DonutChart } from "../../custom/charts";
import { SegmentedTabs } from "../../custom/ui";
import { COMPOSITION_TABS } from "./constants";
import { categoricalColor, formatCount } from "../../../constants/chart.constants";

// Tenure is ordinal, so it keeps its natural order; every other dimension is
// unordered and sorts by size so the largest group reads first.
export default function CompositionCard({ composition, onDrill }) {
  const [tab, setTab] = useState("byDepartment");
  const active = COMPOSITION_TABS.find((item) => item.value === tab);
  const rows = useMemo(() => (composition?.[tab] || []).map((row, index) => ({ ...row, value: row.count, color: categoricalColor(index) })), [composition, tab]);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <ChartCard
      title="Who works here"
      description={`How the ${formatCount(total)} people on the roster split by ${active.label.toLowerCase()}. Select a bar or slice to see them.`}
      actions={<SegmentedTabs tabs={COMPOSITION_TABS} active={tab} onChange={setTab} />}
      empty={!rows.length}
      emptyDescription="No employees matched this breakdown."
      className="overview-composition-card"
      footer={tab === "byDepartment" ? <p className="muted">Department is free text on the employee record, so spelling variants appear as separate groups.</p> : null}
    >
      <div className="crm-monitor-mix">
        <BarChart
          data={rows}
          series={[{ key: "count", label: "Employees" }]}
          layout="vertical"
          height={Math.max(200, rows.length * 36 + 50)}
          onBarClick={(row) => row && row.key !== "__OTHER__" && onDrill(active.dimension, row.key, `${active.label}: ${row.label}`)}
          ariaLabel={`Employees by ${active.label.toLowerCase()}`}
        />
        <DonutChart
          data={rows}
          height={260}
          centerLabel="Employees"
          onSliceClick={(slice) => slice && slice.key !== "__OTHER__" && onDrill(active.dimension, slice.key, `${active.label}: ${slice.label}`)}
          ariaLabel={`Share of employees by ${active.label.toLowerCase()}`}
        />
      </div>
    </ChartCard>
  );
}
