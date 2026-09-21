import { useId } from "react";
import {
  Area, AreaChart, Bar, BarChart as RBarChart, Brush, CartesianGrid, Cell, Legend,
  Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { EmptyState } from "./ui";
import usePrefersReducedMotion from "../../motion/usePrefersReducedMotion";
import { CATEGORICAL, CHART_AXIS_INK, CHART_LINE, CHART_SURFACE, categoricalColor, formatCount, stageColor, stageLabel } from "../../constants/chart.constants";

/*
 * Recharts wrappers so every chart in the app shares one visual language.
 * Colour decisions and their rationale live in constants/chart.constants.js.
 * Mark specs applied here: bars capped at 24px with a 4px rounded data-end,
 * 2px lines with round caps, area fills at 10% opacity, hairline solid grid,
 * and a 2px surface gap between touching stacked segments.
 */
export function ChartCard({ title, description, actions, footer, empty, emptyDescription, children, className = "" }) {
  return (
    <section className={`surface dashboard-section chart-card ${className}`}>
      <header><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="chart-card__actions">{actions}</div>}</header>
      {empty ? <EmptyState title="Nothing to chart yet" description={emptyDescription || "No activity matched the selected period and filters."} /> : <div className="chart-card__body">{children}</div>}
      {!empty && footer ? <div className="chart-card__footer">{footer}</div> : null}
    </section>
  );
}

// Identity comes from the swatch beside the text; the text itself stays on ink
// tokens so a light hue is never asked to be legible as type.
function ChartTooltip({ active, payload, label, valueFormat = formatCount, labelFormat = (value) => value }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{labelFormat(label)}</strong>
      <ul>{payload.filter((entry) => entry.value != null).map((entry) => (
        <li key={entry.dataKey ?? entry.name}><i style={{ background: entry.color || entry.payload?.fill }} /><span>{entry.name}</span><b className="tabular">{valueFormat(entry.value)}</b></li>
      ))}</ul>
    </div>
  );
}

// Pie slices all share dataKey "value", so the index is part of the React key.
function ChartLegend({ payload, onToggle, hidden = [] }) {
  if (!payload?.length) return null;
  return (
    <ul className="chart-legend">{payload.map((entry, index) => {
      const isHidden = hidden.includes(entry.dataKey);
      return (
        <li key={`${entry.dataKey ?? "slice"}-${entry.value ?? index}-${index}`}>
          <button type="button" className={isHidden ? "is-hidden" : ""} aria-pressed={!isHidden} onClick={() => onToggle?.(entry.dataKey)} disabled={!onToggle}>
            <i style={{ background: entry.color }} /><span>{entry.value}</span>
          </button>
        </li>
      );
    })}</ul>
  );
}

const gridProps = { stroke: CHART_LINE, strokeDasharray: "0", vertical: false };
const axisProps = { stroke: CHART_LINE, tick: { fill: CHART_AXIS_INK, fontSize: 11 }, tickLine: false };

export function TrendChart({ data, series, xKey = "bucket", height = 300, type = "area", hidden = [], onToggleSeries, onPointClick, xTickFormat, ariaLabel, brush = false }) {
  const reduced = usePrefersReducedMotion();
  const visible = series.filter((item) => !hidden.includes(item.key));
  const Chart = type === "area" ? AreaChart : LineChart;
  return (
    <div className="chart-frame" style={{ height }} aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 12, bottom: brush ? 4 : 0, left: -12 }} onClick={(event) => event?.activeLabel != null && onPointClick?.(event.activeLabel)}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormat} minTickGap={18} />
          <YAxis {...axisProps} allowDecimals={false} width={46} tickFormatter={formatCount} />
          <Tooltip content={<ChartTooltip labelFormat={xTickFormat} />} cursor={{ stroke: "#c3c8c5", strokeWidth: 1 }} />
          <Legend content={<ChartLegend onToggle={onToggleSeries} hidden={hidden} />} />
          {visible.map((item) => (type === "area"
            ? <Area key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} fill={item.color} fillOpacity={0.1} strokeWidth={2} strokeLinecap="round" activeDot={{ r: 5, strokeWidth: 2, stroke: CHART_SURFACE }} dot={false} isAnimationActive={!reduced} />
            : <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2} strokeLinecap="round" activeDot={{ r: 5, strokeWidth: 2, stroke: CHART_SURFACE }} dot={false} isAnimationActive={!reduced} />))}
          {brush && data.length > 12 ? <Brush dataKey={xKey} height={22} travellerWidth={8} stroke="#0b5546" fill="#f7f7f5" tickFormatter={xTickFormat} /> : null}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

