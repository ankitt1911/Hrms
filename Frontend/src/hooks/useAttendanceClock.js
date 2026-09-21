import { useEffect, useMemo, useRef, useState } from "react";
import { handleGetAttendanceState } from "../Services/apiCalling/attendanceApis";
import { asTimestamp, calculateSegmentSeconds, estimateServerTimestamp, formatDuration } from "../Utlis/Common/attendanceTime";

export default function useAttendanceClock(record, { onResync } = {}) {
  const [focusedSnapshot, setFocusedSnapshot] = useState(null);
  const resyncPromise = useRef(null);
  const effectiveRecord = focusedSnapshot || record;
  const serverSnapshot = useMemo(() => {
    const receivedAt = Date.now();
    return {
      receivedAt,
      serverNow: asTimestamp(effectiveRecord?.serverNow) ?? receivedAt,
    };
  }, [effectiveRecord]);
  const [localNow, setLocalNow] = useState(() => Date.now());

  useEffect(() => setFocusedSnapshot(null), [record]);
  useEffect(() => {
    setLocalNow(Date.now());
    if (!effectiveRecord || !["WORKING", "ON_BREAK"].includes(effectiveRecord.status)) return undefined;

    const tick = () => setLocalNow(Date.now());
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      tick();
      if (!resyncPromise.current) {
        resyncPromise.current = Promise.resolve(onResync ? onResync() : handleGetAttendanceState())
          .then((freshRecord) => { if (freshRecord) setFocusedSnapshot(freshRecord); })
          .catch(() => undefined)
          .finally(() => { resyncPromise.current = null; });
      }
      await resyncPromise.current;
    };
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [effectiveRecord, onResync]);

  const estimatedServerNow = estimateServerTimestamp({ ...serverSnapshot, localNow });
  const workedSeconds = calculateSegmentSeconds(effectiveRecord, estimatedServerNow, "WORK");
  const breakSeconds = calculateSegmentSeconds(effectiveRecord, estimatedServerNow, "BREAK");
  return {
    elapsed: formatDuration(workedSeconds),
    breakElapsed: formatDuration(breakSeconds),
    workedSeconds,
    breakSeconds,
    estimatedNow: estimatedServerNow,
    record: effectiveRecord,
  };
}
