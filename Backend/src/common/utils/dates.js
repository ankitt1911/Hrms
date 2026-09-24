function startOfUtcDay(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(value = new Date()) {
  const start = startOfUtcDay(value);
  return new Date(start.getTime() + 86400000 - 1);
}

function isValidTimeZone(timeZone) {
  // Intl treats undefined as "system default", so it must be rejected explicitly
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); return true; }
  catch { return false; }
}

function zonedParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, Number(part)]));
}

function dateKeyInTimeZone(value = new Date(), timeZone = 'UTC') {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const { year, month, day } = zonedParts(value, zone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Attendance stores a local calendar date as UTC midnight so indexes and date filters stay stable.
function canonicalDateInTimeZone(value = new Date(), timeZone = 'UTC') {
  return new Date(`${dateKeyInTimeZone(value, timeZone)}T00:00:00.000Z`);
}

function startInstantOfDateInTimeZone(dateKey, timeZone = 'UTC') {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const [year, month, day] = dateKey.split('-').map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day);
  let instant = wallClockUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(instant), zone);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    instant = wallClockUtc - (representedAsUtc - instant);
  }
  return new Date(instant);
}

function addSeconds(date, seconds) { return new Date(date.getTime() + seconds * 1000); }
module.exports = { startOfUtcDay, endOfUtcDay, isValidTimeZone, dateKeyInTimeZone, canonicalDateInTimeZone, startInstantOfDateInTimeZone, addSeconds };
