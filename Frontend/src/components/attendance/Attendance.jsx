import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarDays, Clock3, Coffee, Edit3, Flag, List, LogIn, LogOut, Play, X } from "lucide-react";
import * as api from "../../Services/apiCalling/attendanceApis";
import useAttendanceClock from "../../hooks/useAttendanceClock";
import { dateKeyInTimeZone, estimateServerTimestamp } from "../../Utlis/Common/attendanceTime";
import { unwrapCollection, transitionResult } from "../custom/apiBridge";
import { Button, DataTable, DateText, EmptyState, ErrorState, Field, Modal, PageHeading, Pagination, Skeleton, StatusBadge } from "../custom/ui";
import { clockPulse, listItem, listReveal } from "../../motion/variants";
import usePrefersReducedMotion from "../../motion/usePrefersReducedMotion";
import ShiftDial from "./ShiftDial";
import DayTimeline from "./DayTimeline";
import WeekStrip from "./WeekStrip";
import AttendanceCalendar from "./AttendanceCalendar";

const timeText = (value) => value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
// Same as timeText, but pinned to the company timezone rather than the device.
const clockText = (value, timeZone) => (value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value)) : "—");
const durationText = (startedAt, endedAt) => {
  const milliseconds = Math.max(0, new Date(endedAt || Date.now()).getTime() - new Date(startedAt).getTime());
  const totalMinutes = Math.floor(milliseconds / 60000); const hours = Math.floor(totalMinutes / 60); const minutes = totalMinutes % 60;
  if (!totalMinutes) return "< 1 min";
  return [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" ");
};
const hoursText = (value) => {
  const totalMinutes = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(totalMinutes / 60); const minutes = totalMinutes % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ") || "0m";
};
const loginTime = (row) => timeText(row?.segments?.find((segment) => segment.type === "WORK")?.startedAt);
const logoutTime = (row) => {
  if (row?.status !== "COMPLETED") return "—";
  const endedTimes = (row.segments || []).map((segment) => segment.endedAt).filter(Boolean).sort();
  return timeText(endedTimes.at(-1));
};
const employeeName = (row) => {
  const employee = row.employeeId || row.employee;
  if (employee && typeof employee === "object") return [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.employeeCode || "—";
  return row.employeeName || row.employeeCode || "—";
};

export function MyAttendance() {
  const [state, setState] = useState(); const [history, setHistory] = useState([]); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const clock = useAttendanceClock(state);
  const reduced = usePrefersReducedMotion();
  const load = useCallback(async () => { setError(""); try { const [current, rows] = await Promise.all([api.handleGetAttendanceState(), api.handleGetMyAttendanceHistory({ page: 1, limit: 30 })]); setState(current); setHistory(unwrapCollection(rows).items); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!state?.businessDate || !state?.serverNow) return undefined;
    const receivedAt=Date.now(); let refreshing=false;
    const refreshForNewDay=async()=>{const serverNow=estimateServerTimestamp({serverNow:state.serverNow,receivedAt,localNow:Date.now()});if(!refreshing&&dateKeyInTimeZone(serverNow,state.timeZone)!==state.businessDate){refreshing=true;try{await load();}finally{refreshing=false;}}};
    const timer=window.setInterval(refreshForNewDay,10000);
    const onVisible=()=>{if(document.visibilityState==="visible")refreshForNewDay();};
    window.addEventListener("focus",refreshForNewDay);document.addEventListener("visibilitychange",onVisible);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refreshForNewDay);document.removeEventListener("visibilitychange",onVisible);};
  },[state?.businessDate,state?.serverNow,state?.timeZone,load]);

  const act = async (name, fn) => { setBusy(name); try { transitionResult(await fn()); await load(); } catch (e) { setError(e.message); } finally { setBusy(""); } };
  const status = state?.status || "NOT_STARTED";
  const live = ["WORKING", "ON_BREAK"].includes(status);
  const targetMinutes = state?.workday?.standardWorkMinutes || 480;
  const timeZone = state?.timeZone || "UTC";
  const segments = clock.record?.segments || state?.segments || [];
  const sessions = segments.filter((segment) => segment.type === "WORK").length;
  const workedMinutesNow = Math.floor(clock.workedSeconds / 60);
  const breakMinutesNow = Math.floor(clock.breakSeconds / 60);
  const weekHistory = useMemo(() => history.map((row) => (dateKeyInTimeZone(row.workDate, "UTC") === state?.businessDate
    ? { ...row, workedMinutes: workedMinutesNow, breakMinutes: breakMinutesNow }
    : row)), [history, state?.businessDate, workedMinutesNow, breakMinutesNow]);

  const action = status === "NOT_STARTED" ? ["Clock in", api.handleClockIn, LogIn] : status === "WORKING" ? ["Start break", api.handleBreak, Coffee] : status === "ON_BREAK" ? ["Resume work", api.handleResume, Play] : null;

  // One sentence that says what to do next, so the page reads as a prompt rather
  // than a readout.
  const prompt = status === "NOT_STARTED" ? "Your shift has not started yet."
    : status === "WORKING" ? "You are on the clock. Remember to mark a break when you step away."
      : status === "ON_BREAK" ? "You are on a break. The work timer is paused."
        : "You have clocked out for today. Nice work.";

  const startedAt = segments.length ? segments.reduce((earliest, segment) => (!earliest || segment.startedAt < earliest ? segment.startedAt : earliest), null) : null;
  // When you can leave: the work still owed, added to now. Taking another break
  // pushes it later on its own, which is the honest behaviour.
  const remainingSeconds = Math.max(0, targetMinutes * 60 - clock.workedSeconds);
  const expectedOut = startedAt && status !== "COMPLETED" ? new Date(clock.estimatedNow + remainingSeconds * 1000) : null;
  const finishesToday = expectedOut ? dateKeyInTimeZone(expectedOut, timeZone) === state?.businessDate : false;

  const stats = [
    { key: "work", label: "Worked", value: clock.elapsed, tone: "work", icon: Clock3 },
    { key: "break", label: "Break", value: clock.breakElapsed, tone: "break", icon: Coffee },
    { key: "started", label: "Clocked in", value: startedAt ? clockText(startedAt, timeZone) : "—", tone: "plain", icon: LogIn },
    {
      key: "out",
      label: status === "COMPLETED" ? "Clocked out" : remainingSeconds === 0 ? "Target met" : finishesToday ? "Can leave by" : "Still to work",
      value: status === "COMPLETED" ? (logoutTime(clock.record || state) || "—")
        : remainingSeconds === 0 ? "Done"
          : expectedOut ? (finishesToday ? clockText(expectedOut, timeZone) : hoursText(Math.ceil(remainingSeconds / 60))) : "—",
      tone: remainingSeconds === 0 ? "done" : "plain",
      icon: Flag,
    },
  ];

  return <main className="page-content attendance-page">
    <PageHeading meta="Attendance" title="My workday" description="Your timer is derived from the server record and re-synced after every action, so it stays right even if this device's clock is not." />
    {error && <ErrorState message={error} onRetry={load} />}

    {!state ? <Skeleton rows={4} /> : <>
      <motion.section
        className={`surface surface--floating attendance-hero is-${status.toLowerCase().replaceAll("_", "-")}`}
        initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="attendance-hero__dial">
          <ShiftDial
            workedSeconds={clock.workedSeconds} breakSeconds={clock.breakSeconds}
            targetSeconds={targetMinutes * 60} status={status} elapsed={clock.elapsed} reduced={reduced}
          />
        </div>

        <div className="attendance-hero__side">
          <div className="attendance-hero__top">
            <div className="attendance-hero__title">
              <StatusBadge value={status} />
              <h2>{state.workDate ? <DateText value={state.workDate} /> : "No shift today"}</h2>
            </div>
            <div className="attendance-actions">
              {action && <motion.div {...clockPulse(reduced)}><Button icon={action[2]} loading={busy === action[0]} onClick={() => act(action[0], action[1])}>{action[0]}</Button></motion.div>}
              {live && <motion.div {...clockPulse(reduced)}><Button variant="danger" icon={LogOut} loading={busy === "Clock out"} onClick={() => act("Clock out", api.handleClockOut)}>Clock out</Button></motion.div>}
            </div>
          </div>
          <p className="attendance-hero__prompt">{prompt}</p>

          <motion.div className="attendance-stats" variants={listReveal(reduced)} initial="hidden" animate="show">
            {stats.map((stat) => (
              <motion.div className={`attendance-stat is-${stat.tone}`} key={stat.key} variants={listItem(reduced)}>
                <span><stat.icon size={14} aria-hidden="true" />{stat.label}</span>
                <strong className="tabular" aria-live="off">{stat.value}</strong>
              </motion.div>
            ))}
          </motion.div>

          <DayTimeline segments={segments} estimatedNow={clock.estimatedNow} timeZone={timeZone} sessions={sessions} reduced={reduced} />
        </div>
      </motion.section>

      <section className="surface section-space attendance-week">
        <div className="section-header"><div><h2>Your last two weeks</h2><p>Hours worked each day against your {(targetMinutes / 60).toFixed(0)}-hour target.</p></div></div>
        {history.length ? <WeekStrip history={weekHistory} targetMinutes={targetMinutes} todayKey={state.businessDate} reduced={reduced} />
          : <EmptyState title="No history yet" description="Your completed days will build up here." />}
      </section>
    </>}

    <section className="surface section-space"><div className="section-header"><div><h2>Recent attendance</h2><p>Your last ten server records.</p></div></div>
      {history.length ? <DataTable rows={history.slice(0, 10)} columns={[{ key: "workDate", label: "Date", render: DateText }, { key: "loginAt", label: "Login", render: (_value,row) => loginTime(row) }, { key: "logoutAt", label: "Logout", render: (_value,row) => logoutTime(row) }, { key: "status", label: "Status", render: StatusBadge }, { key: "workedMinutes", label: "Work (hrs)", align: "right", render: hoursText }, { key: "breakMinutes", label: "Break (hrs)", align: "right", render: hoursText }]} />
        : <EmptyState title="Nothing recorded yet" description="Clock in to create your first attendance record." />}
    </section>
  </main>;
}

