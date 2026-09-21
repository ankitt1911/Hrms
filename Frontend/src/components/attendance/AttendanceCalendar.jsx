import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, ChevronLeft, ChevronRight, Coffee, Clock3 } from "lucide-react";
import * as api from "../../Services/apiCalling/attendanceApis";
import * as leaveApi from "../../Services/apiCalling/leaveApis";
import * as employeeApi from "../../Services/apiCalling/employeeApis";
import { unwrapCollection } from "../custom/apiBridge";
import { Button, DataTable, EmptyState, ErrorState, Modal, Skeleton, StatusBadge } from "../custom/ui";
import { calculateSegmentSeconds } from "../../Utlis/Common/attendanceTime";

const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-IN", { month: "long" }).format(new Date(2024, month, 1)));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const dateKey = (year, month, day) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const keyOf = (value) => String(value || "").slice(0, 10);
const hoursText = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60); const rest = total % 60;
  return [hours ? `${hours}h` : "", rest || !hours ? `${rest}m` : ""].filter(Boolean).join(" ");
};
const nameOf = (record) => {
  const employee = record?.employeeId || record?.employee;
  return employee && typeof employee === "object"
    ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.employeeCode || "Employee"
    : record?.employeeName || "Employee";
};
const timeText = (value) => (value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) : "—");

// Minutes derived from the segments rather than the stored totals, so a day still
// in progress counts the stretch currently running instead of dropping it.
const minutesOf = (record, type) => Math.round(calculateSegmentSeconds(record, Date.now(), type) / 60);

// The month can hold more rows than one page, so every page is pulled before the
// grid is built — a half-loaded calendar silently under-reports a month.
async function loadAll(read, query) {
  const first = unwrapCollection(await read({ ...query, page: 1, limit: 100 }));
  if ((first.pages || 1) <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: first.pages - 1 }, (_, index) => read({ ...query, page: index + 2, limit: 100 })));
  return [first, ...rest.map(unwrapCollection)].flatMap((page) => page.items);
}

