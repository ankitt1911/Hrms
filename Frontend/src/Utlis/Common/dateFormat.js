const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isDateOnly = (value) => typeof value === "string" && DATE_ONLY_PATTERN.test(value);

export const formatDate = (value, { locale = "en-IN", timeZone, ...options } = {}) => {
  if (!value) return "—";
  const date = isDateOnly(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone, ...options }).format(date);
  } catch {
    return "—";
  }
};

export const formatDateTime = (value, { locale = "en-IN", timeZone, ...options } = {}) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone, ...options }).format(date);
  } catch {
    return "—";
  }
};

export const toDateInputValue = (value) => {
  if (!value) return "";
  if (isDateOnly(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

export const formatDuration = (totalSeconds = 0) => {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
};
