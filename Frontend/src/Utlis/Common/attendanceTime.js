export const asTimestamp = (value) => {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const estimateServerTimestamp = ({ serverNow, receivedAt, localNow }) =>
  (asTimestamp(serverNow) ?? receivedAt) + Math.max(0, localNow - receivedAt);

/*
 * Seconds recorded against one segment type, counting an open segment up to
 * `serverTimestamp`. With no segments at all it falls back to the server's own
 * minute totals, so a row is still right before the first tick.
 */
export const calculateSegmentSeconds = (record, serverTimestamp, type = "WORK") => {
  const segments = Array.isArray(record?.segments) ? record.segments : [];
  if (!segments.length) {
    const minutes = type === "BREAK" ? record?.breakMinutes : record?.workedMinutes;
    return Math.max(0, Math.floor(Number(minutes) || 0) * 60);
  }

  return segments
    .filter((segment) => segment?.type === type)
    .reduce((total, segment) => {
      const startedAt = asTimestamp(segment.startedAt);
      const endedAt = asTimestamp(segment.endedAt) ?? serverTimestamp;
      if (startedAt === null || !Number.isFinite(endedAt) || endedAt <= startedAt) return total;
      return total + Math.floor((endedAt - startedAt) / 1000);
    }, 0);
};

export const calculateWorkedSeconds = (record, serverTimestamp) => calculateSegmentSeconds(record, serverTimestamp, "WORK");

export const formatDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
};

export const dateKeyInTimeZone = (value, timeZone = "UTC") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch { return null; }
};
