import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline } from "./charts";
import { formatCount, formatMoney, formatPercent } from "../../constants/chart.constants";
import { listItem } from "../../motion/variants";

const FORMATTERS = { currency: formatMoney, percent: formatPercent, days: (value) => `${Number(value || 0).toFixed(1)} d`, hours: (value) => `${Number(value || 0).toFixed(1)} h` };
const formatValue = (metric) => (FORMATTERS[metric?.unit] || formatCount)(metric?.value ?? 0);

/*
 * `positive` says which direction is good: rejections rising is not an
 * improvement, so the tone follows the meaning of the metric, not the sign.
 * The arrow and the "vs previous" wording carry the direction too, so the
 * red/green tone is never the only signal.
 */
export default function KpiTile({ label, metric, tone = 1, icon: Icon, spark, sparkColor, positive = true, comparisonLabel, onClick, reduced }) {
  const delta = Number(metric?.deltaPct ?? 0);
  const flat = !Number.isFinite(delta) || Math.abs(delta) < 0.05 || metric?.previous == null;
  const good = delta > 0 ? positive : !positive;
  const DeltaIcon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const Tag = onClick ? motion.button : motion.article;

  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`crm-kpi-tile crm-kpi-tile--${tone} ${onClick ? "is-clickable" : ""}`}
      variants={listItem(reduced)}
      onClick={onClick}
      aria-label={onClick ? `${label}: ${formatValue(metric)}. Show the records behind this figure.` : undefined}
    >
      <span className="crm-kpi-tile__head">{Icon ? <Icon size={17} /> : null}<span>{label}</span>{onClick ? <ArrowRight className="crm-kpi-tile__go" size={15} /> : null}</span>
      <strong className="tabular">{formatValue(metric)}</strong>
      <Sparkline data={spark} color={sparkColor} height={28} />
      <span className={`crm-kpi-delta ${flat ? "is-flat" : good ? "is-good" : "is-bad"}`}>
        <DeltaIcon size={13} aria-hidden="true" />
        <b className="tabular">{flat ? "No change" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}</b>
        <small>{comparisonLabel || "vs previous period"}</small>
      </span>
    </Tag>
  );
}
