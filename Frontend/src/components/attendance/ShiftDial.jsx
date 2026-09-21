import { motion } from "framer-motion";
import { formatDuration } from "../../Utlis/Common/attendanceTime";

const SIZE = 268;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2 - 6;
const CENTRE = SIZE / 2;

const EASE = [0.16, 1, 0.3, 1];
const EPSILON = 0.004;   // below this an arc is shorter than its own round cap

/*
 * The workday as one dial. Two arcs share the ring — worked time in brand green
 * and break time in amber — so a glance answers both "how far through the day am
 * I" and "how much of it was break", which two separate numbers never do as well.
 *
 * Arc geometry uses framer-motion's `pathLength`/`pathOffset`, which express the
 * dash in 0..1 fractions of the circle and animate smoothly; hand-computing
 * strokeDasharray would animate in jumps.
 */
export default function ShiftDial({ workedSeconds, breakSeconds, targetSeconds, status, elapsed, reduced }) {
  const target = Math.max(1, targetSeconds);
  const workedFraction = Math.min(1, workedSeconds / target);
  // The break arc takes whatever ring is left, so the two can never overlap.
  const breakFraction = Math.min(Math.max(0, 1 - workedFraction), breakSeconds / target);
  const complete = workedSeconds >= target;
  const live = status === "WORKING" || status === "ON_BREAK";
  const remaining = Math.max(0, target - workedSeconds);
  const percent = Math.round((workedSeconds / target) * 100);
  const spin = { duration: reduced ? 0 : 1.1, ease: EASE };

  return (
    <div className={`shift-dial ${live ? "is-live" : ""} ${complete ? "is-complete" : ""}`}>
      {/* A breathing halo, only while the clock is actually running. */}
      {live && !reduced ? (
        <motion.span
          className={`shift-dial__halo ${status === "ON_BREAK" ? "is-break" : ""}`}
          aria-hidden="true"
          animate={{ opacity: [0.35, 0.7, 0.35], scale: [0.97, 1.03, 0.97] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
        aria-label={`${formatDuration(workedSeconds)} worked of a ${Math.round(target / 3600)} hour day, ${percent}% complete. ${formatDuration(breakSeconds)} on break.`}>
        <defs>
          <linearGradient id="shift-dial-work" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2d9079" /><stop offset="100%" stopColor="#0d4a3f" />
          </linearGradient>
        </defs>

        <circle cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" stroke="#ecedea" strokeWidth={STROKE} />

        {workedFraction > EPSILON ? (
          <motion.circle
            cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" stroke="url(#shift-dial-work)"
            strokeWidth={STROKE} strokeLinecap="round" transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
            initial={{ pathLength: 0 }} animate={{ pathLength: workedFraction }} transition={spin}
          />
        ) : null}
        {breakFraction > EPSILON ? (
          <motion.circle
            cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" stroke="var(--warning)"
            strokeWidth={STROKE} strokeLinecap="round" transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
            initial={{ pathLength: 0, pathOffset: 0 }}
            animate={{ pathLength: breakFraction, pathOffset: workedFraction }}
            transition={spin}
          />
        ) : null}
      </svg>

      <div className="shift-dial__centre">
        <span className="shift-dial__caption">{status === "ON_BREAK" ? "On break" : status === "COMPLETED" ? "Day complete" : status === "WORKING" ? "Working" : "Not started"}</span>
        <strong className="shift-dial__time tabular" aria-live="off">{elapsed}</strong>
        <span className="shift-dial__meta tabular">
          {complete ? `Target met · +${formatDuration(workedSeconds - target).slice(0, 5)}` : `${formatDuration(remaining).slice(0, 5)} to go`}
        </span>
      </div>
    </div>
  );
}
