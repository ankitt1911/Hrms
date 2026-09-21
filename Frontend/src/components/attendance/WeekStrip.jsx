import { motion } from "framer-motion";

const DAY_LABEL = (value) => new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(new Date(value));
const DATE_LABEL = (value) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(value));
const hoursText = (minutes) => `${(Math.max(0, Number(minutes) || 0) / 60).toFixed(1)}h`;

/*
 * A column per day, stacked work over break, scaled against the shift target
 * rather than against the tallest bar — so a light week reads as light instead of
 * being silently normalised back to full height. The dashed target line is what
 * makes the columns comparable rather than decorative.
 */
export default function WeekStrip({ history, targetMinutes, todayKey, reduced }) {
  const days = [...(history || [])].sort((a, b) => new Date(a.workDate) - new Date(b.workDate)).slice(-14);
  if (!days.length) return null;

  const ceiling = Math.max(targetMinutes * 1.15, ...days.map((day) => (day.workedMinutes || 0) + (day.breakMinutes || 0)));
  const best = Math.max(...days.map((day) => day.workedMinutes || 0));
  const pct = (minutes) => `${Math.min(100, (Math.max(0, minutes) / ceiling) * 100)}%`;

  return (
    <div className="week-strip">
      <div className="week-strip__chart" role="list" aria-label="Hours worked per day over the last two weeks">
        <span className="week-strip__target" style={{ bottom: pct(targetMinutes) }} aria-hidden="true">
          <b className="tabular">{hoursText(targetMinutes)}</b>
        </span>
        {days.map((day, index) => {
          const worked = Math.max(0, day.workedMinutes || 0);
          const rest = Math.max(0, day.breakMinutes || 0);
          const met = worked >= targetMinutes;
          const isToday = todayKey && String(day.workDate).slice(0, 10) === todayKey;
          return (
            <div className={`week-strip__day ${isToday ? "is-today" : ""}`} key={String(day.workDate)} role="listitem"
              style={{ "--bar": pct(Math.max(worked, rest)) }}
              title={`${DATE_LABEL(day.workDate)} · ${hoursText(worked)} worked · ${hoursText(rest)} break`}>
              <span className="week-strip__column">
                <span className="week-strip__value tabular">{worked ? hoursText(worked) : "—"}</span>
                <motion.i
                  className="week-strip__bar is-break"
                  initial={{ height: reduced ? pct(rest) : 0 }} animate={{ height: pct(rest) }}
                  transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.18 + index * 0.03, ease: [0.16, 1, 0.3, 1] }}
                />
                <motion.i
                  className={`week-strip__bar is-work ${met ? "is-met" : ""} ${worked === best && worked > 0 ? "is-best" : ""}`}
                  initial={{ height: reduced ? pct(worked) : 0 }} animate={{ height: pct(worked) }}
                  transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : index * 0.03, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
              <span className="week-strip__label">{isToday ? "Today" : DAY_LABEL(day.workDate)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
