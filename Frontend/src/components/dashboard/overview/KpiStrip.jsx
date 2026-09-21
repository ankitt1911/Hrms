import { motion } from "framer-motion";
import { AlarmClock, CalendarClock, CalendarX2, CheckCircle2, Clock3, Coffee, Hourglass, Percent, TrendingDown, UserMinus, UserPlus, UsersRound } from "lucide-react";
import KpiTile from "../../custom/KpiTile";
import { listReveal } from "../../../motion/variants";
import { KPI_DEFINITIONS } from "./constants";

const ICONS = { AlarmClock, CalendarClock, CalendarX2, CheckCircle2, Clock3, Coffee, Hourglass, Percent, TrendingDown, UserMinus, UserPlus, UsersRound };

/*
 * Renders only the metrics a tab asks for. A metric the server returned as null
 * is dropped rather than shown as zero — punctuality without a configured shift
 * start is "not measured", which is not the same as "nobody was on time".
 */
export default function KpiStrip({ keys, kpis, timeseries, comparisonLabel, reduced, onDrill }) {
  const tiles = keys
    .map((key) => ({ key, metric: kpis?.[key], ...KPI_DEFINITIONS[key] }))
    .filter((tile) => tile.metric);
  if (!tiles.length) return null;

  const spark = (key) => (timeseries || []).map((bucket) => ({ value: bucket[key] || 0 }));
  return (
    <motion.div className="overview-kpi-grid" variants={listReveal(reduced)} initial="hidden" animate="show">
      {tiles.map((tile, index) => (
        <KpiTile
          key={tile.key}
          label={tile.label}
          metric={tile.metric}
          tone={(index % 6) + 1}
          icon={ICONS[tile.icon]}
          spark={spark(tile.spark)}
          sparkColor={tile.color}
          positive={tile.positive !== false}
          comparisonLabel={comparisonLabel}
          reduced={reduced}
          onClick={tile.drill ? () => onDrill(...tile.drill) : undefined}
        />
      ))}
    </motion.div>
  );
}