const REGISTER_FILTER_KEYS = ["employeeId", "status", "date", "from", "to"];

export function AttendanceRegister() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCalendar, setShowCalendar] = useState(false);
  const [rows, setRows] = useState([]); const [meta, setMeta] = useState({ page: 1, pages: 1 }); const [page, setPage] = useState(1); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [editing,setEditing]=useState(); const [breakDetails,setBreakDetails]=useState(); const [saving,setSaving]=useState(false); const [form,setForm]=useState({status:"COMPLETED",reason:"",startedAt:"",endedAt:""});
  const filters = useMemo(() => Object.fromEntries(REGISTER_FILTER_KEYS.map((key) => [key, searchParams.get(key) || ""]).filter(([, value]) => value)), [searchParams]);
  const filterKey = JSON.stringify(filters);
  const clearFilter = (key) => setSearchParams((current) => { const next = new URLSearchParams(current); next.delete(key); return next; }, { replace: true });
  const load = useCallback(async () => { setLoading(true); try { const data = unwrapCollection(await api.handleGetAttendanceRegister({ ...JSON.parse(filterKey), page, limit: 20 })); setRows(data.items); setMeta(data); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }, [filterKey, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filterKey]);
  const openCorrection=row=>{const work=row.segments?.find(s=>s.type==="WORK")||{};setForm({status:row.status||"COMPLETED",reason:"",startedAt:work.startedAt?work.startedAt.slice(0,16):"",endedAt:work.endedAt?work.endedAt.slice(0,16):""});setEditing(row);};
  const correct=async(e)=>{e.preventDefault();setSaving(true);setError("");try{const payload={expectedVersion:editing.__v,reason:form.reason,status:form.status,...(form.startedAt&&form.endedAt?{segments:[{type:"WORK",startedAt:new Date(form.startedAt).toISOString(),endedAt:new Date(form.endedAt).toISOString()}]}:{})};transitionResult(await api.handleCorrectAttendance(editing._id,payload));setEditing();await load();}catch(err){setError(err?.code==="VERSION_CONFLICT"?"This record changed while you were editing. It has been reloaded; review it and try again.":err.message);await load();}finally{setSaving(false);}};
  const breakRows=(breakDetails?.segments||[]).filter(segment=>segment.type==="BREAK").map((segment,index)=>({...segment,sequence:index+1,duration:durationText(segment.startedAt,segment.endedAt)}));
  return <main className="page-content"><PageHeading meta="People operations" title={showCalendar ? "Attendance calendar" : "Attendance register"} description={showCalendar ? "A monthly view of each employee’s working hours, breaks, and leave." : "Employee login, logout, and break activity for each workday."} actions={<Button variant={showCalendar ? "secondary" : "primary"} icon={showCalendar ? List : CalendarDays} onClick={() => setShowCalendar((current) => !current)}>{showCalendar ? "Back to register" : "Attendance calendar"}</Button>} />{showCalendar ? <AttendanceCalendar /> : <><section className="surface">{Object.keys(filters).length ? <div className="toolbar">{Object.entries(filters).map(([key, value]) => <button type="button" className="crm-monitor-chip" key={key} onClick={() => clearFilter(key)} aria-label={`Remove the ${key} filter`}><small>{key}</small><b>{String(value).replaceAll("_", " ")}</b><X size={12} aria-hidden="true" /></button>)}</div> : null}{loading ? <Skeleton rows={7} /> : error ? <ErrorState message={error} onRetry={load} /> : <><DataTable rows={rows} columns={[{ key: "employeeId", label: "Employee", render: (_value,row) => employeeName(row) }, { key: "workDate", label: "Date", render: DateText }, { key: "loginAt", label: "Login", render: (_value,row) => loginTime(row) }, { key: "logoutAt", label: "Logout", render: (_value,row) => logoutTime(row) }, { key: "status", label: "Status", render: StatusBadge }, { key: "workedMinutes", label: "Work (hrs)", align: "right", render: hoursText }, { key: "breakMinutes", label: "Break (hrs)", align: "right", render: hoursText }, { key: "segments", label: "Breaks", align: "center", render: (_value,row) => { const count=(row.segments||[]).filter(segment=>segment.type==="BREAK").length; return <Button variant="quiet" onClick={()=>setBreakDetails(row)} aria-label={`View ${count} breaks for ${employeeName(row)}`}>{count}</Button>; } }]} actions={row=><Button variant="quiet" icon={Edit3} onClick={()=>openCorrection(row)}>Correct</Button>} /><Pagination page={meta.page} pages={meta.pages} onChange={setPage} /></>}
    </section></>}
    <Modal open={Boolean(breakDetails)} onClose={()=>setBreakDetails()} title={`${employeeName(breakDetails||{})} · Breaks`} description={breakDetails?.workDate?`Attendance date: ${new Intl.DateTimeFormat("en-IN",{dateStyle:"medium"}).format(new Date(breakDetails.workDate))}`:"Break details"} footer={<Button variant="secondary" onClick={()=>setBreakDetails()}>Close</Button>}>{breakRows.length?<DataTable rows={breakRows} columns={[{key:"sequence",label:"Break #"},{key:"startedAt",label:"Started",render:timeText},{key:"endedAt",label:"Ended",render:(value)=>value?timeText(value):"In progress"},{key:"duration",label:"Duration"}]}/>:<EmptyState title="No breaks recorded" description="This employee has not taken a break on this date."/>}</Modal>
    <Modal open={Boolean(editing)} onClose={()=>setEditing()} title="Correct attendance record" description="Changes are version-checked and recorded in the audit trail." footer={<><Button variant="secondary" onClick={()=>setEditing()}>Cancel</Button><Button loading={saving} onClick={correct}>Save correction</Button></>}><form className="form-grid" onSubmit={correct}><Field label="Status"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{["WORKING","ON_BREAK","COMPLETED"].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Reason"><input className="control" value={form.reason} required onChange={e=>setForm({...form,reason:e.target.value})}/></Field><Field label="Work started"><input className="control" type="datetime-local" value={form.startedAt} onChange={e=>setForm({...form,startedAt:e.target.value})}/></Field><Field label="Work ended"><input className="control" type="datetime-local" value={form.endedAt} onChange={e=>setForm({...form,endedAt:e.target.value})}/></Field><button type="submit" hidden/></form></Modal></main>;
}
