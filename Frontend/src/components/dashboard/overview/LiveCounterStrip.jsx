import { CalendarCheck2, CalendarClock, CalendarX2, CheckCircle2, Coffee, LogIn, PlayCircle, UsersRound } from "lucide-react";
import { formatCount } from "../../../constants/chart.constants";

/*
 * Eight flat counters, not eight cards. This strip is the second level of the
 * page's hierarchy: the live board above it carries the weight, so these stay
 * quiet — one line of label, one figure, no sparkline, no delta.
 *
 * `drill` is omitted where the figure has no meaningful record list behind it
 * (total headcount), and those cells simply do not become buttons.
 */
const COUNTERS = [
  { key: "working", label: "Working now", icon: PlayCircle, tone: "good", live: true, drill: ["CURRENTLY_WORKING", "", "Working right now"] },
  { key: "onBreak", label: "On break", icon: Coffee, tone: "warn", live: true, drill: ["ON_BREAK_NOW", "", "On break right now"] },
  { key: "yetToClockIn", label: "Yet to clock in", icon: LogIn, drill: ["NEVER_CLOCKED_IN", "", "No attendance today"] },
  { key: "finished", label: "Finished today", icon: CheckCircle2, drill: ["ATTENDANCE_STATUS", "COMPLETED", "Finished today"] },
  { key: "onLeaveToday", label: "On leave today", icon: CalendarClock, drill: ["ON_LEAVE", "", "On approved leave"] },
  { key: "upcomingLeave", label: "Leave coming up", icon: CalendarCheck2, drill: ["LEAVE_UPCOMING", "", "Upcoming approved leave"] },
  { key: "pendingApprovals", label: "Awaiting approval", icon: CalendarX2, tone: "alert", drill: ["LEAVE_STATUS", "PENDING", "Leave awaiting decision"] },
  { key: "totalEmployees", label: "Employees", icon: UsersRound },
];

export default function LiveCounterStrip({ counters, onDrill }) {
  return (
    <div className="live-counter-strip">
      {COUNTERS.map((counter) => {
        const value = counters?.[counter.key] ?? 0;
        // An alert tone only earns itself when there is something to act on.
        const tone = counter.tone === "alert" && value === 0 ? undefined : counter.tone;
        const Tag = counter.drill ? "button" : "div";
        return (
          <Tag
            type={counter.drill ? "button" : undefined}
            key={counter.key}
            className={`live-counter ${tone ? `live-counter--${tone}` : ""} ${counter.drill ? "is-clickable" : ""}`}
            onClick={counter.drill ? () => onDrill(...counter.drill) : undefined}
            aria-label={counter.drill ? `${counter.label}: ${formatCount(value)}. Show the records.` : undefined}
          >
            <span className="live-counter__label">
              <counter.icon size={15} aria-hidden="true" />
              {counter.label}
              {counter.live && value > 0 ? <i className="live-dot" aria-hidden="true" /> : null}
            </span>
            <strong className="tabular">{formatCount(value)}</strong>
          </Tag>
        );
      })}
    </div>
  );
}
