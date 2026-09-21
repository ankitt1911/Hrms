import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { CalendarRange, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import * as api from "../../Services/apiCalling/crmApis";
import * as vendorJobApi from "../../Services/apiCalling/vendorJobApis";
import * as employeeApi from "../../Services/apiCalling/employeeApis";
import { unwrapCollection } from "../custom/apiBridge";
import { Button, DataTable, DateText, EmptyState, ErrorState, Modal, PageHeading, SearchField, SegmentedTabs, Skeleton, StatusBadge } from "../custom/ui";
import { ROLES } from "../../constants/roles.constants";
import { stageLabel } from "../../constants/chart.constants";
import CandidateDetailModal from "./monitor/CandidateDetailModal";

const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-IN", { month: "long" }).format(new Date(2024, month, 1)));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MODES = [
  { value: "interviewDate", label: "Interviews scheduled" },
  { value: "doj", label: "Date of joining" },
];

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

/*
 * The two modes carry different kinds of date, so they are bucketed differently.
 *  - `interviewDate` is a real instant with a time of day, so it belongs to the
 *    day the viewer sees it on — the local calendar date.
 *  - `expectedDoj`/`actualDoj` are calendar dates stored at UTC midnight, so
 *    reading them locally would shift them a day in timezones behind UTC.
 */
const localKey = (value) => { const date = new Date(value); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
const utcKey = (value) => String(new Date(value).toISOString()).slice(0, 10);
const keyFor = (candidate, mode) => (mode === "interviewDate"
  ? (candidate.interviewDate ? localKey(candidate.interviewDate) : null)
  : (candidate.actualDoj ? utcKey(candidate.actualDoj) : candidate.expectedDoj ? utcKey(candidate.expectedDoj) : null));

const timeText = (value) => (value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—");
const recruiterName = (candidate) => {
  const employee = candidate?.recruiterEmployeeId;
  return employee && typeof employee === "object" ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.workEmail || "—" : "—";
};

async function loadAll(query) {
  const first = unwrapCollection(await api.handleGetCrmCandidates({ ...query, page: 1, limit: 100 }));
  if ((first.pages || 1) <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: first.pages - 1 }, (_, index) => api.handleGetCrmCandidates({ ...query, page: index + 2, limit: 100 })));
  return [first, ...rest.map(unwrapCollection)].flatMap((paged) => paged.items);
}