export default function AttendanceCalendar() {
  const [today] = useState(() => new Date());
  const [visibleDate, setVisibleDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState();

  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();
  const from = dateKey(year, month, 1);
  const to = dateKey(year, month, new Date(year, month + 1, 0).getDate());

  useEffect(() => {
    let active = true;
    employeeApi.handleGetEmployees({ page: 1, limit: 100, status: "ACTIVE" })
      .then((data) => { if (active) setEmployees(unwrapCollection(data).items); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scope = employeeId ? { employeeId } : {};
      const [attendance, approved] = await Promise.all([
        loadAll(api.handleGetAttendanceRegister, { from, to, ...scope }),
        loadAll(leaveApi.handleGetLeaveQueue, { from, to, status: "APPROVED", ...scope }),
      ]);
      setRecords(attendance); setLeaves(approved); setError("");
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [employeeId, from, to]);

  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const days = new Map();
    const ensure = (key) => { if (!days.has(key)) days.set(key, { records: [], leaves: [], workedMinutes: 0, breakMinutes: 0 }); return days.get(key); };
    records.forEach((record) => {
      const cell = ensure(keyOf(record.workDate));
      cell.records.push(record);
      cell.workedMinutes += minutesOf(record, "WORK");
      cell.breakMinutes += minutesOf(record, "BREAK");
    });
    // A leave request spans a range, so it is expanded onto each day it covers.
    leaves.forEach((request) => {
      const start = keyOf(request.startDate); const end = keyOf(request.endDate);
      if (!start || !end) return;
      for (let cursor = new Date(`${start}T00:00:00Z`); keyOf(cursor.toISOString()) <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const key = cursor.toISOString().slice(0, 10);
        if (key >= from && key <= to) ensure(key).leaves.push(request);
      }
    });
    return days;
  }, [records, leaves, from, to]);

  const totals = useMemo(() => {
    const worked = records.reduce((sum, record) => sum + minutesOf(record, "WORK"), 0);
    const rest = records.reduce((sum, record) => sum + minutesOf(record, "BREAK"), 0);
    const presentDays = new Set(records.filter((record) => record.status !== "NOT_STARTED").map((record) => keyOf(record.workDate))).size;
    const leaveDays = new Set([...byDay.entries()].filter(([, cell]) => cell.leaves.length).map(([key]) => key)).size;
    return { worked, rest, presentDays, leaveDays, records: records.length };
  }, [records, byDay]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = firstWeekday + daysInMonth > 35 ? 42 : 35;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstWeekday + 1;
      return day > 0 && day <= daysInMonth ? day : null;
    });
  }, [month, year]);

  const yearOptions = useMemo(() => Array.from({ length: 11 }, (_, index) => today.getFullYear() - 8 + index), [today]);
  const moveMonth = (amount) => setVisibleDate(new Date(year, month + amount, 1));
  const selected = selectedDay ? byDay.get(selectedDay) : null;
  const scopeName = employeeId ? (employees.find((employee) => String(employee._id) === employeeId) ? nameOf({ employeeId: employees.find((employee) => String(employee._id) === employeeId) }) : "Selected employee") : "All employees";

  return <>
    <section className="surface leave-calendar attendance-calendar" aria-label={`Attendance calendar for ${MONTHS[month]} ${year}`}>
      <header className="leave-calendar__header">
        <div className="leave-calendar__title">
          <span><CalendarCheck2 size={20} /></span>
          <div><h2>{MONTHS[month]} {year}</h2><p>{employeeId ? `Hours worked and break time for ${scopeName}.` : "Select an employee to see their day-by-day hours."}</p></div>
        </div>
        <div className="leave-calendar__controls">
          <label className="attendance-calendar__filter">
            <span className="sr-only">Employee</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} aria-label="Filter by employee">
              <option value="">All employees</option>
              {employees.map((employee) => <option key={employee._id} value={String(employee._id)}>{nameOf({ employeeId: employee })}{employee.employeeCode ? ` · ${employee.employeeCode}` : ""}</option>)}
            </select>
          </label>
          <button type="button" className="icon-button calendar-nav" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19} /></button>
          <label><span className="sr-only">Month</span><select value={month} onChange={(event) => setVisibleDate(new Date(year, Number(event.target.value), 1))}>{MONTHS.map((label, index) => <option value={index} key={label}>{label}</option>)}</select></label>
          <label><span className="sr-only">Year</span><select value={year} onChange={(event) => setVisibleDate(new Date(Number(event.target.value), month, 1))}>{yearOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <button type="button" className="icon-button calendar-nav" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19} /></button>
          <Button variant="quiet" onClick={() => setVisibleDate(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
        </div>
      </header>

      <div className="leave-calendar__legend" aria-label="Attendance legend">
        <span><i className="leave-dot leave-dot--approved" />Worked</span>
        <span><i className="leave-dot att-dot--leave" />On leave</span>
        <span><i className="leave-dot att-dot--open" />Still clocked in</span>
      </div>

      {loading ? <div className="leave-calendar__loading"><Skeleton rows={6} /></div>
        : error ? <ErrorState message={error} onRetry={load} />
          : <div className="leave-calendar__viewport">
            <div className="leave-calendar__weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}><b>{day.slice(0, 3)}</b><i>{day.slice(0, 1)}</i></span>)}</div>
            <div className="leave-calendar__grid">
              {cells.map((day, index) => {
                if (!day) return <div className="leave-calendar__day leave-calendar__day--empty" aria-hidden="true" key={`empty-${index}`} />;
                const key = dateKey(year, month, day);
                const cell = byDay.get(key);
                const worked = cell?.workedMinutes || 0;
                const onLeave = Boolean(cell?.leaves?.length);
                const open = cell?.records?.some((record) => ["WORKING", "ON_BREAK"].includes(record.status));
                const active = Boolean(cell?.records?.length || onLeave);
                const isToday = key === dateKey(today.getFullYear(), today.getMonth(), today.getDate());
                const label = employeeId
                  ? `${day} ${MONTHS[month]}${worked ? `, worked ${hoursText(worked)}, break ${hoursText(cell.breakMinutes)}` : onLeave ? ", on leave" : ", no attendance"}`
                  : `${day} ${MONTHS[month]}, ${cell?.records?.length || 0} present, ${cell?.leaves?.length || 0} on leave`;
                return (
                  <button type="button" key={key} disabled={!active} onClick={() => setSelectedDay(key)} aria-label={label}
                    className={`leave-calendar__day${isToday ? " leave-calendar__day--today" : ""}${active ? " leave-calendar__day--active" : ""}`}>
                    <time dateTime={key}>{day}</time>
                    {active ? (
                      <span className="att-cell">
                        {worked > 0 ? (
                          <span className="att-cell__row">
                            <i className={`leave-dot ${open ? "att-dot--open" : "leave-dot--approved"}`} />
                            <b className="tabular">{employeeId ? hoursText(worked) : `${cell.records.length} present`}</b>
                          </span>
                        ) : null}
                        {employeeId && cell?.breakMinutes > 0 ? (
                          <span className="att-cell__break tabular"><Coffee size={11} aria-hidden="true" />{hoursText(cell.breakMinutes)}</span>
                        ) : null}
                        {onLeave ? (
                          <span className="att-cell__leave" title={cell.leaves.map((request) => `${nameOf(request)} · ${request.leaveTypeId?.name || "Leave"}`).join(", ")}>{employeeId ? (cell.leaves[0]?.leaveTypeId?.name || "Leave") : `${cell.leaves.length} on leave`}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {!records.length && !leaves.length && <div className="leave-calendar__empty"><EmptyState title="Nothing recorded this month" description="Attendance and approved leave for this month will appear here." /></div>}
          </div>}

      {/* Month totals sit under the grid so the calendar answers "how much" as
          well as "which days". */}
      <div className="att-totals">
        <div className="att-total is-work"><span><Clock3 size={14} aria-hidden="true" />Worked this month</span><strong className="tabular">{hoursText(totals.worked)}</strong></div>
        <div className="att-total is-break"><span><Coffee size={14} aria-hidden="true" />Break this month</span><strong className="tabular">{hoursText(totals.rest)}</strong></div>
        <div className="att-total"><span>Days present</span><strong className="tabular">{totals.presentDays}</strong></div>
        <div className="att-total"><span>Days on leave</span><strong className="tabular">{totals.leaveDays}</strong></div>
      </div>
    </section>

    <Modal
      open={Boolean(selectedDay)} onClose={() => setSelectedDay()}
      className="modal--drilldown"
      title={selectedDay ? new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${selectedDay}T00:00:00Z`)) : "Attendance"}
      description={selected ? `${selected.records.length} attendance ${selected.records.length === 1 ? "record" : "records"} · ${hoursText(selected.workedMinutes)} worked · ${hoursText(selected.breakMinutes)} break${selected.leaves.length ? ` · ${selected.leaves.length} on leave` : ""}` : ""}
      footer={<Button variant="secondary" onClick={() => setSelectedDay()}>Close</Button>}
    >
      {selected?.records?.length ? (
        <DataTable
          rows={selected.records}
          columns={[
            { key: "employeeId", label: "Employee", render: (_value, row) => nameOf(row) },
            { key: "status", label: "Status", render: StatusBadge },
            { key: "segments", label: "Login", render: (_value, row) => timeText(row.segments?.find((segment) => segment.type === "WORK")?.startedAt) },
            { key: "workedMinutes", label: "Worked", align: "right", render: (_value, row) => hoursText(minutesOf(row, "WORK")) },
            { key: "breakMinutes", label: "Break", align: "right", render: (_value, row) => hoursText(minutesOf(row, "BREAK")) },
          ]}
        />
      ) : null}
      {selected?.leaves?.length ? (
        <div className="att-day-leaves">
          <h3>On leave</h3>
          {selected.leaves.map((request) => (
            <p key={request._id}><strong>{nameOf(request)}</strong><span>{request.leaveTypeId?.name || "Leave"}</span></p>
          ))}
        </div>
      ) : null}
      {!selected?.records?.length && !selected?.leaves?.length ? <EmptyState title="Nothing on this day" description="No attendance or leave was recorded." /> : null}
    </Modal>
  </>;
}
