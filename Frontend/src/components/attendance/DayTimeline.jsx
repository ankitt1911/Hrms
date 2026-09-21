import { motion } from "framer-motion";
import { formatDuration } from "../../Utlis/Common/attendanceTime";

const clockText = (value, timeZone) => new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));

/*
 * The day drawn to scale rather than as a list of dots. Each block's width is its
 * real duration and its position is its real clock time, so a long break or a
 * fragmented afternoon is visible as a shape before any number is read.
 *
 * The span runs from the first clock-in to now (or to the last event once the day
 * is closed), which keeps the bar full-width instead of squeezing a short shift
 * into a corner of a 24-hour axis.
 */
export default function DayTimeline({ segments, estimatedNow, timeZone, sessions, reduced }) {
  if (!segments?.length) return null;

  const starts = segments.map((segment) => new Date(segment.startedAt).getTime());
  const ends = segments.map((segment) => (segment.endedAt ? new Date(segment.endedAt).getTime() : estimatedNow));
  const from = Math.min(...starts);
  const to = Math.max(...ends, from + 60000);
  const span = to - from;

  const blocks = segments.map((segment, index) => {
    const startedAt = new Date(segment.startedAt).getTime();
    const endedAt = segment.endedAt ? new Date(segment.endedAt).getTime() : estimatedNow;
    const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
    return {
      key: `${segment.startedAt}-${index}`,
      type: String(segment.type).toLowerCase(),
      open: !segment.endedAt,
      left: ((startedAt - from) / span) * 100,
      width: Math.max(0.8, ((endedAt - startedAt) / span) * 100),
      label: `${String(segment.type).toLowerCase()} · ${clockText(segment.startedAt, timeZone)}–${segment.endedAt ? clockText(segment.endedAt, timeZone) : "now"} · ${formatDuration(seconds)}`,
    };
  });

  return (
    <div className="day-timeline">
      <div className="day-timeline__head">
        <span>Today, to scale{sessions ? <em>{sessions} {sessions === 1 ? "session" : "sessions"}</em> : null}</span>
        <span className="tabular">{clockText(from, timeZone)} – {clockText(to, timeZone)}</span>
      </div>
      <div className="day-timeline__track" role="list" aria-label="Today's work and break segments, drawn to scale">
        {blocks.map((block, index) => (
          <motion.span
            role="listitem"
            key={block.key}
            className={`day-timeline__block is-${block.type} ${block.open ? "is-open" : ""}`}
            style={{ left: `${block.left}%`, width: `${block.width}%` }}
            title={block.label}
            aria-label={block.label}
            initial={{ scaleX: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : index * 0.06, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
      </div>
      <div className="day-timeline__legend">
        <span><i className="is-work" />Work</span>
        <span><i className="is-break" />Break</span>
      </div>
    </div>
  );
}
