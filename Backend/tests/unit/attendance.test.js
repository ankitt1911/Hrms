const { totals } = require('../../src/modules/attendance/attendance.service');
const { dateKeyInTimeZone, canonicalDateInTimeZone, startInstantOfDateInTimeZone } = require('../../src/common/utils/dates');
const { hasUnsafeKey } = require('../../src/common/middleware/mongoSanitize.middleware');
const { dashboardReportRange, attendanceSummary } = require('../../src/modules/business/operations.service');

describe('attendance calculations', () => {
  it('counts only closed server segments and floors partial minutes', () => {
    expect(totals([
      { type: 'WORK', startedAt: '2026-09-01T09:00:00Z', endedAt: '2026-09-01T10:30:59Z' },
      { type: 'BREAK', startedAt: '2026-09-01T10:31:00Z', endedAt: '2026-09-01T10:46:00Z' },
      { type: 'WORK', startedAt: '2026-09-01T10:46:00Z', endedAt: null },
    ])).toEqual({ workedMinutes: 90, breakMinutes: 15 });
  });

  it('rolls the attendance day over at company-local midnight', () => {
    const afterMidnightInIndia = new Date('2026-09-13T20:28:00.000Z');
    expect(dateKeyInTimeZone(afterMidnightInIndia, 'Asia/Kolkata')).toBe('2026-09-14');
    expect(canonicalDateInTimeZone(afterMidnightInIndia, 'Asia/Kolkata').toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(startInstantOfDateInTimeZone('2026-09-14', 'Asia/Kolkata').toISOString()).toBe('2026-09-13T18:30:00.000Z');
  });

  it('builds company-local dashboard presets with Monday week starts', () => {
    const now = new Date('2026-09-16T02:00:00.000Z');
    const today = dashboardReportRange({ preset: 'today' }, 'Asia/Kolkata', now);
    const week = dashboardReportRange({ preset: 'week' }, 'Asia/Kolkata', now);
    const month = dashboardReportRange({ preset: 'month' }, 'Asia/Kolkata', now);
    expect([today.startDate, today.endDate]).toEqual(['2026-09-16', '2026-09-16']);
    expect([week.startDate, week.endDate]).toEqual(['2026-09-14', '2026-09-16']);
    expect([month.startDate, month.endDate]).toEqual(['2026-09-01', '2026-09-16']);
    expect(week.startInstant.toISOString()).toBe('2026-09-13T18:30:00.000Z');
    expect(week.endExclusive.toISOString()).toBe('2026-09-16T18:30:00.000Z');
  });

  it('validates custom ranges and calculates live attendance totals', () => {
    expect(() => dashboardReportRange({ preset: 'custom', startDate: '2026-09-20', endDate: '2026-09-10' }, 'UTC')).toThrow();
    const summary = attendanceSummary({ _id: 'record', employeeId: { _id: 'employee', firstName: 'Ada', lastName: 'Lovelace' }, workDate: new Date('2026-09-14'), status: 'ON_BREAK', segments: [
      { type: 'WORK', startedAt: new Date('2026-09-14T09:00:00Z'), endedAt: new Date('2026-09-14T10:30:00Z') },
      { type: 'BREAK', startedAt: new Date('2026-09-14T10:30:00Z'), endedAt: null },
    ] }, new Date('2026-09-14T10:45:00Z'));
    expect(summary).toMatchObject({ employeeName: 'Ada Lovelace', status: 'ON_BREAK', workedMinutes: 90, breakMinutes: 15, logoutAt: null });
  });
});

describe('NoSQL injection protection', () => {
  it('finds operator and dotted keys recursively', () => {
    expect(hasUnsafeKey({ email: { $ne: null } })).toBe(true);
    expect(hasUnsafeKey({ 'profile.role': 'admin' })).toBe(true);
    expect(hasUnsafeKey({ safe: [{ nested: 'value' }] })).toBe(false);
  });
});
