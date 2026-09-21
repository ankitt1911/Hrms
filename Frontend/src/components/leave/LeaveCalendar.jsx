import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import * as leave from "../../Services/apiCalling/leaveApis";
import { unwrapCollection } from "../custom/apiBridge";
import { Button, DateText, EmptyState, ErrorState, Modal, Skeleton, StatusBadge } from "../custom/ui";

const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-IN", { month: "long" }).format(new Date(2024, month, 1)));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STATUS_PRIORITY = { PENDING: 4, APPROVED: 3, REJECTED: 2, CANCELLED: 1 };

const dateKey = (year, month, day) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const requestDateKey = (value) => String(value || "").slice(0, 10);
const employeeName = (request) => {
  const employee = request?.employeeId || request?.employee;
  return employee && typeof employee === "object"
    ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.employeeCode || "Employee"
    : request?.employeeName || "Employee";
};
const employeeKey = (request) => String(request?.employeeId?._id || request?.employeeId || request?.employee?._id || employeeName(request));
const leaveTypeName = (request) => request?.leaveTypeId?.name || request?.leaveType?.name || "Leave";

async function loadMonth(year, month, ownOnly) {
  const query = { page: 1, limit: 100, from: dateKey(year, month, 1), to: dateKey(year, month, new Date(year, month + 1, 0).getDate()) };
  const readLeaves = ownOnly ? leave.handleGetMyLeave : leave.handleGetLeaveQueue;
  const first = unwrapCollection(await readLeaves(query));
  if (first.pages <= 1) return first.items;
  const remaining = await Promise.all(Array.from({ length: first.pages - 1 }, (_, index) => readLeaves({ ...query, page: index + 2 })));
  return [first, ...remaining.map(unwrapCollection)].flatMap((page) => page.items);
}

