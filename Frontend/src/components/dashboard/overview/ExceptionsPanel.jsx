import { AlarmClock, CalendarX2, CheckCircle2, Coffee, FileWarning, Hourglass, LogOut, MinusCircle, PlayCircle, TimerOff } from "lucide-react";
import { formatCount } from "../../../constants/chart.constants";

/*
 * Counters, each a drill-down target. A zero stays on screen rather than being
 * hidden, because "no missing clock-outs" is itself the answer an owner is looking
 * for — and every card carries an icon and a label, so the alert tone is never the
 * only signal. `null` means the figure is not measurable (punctuality without a
 * configured shift start) and is dropped instead of shown as zero.
 */
const CARDS = [
  { key: "missingLogout", label: "Never clocked out", icon: LogOut, dimension: "MISSING_LOGOUT", alert: true, hint: "Days left open in the past" },
  { key: "currentlyWorking", label: "On the clock now", icon: PlayCircle, dimension: "CURRENTLY_WORKING", hint: "Working right now" },
  { key: "onBreakNow", label: "On break now", icon: Coffee, dimension: "ON_BREAK_NOW", hint: "Currently on a break" },
  { key: "lateDays", label: "Late arrivals", icon: AlarmClock, dimension: "LATE", alert: true, hint: "Clocked in after the shift start" },
  { key: "longBreak", label: "Long breaks", icon: Hourglass, dimension: "LONG_BREAK", alert: true, hint: "Over 90 minutes of break" },
  { key: "shortDays", label: "Short days", icon: MinusCircle, dimension: "SHORT_DAY", alert: true, hint: "Finished under a full day" },
  { key: "zeroHourDays", label: "Zero-hour days", icon: TimerOff, dimension: "ZERO_HOUR", alert: true, hint: "Clocked in and out with no time" },
  { key: "overtimeDays", label: "Overtime days", icon: Hourglass, dimension: "OVERTIME", hint: "Worked beyond a full day" },
  { key: "neverClockedIn", label: "No attendance", icon: CalendarX2, dimension: "NEVER_CLOCKED_IN", alert: true, hint: "Active but absent all period" },
  { key: "stalePendingLeave", label: "Stale approvals", icon: Hourglass, dimension: "LEAVE_PENDING_AGE", value: "D5_10", alert: true, hint: "Waiting over 5 days" },
  { key: "correctedRecords", label: "Corrected records", icon: FileWarning, dimension: "CORRECTED", hint: "Edited by an administrator" },
];

export default function ExceptionsPanel({ counts, onDrill }) {
  const cards = CARDS.filter((card) => counts?.[card.key] != null);
  const flagged = cards.filter((card) => card.alert && counts[card.key] > 0).length;

  return (
    <section className="surface dashboard-section chart-card overview-exceptions">
      <header>
        <div>
          <h2>Needs attention</h2>
          <p>{flagged ? `${flagged} thing${flagged === 1 ? "" : "s"} to look at in this period. Select a counter to see the records.` : "Nothing is flagged in this period."}</p>
        </div>
        {flagged === 0 ? <span className="overview-exceptions__clear"><CheckCircle2 size={16} aria-hidden="true" />All clear</span> : null}
      </header>
      <div className="chart-card__body">
        <div className="overview-exception-grid">
          {cards.map((card) => {
            const count = counts[card.key];
            const state = count === 0 ? "is-clear" : card.alert ? "is-alert" : "is-info";
            return (
              <button
                type="button"
                key={card.key}
                className={`overview-exception-card ${state}`}
                onClick={() => onDrill(card.dimension, card.value || "", card.label)}
                aria-label={`${card.label}: ${formatCount(count)}. ${card.hint}. Show the records.`}
              >
                <span className="overview-exception-card__head"><card.icon size={16} aria-hidden="true" />{card.label}</span>
                <strong className="tabular">{formatCount(count)}</strong>
                <small>{card.hint}</small>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