// `stacked` segments carry a 2px stroke in the SURFACE colour: that is the
// surface gap, not a border — it is what keeps neighbouring steps of one ramp
// reading as distinct marks.
export function BarChart({ data, series, categoryKey = "label", height = 320, layout = "horizontal", stacked = false, hidden = [], onToggleSeries, onBarClick, valueFormat = formatCount, ariaLabel }) {
  const reduced = usePrefersReducedMotion();
  const visible = series.filter((item) => !hidden.includes(item.key));
  const vertical = layout === "vertical";
  const lastKey = visible.at(-1)?.key;
  const radius = (item) => (!stacked || item.key === lastKey ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0);
  return (
    <div className="chart-frame" style={{ height }} aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 0, left: vertical ? 8 : -12 }} barCategoryGap={vertical ? "22%" : "26%"}>
          <CartesianGrid {...gridProps} vertical={vertical} horizontal={!vertical} />
          {vertical
            ? <><XAxis type="number" {...axisProps} allowDecimals={false} tickFormatter={valueFormat} /><YAxis type="category" dataKey={categoryKey} {...axisProps} width={132} interval={0} /></>
            : <><XAxis dataKey={categoryKey} {...axisProps} interval={0} minTickGap={4} /><YAxis {...axisProps} allowDecimals={false} width={46} tickFormatter={valueFormat} /></>}
          <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} cursor={{ fill: "rgba(18,92,78,.06)" }} />
          {series.length > 1 ? <Legend content={<ChartLegend onToggle={onToggleSeries} hidden={hidden} />} /> : null}
          {visible.map((item) => (
            <Bar key={item.key} dataKey={item.key} name={item.label} stackId={stacked ? "stack" : undefined} maxBarSize={24}
              fill={item.color || CATEGORICAL[0]} radius={radius(item)} isAnimationActive={!reduced}
              stroke={stacked ? CHART_SURFACE : undefined} strokeWidth={stacked ? 2 : 0}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={(entry) => onBarClick?.(entry?.payload, item.key)}>
              {item.color ? null : data.map((row, index) => <Cell key={row[categoryKey] ?? index} fill={row.color || categoricalColor(index)} />)}
            </Bar>
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data, height = 300, onSliceClick, centerLabel, centerValue, valueFormat = formatCount, ariaLabel }) {
  const reduced = usePrefersReducedMotion();
  const total = data.reduce((sum, row) => sum + Number(row.value || 0), 0);
  return (
    <div className="chart-frame chart-frame--donut" style={{ height }} aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} />
          <Legend content={<ChartLegend />} />
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke={CHART_SURFACE} strokeWidth={2} isAnimationActive={!reduced} cursor={onSliceClick ? "pointer" : undefined} onClick={(entry) => onSliceClick?.(entry?.payload?.payload || entry?.payload)}>
            {data.map((row, index) => <Cell key={row.key ?? row.label ?? index} fill={row.color || categoricalColor(index)} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="chart-donut-center" aria-hidden="true"><span>{centerLabel || "Total"}</span><strong className="tabular">{centerValue ?? valueFormat(total)}</strong></div>
    </div>
  );
}

// Hand-built rather than Recharts' Funnel so each step can carry its own
// conversion and drop-off labels and be an individual drill-down target.
export function FunnelChart({ steps, onStepClick, ariaLabel }) {
  const top = steps[0]?.count || 0;
  return (
    <ol className="chart-funnel" aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const width = top > 0 ? Math.max(6, (step.count / top) * 100) : 6;
        const Tag = onStepClick ? "button" : "div";
        return (
          <li key={step.stage}>
            <Tag type={onStepClick ? "button" : undefined} className="chart-funnel__step" onClick={onStepClick ? () => onStepClick(step) : undefined} aria-label={`${stageLabel(step.stage)}: ${formatCount(step.count)} candidates, ${step.conversionFromTop}% of the top of the funnel`}>
              <span className="chart-funnel__label">{stageLabel(step.stage)}</span>
              <span className="chart-funnel__track"><i style={{ width: `${width}%`, background: stageColor(step.stage) }} /></span>
              <b className="tabular">{formatCount(step.count)}</b>
              <em className="tabular">{step.conversionFromTop}%</em>
            </Tag>
            {index < steps.length - 1 ? (
              <p className="chart-funnel__gap tabular">
                <span>{steps[index + 1].conversionFromPrev}% continue</span>
                {steps[index + 1].dropOff > 0 ? <span className="chart-funnel__drop">−{formatCount(steps[index + 1].dropOff)} dropped</span> : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function Sparkline({ data, dataKey = "value", color = "#126a58", height = 30 }) {
  const id = useId();
  if (!data?.length) return <div className="chart-sparkline" style={{ height }} />;
  return (
    <div className="chart-sparkline" style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs><linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.26} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} strokeLinecap="round" fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