export default function LeaveCalendar({ ownOnly = false }) {
  const [today] = useState(() => new Date());
  const [visibleDate, setVisibleDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState();
  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await loadMonth(year, month, ownOnly));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [month, ownOnly, year]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadMonth(year, month, ownOnly).then((items) => {
      if (active) { setRequests(items); setError(""); }
    }).catch((requestError) => {
      if (active) setError(requestError.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [month, ownOnly, year]);

  const requestsByDay = useMemo(() => {
    const days = new Map();
    requests.forEach((request) => {
      const start = requestDateKey(request.startDate);
      const end = requestDateKey(request.endDate);
      if (!start || !end) return;
      const cursor = new Date(`${start}T00:00:00Z`);
      const last = new Date(`${end}T00:00:00Z`);
      while (cursor <= last) {
        const key = cursor.toISOString().slice(0, 10);
        if (key >= dateKey(year, month, 1) && key <= dateKey(year, month, 31)) {
          const dayRequests = days.get(key) || [];
          dayRequests.push(request);
          days.set(key, dayRequests);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });
    return days;
  }, [month, requests, year]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = firstWeekday + daysInMonth > 35 ? 42 : 35;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstWeekday + 1;
      return day > 0 && day <= daysInMonth ? day : null;
    });
  }, [month, year]);

  const yearOptions = useMemo(() => Array.from({ length: 31 }, (_, index) => year - 15 + index), [year]);
  const moveMonth = (amount) => setVisibleDate(new Date(year, month + amount, 1));
  const selectedRequests = selectedDay ? requestsByDay.get(selectedDay) || [] : [];

  return <>
    <section className="surface leave-calendar" aria-label={`Leave calendar for ${MONTHS[month]} ${year}`}>
      <header className="leave-calendar__header">
        <div className="leave-calendar__title"><span><CalendarDays size={20}/></span><div><h2>{MONTHS[month]} {year}</h2><p>{ownOnly ? "Review your requests and past leave decisions by date." : "Review current requests and past leave decisions by date."}</p></div></div>
        <div className="leave-calendar__controls">
          <button type="button" className="icon-button calendar-nav" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19}/></button>
          <label><span className="sr-only">Month</span><select value={month} onChange={(event) => setVisibleDate(new Date(year, Number(event.target.value), 1))}>{MONTHS.map((label, index) => <option value={index} key={label}>{label}</option>)}</select></label>
          <label><span className="sr-only">Year</span><select value={year} onChange={(event) => setVisibleDate(new Date(Number(event.target.value), month, 1))}>{yearOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <button type="button" className="icon-button calendar-nav" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19}/></button>
          <Button variant="quiet" onClick={() => setVisibleDate(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
        </div>
      </header>
      <div className="leave-calendar__legend" aria-label="Leave status legend">
        <span><i className="leave-dot leave-dot--pending"/>Pending approval</span><span><i className="leave-dot leave-dot--approved"/>Approved</span><span><i className="leave-dot leave-dot--rejected"/>Rejected</span><span><i className="leave-dot leave-dot--cancelled"/>Cancelled</span>
      </div>
      {loading ? <div className="leave-calendar__loading"><Skeleton rows={6}/></div> : error ? <ErrorState message={error} onRetry={fetchRequests}/> : <div className="leave-calendar__viewport">
        <div className="leave-calendar__weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}><b>{day.slice(0, 3)}</b><i>{day.slice(0, 1)}</i></span>)}</div>
        <div className="leave-calendar__grid">
          {cells.map((day, index) => {
            if (!day) return <div className="leave-calendar__day leave-calendar__day--empty" aria-hidden="true" key={`empty-${index}`}/>;
            const key = dateKey(year, month, day);
            const dayRequests = requestsByDay.get(key) || [];
            const employeeDots = [...dayRequests.reduce((employees, request) => {
              const id = employeeKey(request); const existing = employees.get(id);
              if (!existing || (STATUS_PRIORITY[request.status] || 0) > (STATUS_PRIORITY[existing.status] || 0)) employees.set(id, request);
              return employees;
            }, new Map()).values()];
            const isToday = key === dateKey(today.getFullYear(), today.getMonth(), today.getDate());
            return <button type="button" className={`leave-calendar__day${isToday ? " leave-calendar__day--today" : ""}${dayRequests.length ? " leave-calendar__day--active" : ""}`} disabled={!dayRequests.length} onClick={() => setSelectedDay(key)} aria-label={`${day} ${MONTHS[month]} ${year}${employeeDots.length ? `, ${employeeDots.length} employee leave ${employeeDots.length === 1 ? "record" : "records"}` : ", no leave"}`} key={key}>
              <time dateTime={key}>{day}</time>
              <span className="leave-calendar__dots">{employeeDots.slice(0, 8).map((request) => <i className={`leave-dot leave-dot--${String(request.status).toLowerCase()}`} title={`${employeeName(request)} · ${String(request.status).toLowerCase()}`} key={employeeKey(request)}/>) }{employeeDots.length > 8 && <small>+{employeeDots.length - 8}</small>}</span>
              {employeeDots.length > 0 && <small className="leave-calendar__count">{employeeDots.length} {employeeDots.length === 1 ? "employee" : "employees"}</small>}
            </button>;
          })}
        </div>
        {!requests.length && <div className="leave-calendar__empty"><EmptyState title="No leave this month" description={ownOnly ? "Your requests and historical decisions for this month will appear here." : "Leave requests and historical decisions for this month will appear here."}/></div>}
      </div>}
    </section>

    <Modal open={Boolean(selectedDay)} onClose={() => setSelectedDay()} title={selectedDay ? new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${selectedDay}T00:00:00Z`)) : "Leave details"} description={ownOnly ? `${selectedRequests.length} leave ${selectedRequests.length === 1 ? "request covers" : "requests cover"} this date.` : `${new Set(selectedRequests.map(employeeKey)).size} ${new Set(selectedRequests.map(employeeKey)).size === 1 ? "employee" : "employees"} away or requesting leave on this date.`} footer={<Button variant="secondary" onClick={() => setSelectedDay()}>Close</Button>}>
      <div className="leave-day-details">{selectedRequests.map((request) => <article key={request._id}>
        <header><div className="leave-person"><span className="leave-person__avatar">{employeeName(request).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{employeeName(request)}</strong><small>{request.employeeId?.employeeCode || leaveTypeName(request)}</small></div></div><StatusBadge value={request.status}/></header>
        <dl><div><dt>Leave type</dt><dd>{leaveTypeName(request)}</dd></div><div><dt>Duration</dt><dd><DateText value={request.startDate}/> – <DateText value={request.endDate}/></dd></div>{request.createdAt && <div><dt>Requested</dt><dd><DateText value={request.createdAt} withTime/></dd></div>}{request.decidedAt && <div><dt>Decision made</dt><dd><DateText value={request.decidedAt} withTime/></dd></div>}{request.reason && <div className="span-2"><dt>Reason</dt><dd>{request.reason}</dd></div>}{request.decisionNote && <div className="span-2"><dt>Decision note</dt><dd>{request.decisionNote}</dd></div>}{request.cancellationReason && <div className="span-2"><dt>Cancellation reason</dt><dd>{request.cancellationReason}</dd></div>}</dl>
      </article>)}</div>
    </Modal>
  </>;
}
