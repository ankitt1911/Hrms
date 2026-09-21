import { BarChart, ChartCard } from "../../custom/charts";
import { EmptyState, Money, StatusBadge } from "../../custom/ui";
import { STAGE_RAMP, formatCount, formatMoney, formatPercent } from "../../../constants/chart.constants";

/*
 * Payslip progress is a ratio of published to total, shown as a meter with the
 * figures spelled out beside it — the bar alone would not tell an owner whether
 * "80%" is eight of ten or forty of fifty.
 */
export default function PayrollSnapshotCard({ payroll, onDrill }) {
  const latest = payroll?.latest;
  if (!latest) {
    return (
      <section className="surface dashboard-section chart-card overview-payroll-card">
        <header><div><h2>Payroll</h2><p>The latest pay period at a glance.</p></div></header>
        <div className="chart-card__body"><EmptyState title="No payroll yet" description="Create a payroll period to see gross, net and payslip progress here." /></div>
      </section>
    );
  }
  const slips = latest.payslips;
  const publishedPct = slips.total > 0 ? (slips.published / slips.total) * 100 : 0;
  const history = (payroll.history || []).map((row) => ({ key: String(row.periodId), label: row.periodLabel, count: row.netPay, color: STAGE_RAMP[3] }));

  return (
    <ChartCard
      title="Payroll"
      description={`${latest.periodLabel} · ${formatCount(latest.employeeCount)} employee${latest.employeeCount === 1 ? "" : "s"} on this run.`}
      actions={<StatusBadge value={latest.status} />}
      className="overview-payroll-card"
      footer={(
        <div className="overview-payroll-figures">
          {[["Gross", latest.grossPay], ["Deductions", latest.deductions], ["Net pay", latest.netPay]].map(([label, value]) => (
            <div key={label}><span>{label}</span><strong className="tabular"><Money value={value} /></strong></div>
          ))}
        </div>
      )}
    >
      <div className="overview-progress">
        <div className="overview-progress__head">
          <span>Payslips published</span>
          <b className="tabular">{formatCount(slips.published)} of {formatCount(slips.total)}{slips.total ? ` · ${formatPercent(publishedPct)}` : ""}</b>
        </div>
        <div className="overview-progress__track" role="img" aria-label={`${formatCount(slips.published)} of ${formatCount(slips.total)} payslips published`}>
          <i style={{ width: `${Math.min(100, publishedPct)}%` }} />
        </div>
        <p className="overview-progress__legend">
          <span>{formatCount(slips.draft)} draft</span><span>{formatCount(slips.approved)} approved</span><span>{formatCount(slips.published)} published</span>
          {slips.withdrawn ? <span>{formatCount(slips.withdrawn)} withdrawn</span> : null}
        </p>
      </div>
      {history.length > 1 ? (
        <BarChart
          data={history}
          series={[{ key: "count", label: "Net pay" }]}
          height={Math.max(160, history.length * 34 + 50)}
          layout="vertical"
          valueFormat={formatMoney}
          onBarClick={(row) => row && onDrill("PAYROLL_LINES", row.key, `Payroll ${row.label}`)}
          ariaLabel="Net pay by recent payroll period"
        />
      ) : null}
    </ChartCard>
  );
}
