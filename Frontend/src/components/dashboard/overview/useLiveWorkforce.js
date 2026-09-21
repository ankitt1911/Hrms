import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as reports from "../../../Services/apiCalling/reportApis";
import usePolling from "../../../hooks/usePolling";
import { calculateSegmentSeconds, dateKeyInTimeZone, estimateServerTimestamp } from "../../../Utlis/Common/attendanceTime";

const POLL_MS = 20000;   // matches the notification poll in AppLayout
const LIVE_STATUSES = ["WORKING", "ON_BREAK"];

/*
 * Owns the whole live panel's clock so the board stays cheap: ONE poll, ONE 1Hz
 * ticker and ONE visibility listener for every row, rather than a per-row hook.
 *
 * Three things the naive version gets wrong and this does not:
 *  - The browser clock may be skewed, so durations are measured from the server's
 *    `serverNow` plus locally elapsed time, never from `Date.now()` directly.
 *  - `usePolling` skips its work while the tab is hidden but does not refetch on
 *    return, so without the visibility listener the board can be a full interval
 *    stale the moment someone looks at it.
 *  - At midnight the business date rolls over and today's records become
 *    yesterday's, so a date change forces a refetch.
 */
export default function useLiveWorkforce() {
  const [data, setData] = useState();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [localNow, setLocalNow] = useState(() => Date.now());
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      const next = await reports.handleGetAdminDashboardLive();
      if (requestId !== requestRef.current) return;
      setData(next); setReceivedAt(Date.now()); setLocalNow(Date.now()); setError("");
    } catch (requestError) {
      if (requestId === requestRef.current) setError(requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  usePolling(load, { intervalMs: POLL_MS });

  useEffect(() => {
    const resync = () => { if (document.visibilityState !== "hidden") { setLocalNow(Date.now()); load(); } };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => { window.removeEventListener("focus", resync); document.removeEventListener("visibilitychange", resync); };
  }, [load]);

  // The ticker runs only while somebody is actually on the clock; an all-idle
  // board is static and costs nothing.
  const hasRunningRow = Boolean(data?.employees?.some((row) => LIVE_STATUSES.includes(row.status)));
  useEffect(() => {
    if (!hasRunningRow) return undefined;
    const timer = window.setInterval(() => setLocalNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningRow]);

  const estimatedNow = estimateServerTimestamp({ serverNow: data?.serverNow, receivedAt, localNow });

  const businessDate = data?.businessDate;
  const timeZone = data?.timeZone;
  useEffect(() => {
    if (!businessDate || !timeZone) return;
    if (dateKeyInTimeZone(estimatedNow, timeZone) !== businessDate) load();
  }, [businessDate, timeZone, estimatedNow, load]);

  const rows = useMemo(() => (data?.employees || []).map((row) => {
    const live = LIVE_STATUSES.includes(row.status);
    return {
      ...row,
      live,
      workedSeconds: calculateSegmentSeconds(row, estimatedNow, "WORK"),
      breakSeconds: calculateSegmentSeconds(row, estimatedNow, "BREAK"),
      currentSeconds: row.currentSince ? Math.max(0, Math.floor((estimatedNow - new Date(row.currentSince).getTime()) / 1000)) : null,
    };
  }), [data?.employees, estimatedNow]);

  return {
    data, rows, error, loading, refresh: load, estimatedNow,
    counters: data?.counters,
    timeZone: timeZone || "UTC",
    secondsSinceUpdate: Math.max(0, Math.floor((localNow - receivedAt) / 1000)),
  };
}