export default function CandidateCalendar() {
  const isOwner = useSelector((state) => state.auth.user?.role === ROLES.SUPER_ADMIN);
  const [today] = useState(() => new Date());
  const [visibleDate, setVisibleDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [mode, setMode] = useState("interviewDate");
  const [filters, setFilters] = useState({ jobOpeningId: "", vendorId: "", recruiterEmployeeId: "", candidateType: "", search: "" });
  const [jobs, setJobs] = useState([]); const [vendors, setVendors] = useState([]); const [recruiters, setRecruiters] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState();
  const [candidateId, setCandidateId] = useState(null);

  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();

  useEffect(() => {
    let active = true;
    vendorJobApi.handleGetJobOpenings({ page: 1, limit: 100 })
      .then((data) => { if (active) setJobs(unwrapCollection(data).items); }).catch(() => undefined);
    if (!isOwner) return () => { active = false; };
    vendorJobApi.handleGetVendors({ page: 1, limit: 100, status: "ACTIVE" })
      .then((data) => { if (active) setVendors(unwrapCollection(data).items); }).catch(() => undefined);
    employeeApi.handleGetEmployees({ page: 1, limit: 100, status: "ACTIVE" })
      .then((data) => { if (active) setRecruiters(unwrapCollection(data).items.filter((employee) => employee.userId?.role === ROLES.RECRUITER)); }).catch(() => undefined);
    return () => { active = false; };
  }, [isOwner]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The window is sent as instants so the server does no timezone guessing:
      // interviews are bounded locally, joining dates in UTC.
      const lastDay = new Date(year, month + 1, 0).getDate();
      const window = mode === "interviewDate"
        ? { from: new Date(year, month, 1, 0, 0, 0).toISOString(), to: new Date(year, month, lastDay, 23, 59, 59, 999).toISOString() }
        : { from: `${dateKey(year, month, 1)}T00:00:00.000Z`, to: `${dateKey(year, month, lastDay)}T23:59:59.999Z` };
      const active = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      setCandidates(await loadAll({ dateField: mode, ...window, ...active }));
      setError("");
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [filters, mode, month, year]);

  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const days = new Map();
    candidates.forEach((candidate) => {
      const key = keyFor(candidate, mode);
      if (!key) return;
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(candidate);
    });
    return days;
  }, [candidates, mode]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = firstWeekday + daysInMonth > 35 ? 42 : 35;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstWeekday + 1;
      return day > 0 && day <= daysInMonth ? day : null;
    });
  }, [month, year]);

  const yearOptions = useMemo(() => Array.from({ length: 11 }, (_, index) => today.getFullYear() - 5 + index), [today]);
  const moveMonth = (amount) => setVisibleDate(new Date(year, month + amount, 1));
  const setFilter = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const clearFilters = () => setFilters({ jobOpeningId: "", vendorId: "", recruiterEmployeeId: "", candidateType: "", search: "" });
  const hasFilters = Object.values(filters).some(Boolean);
  const selected = selectedDay ? byDay.get(selectedDay) || [] : [];
  const interviews = mode === "interviewDate";
  const joined = candidates.filter((candidate) => candidate.actualDoj).length;

  const columns = [
    { key: "name", label: "Candidate", render: (value, row) => <button type="button" className="link-button" onClick={() => setCandidateId(String(row._id))}>{value}</button> },
    { key: "jobOpeningId", label: "Job", render: (value) => value?.title || "—" },
    { key: "client", label: "Client", render: (_value, row) => row.jobOpeningId?.companyName || row.jobOpeningId?.vendorId?.name || "—" },
    ...(interviews
      ? [{ key: "interviewDate", label: "Time", render: (value) => timeText(value) }, { key: "interviewStatus", label: "Interview", render: (value) => <StatusBadge value={value || "SCHEDULED"} /> }]
      : [{ key: "doj", label: "Joining", render: (_value, row) => <DateText value={row.actualDoj || row.expectedDoj} /> }, { key: "confirmed", label: "Confirmed", render: (_value, row) => <StatusBadge value={row.actualDoj ? "JOINED" : "EXPECTED"} /> }]),
    { key: "stage", label: "Stage", render: (value) => stageLabel(value) },
    ...(isOwner ? [{ key: "recruiterEmployeeId", label: "Recruiter", render: (_value, row) => recruiterName(row) }] : []),
  ];

  return (
    <main className="page-content">
      <PageHeading
        meta="Recruitment"
        title="Candidate calendar"
        description={interviews ? "Interviews scheduled across the month. Select a day to see who is being interviewed." : "Candidates joining across the month, confirmed and expected. Select a day to see who."}
        actions={<SegmentedTabs tabs={MODES} active={mode} onChange={setMode} />}
      />

      <section className="surface leave-calendar candidate-calendar" aria-label={`Candidate calendar for ${MONTHS[month]} ${year}`}>
        <header className="leave-calendar__header">
          <div className="leave-calendar__title">
            <span><CalendarRange size={20} /></span>
            <div><h2>{MONTHS[month]} {year}</h2><p>{candidates.length} {interviews ? (candidates.length === 1 ? "interview" : "interviews") : (candidates.length === 1 ? "joining" : "joinings")} this month{!interviews && joined ? ` · ${joined} confirmed` : ""}</p></div>
          </div>
          <div className="leave-calendar__controls">
            <button type="button" className="icon-button calendar-nav" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19} /></button>
            <label><span className="sr-only">Month</span><select value={month} onChange={(event) => setVisibleDate(new Date(year, Number(event.target.value), 1))}>{MONTHS.map((label, index) => <option value={index} key={label}>{label}</option>)}</select></label>
            <label><span className="sr-only">Year</span><select value={year} onChange={(event) => setVisibleDate(new Date(Number(event.target.value), month, 1))}>{yearOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <button type="button" className="icon-button calendar-nav" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19} /></button>
            <Button variant="quiet" onClick={() => setVisibleDate(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
          </div>
        </header>

        <div className="candidate-calendar__filters">
          <SearchField value={filters.search} onChange={(value) => setFilter({ search: value })} placeholder="Find a candidate" />
          <label className="crm-filter"><span className="sr-only">Job opening</span>
            <select value={filters.jobOpeningId} onChange={(event) => setFilter({ jobOpeningId: event.target.value })} aria-label="Job opening">
              <option value="">All jobs</option>{jobs.map((job) => <option key={job._id} value={String(job._id)}>{job.title}</option>)}
            </select>
          </label>
          {isOwner ? <label className="crm-filter"><span className="sr-only">Client</span>
            <select value={filters.vendorId} onChange={(event) => setFilter({ vendorId: event.target.value })} aria-label="Client">
              <option value="">All clients</option>{vendors.map((vendor) => <option key={vendor._id} value={String(vendor._id)}>{vendor.name}</option>)}
            </select>
          </label> : null}
          {isOwner ? <label className="crm-filter"><span className="sr-only">Recruiter</span>
            <select value={filters.recruiterEmployeeId} onChange={(event) => setFilter({ recruiterEmployeeId: event.target.value })} aria-label="Recruiter">
              <option value="">All recruiters</option>{recruiters.map((employee) => <option key={employee._id} value={String(employee._id)}>{[employee.firstName, employee.lastName].filter(Boolean).join(" ")}</option>)}
            </select>
          </label> : null}
          <label className="crm-filter"><span className="sr-only">Candidate type</span>
            <select value={filters.candidateType} onChange={(event) => setFilter({ candidateType: event.target.value })} aria-label="Candidate type">
              <option value="">Any type</option><option value="IT">IT</option><option value="NON_IT">Non-IT</option>
            </select>
          </label>
          {hasFilters ? <Button variant="quiet" icon={RotateCcw} onClick={clearFilters}>Clear</Button> : null}
        </div>

        {loading ? <div className="leave-calendar__loading"><Skeleton rows={6} /></div>
          : error ? <ErrorState message={error} onRetry={load} />
            : <div className="leave-calendar__viewport">
              <div className="leave-calendar__weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}><b>{day.slice(0, 3)}</b><i>{day.slice(0, 1)}</i></span>)}</div>
              <div className="leave-calendar__grid">
                {cells.map((day, index) => {
                  if (!day) return <div className="leave-calendar__day leave-calendar__day--empty" aria-hidden="true" key={`empty-${index}`} />;
                  const key = dateKey(year, month, day);
                  const rows = byDay.get(key) || [];
                  const isToday = key === dateKey(today.getFullYear(), today.getMonth(), today.getDate());
                  const confirmed = !interviews && rows.filter((row) => row.actualDoj).length;
                  return (
                    <button type="button" key={key} disabled={!rows.length} onClick={() => setSelectedDay(key)}
                      className={`leave-calendar__day${isToday ? " leave-calendar__day--today" : ""}${rows.length ? " leave-calendar__day--active" : ""}`}
                      aria-label={`${day} ${MONTHS[month]} ${year}, ${rows.length} ${interviews ? "interviews" : "joinings"}`}>
                      <time dateTime={key}>{day}</time>
                      {rows.length ? (
                        <span className="cand-cell">
                          <b className={`cand-count ${interviews ? "is-interview" : "is-doj"}`}>{rows.length}</b>
                          <span className="cand-cell__label">{interviews ? (rows.length === 1 ? "interview" : "interviews") : (rows.length === 1 ? "joining" : "joinings")}</span>
                          {confirmed ? <span className="cand-cell__confirmed">{confirmed} confirmed</span> : null}
                          <span className="cand-cell__names">{rows.slice(0, 2).map((row) => row.name).join(", ")}{rows.length > 2 ? ` +${rows.length - 2}` : ""}</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {!candidates.length && <div className="leave-calendar__empty"><EmptyState title={interviews ? "No interviews this month" : "No joinings this month"} description={hasFilters ? "No candidate matched these filters in this month." : "Scheduled interviews and joining dates will appear here."} /></div>}
            </div>}
      </section>

      <Modal
        open={Boolean(selectedDay)} onClose={() => setSelectedDay()} className="modal--drilldown"
        title={selectedDay ? new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date(`${selectedDay}T12:00:00`)) : "Candidates"}
        description={`${selected.length} ${interviews ? (selected.length === 1 ? "interview" : "interviews") : (selected.length === 1 ? "candidate joining" : "candidates joining")} on this day. Select a name for the full profile.`}
        footer={<Button variant="secondary" onClick={() => setSelectedDay()}>Close</Button>}
      >
        {selected.length ? <DataTable rows={selected} columns={columns} /> : <EmptyState title="Nothing on this day" />}
      </Modal>

      {/* Level two: the same candidate profile the CRM monitor opens. */}
      <CandidateDetailModal open={Boolean(candidateId)} candidateId={candidateId} onClose={() => setCandidateId(null)} />
    </main>
  );
}
