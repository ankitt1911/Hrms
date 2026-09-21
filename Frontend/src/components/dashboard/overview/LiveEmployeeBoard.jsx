import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, SearchField, StatusBadge } from "../../custom/ui";
import { formatDuration } from "../../../Utlis/Common/attendanceTime";
import { initialsOf, timeText } from "./constants";

/*
 * Every active employee in one place, grouped by what they are doing right now.
 * Ordering comes from the server (working -> on break -> yet to clock in ->
 * finished -> on leave), so the people an admin is most likely to be looking for
 * are already at the top and the grouping just labels the boundaries.
 *
 * Durations tick every second. They carry aria-live="off" deliberately: a screen
 * reader should not announce a new time once a second.
 */
const GROUPS = [
  { status: "WORKING", label: "Working now" },
  { status: "ON_BREAK", label: "On break" },
  { status: "NOT_STARTED", label: "Yet to clock in" },
  { status: "COMPLETED", label: "Finished for the day" },
  { status: "ON_LEAVE", label: "On leave" },
];

const FILTERS = [{ value: "", label: "Everyone" }, ...GROUPS.map((group) => ({ value: group.status, label: group.label }))];

export default function LiveEmployeeBoard({ rows, timeZone, truncated, onSelect }) {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => (!status || row.status === status)
      && (!term || `${row.employeeName} ${row.employeeCode || ""} ${row.department || ""}`.toLowerCase().includes(term)));
  }, [rows, search, status]);

  const groups = GROUPS.map((group) => ({ ...group, rows: visible.filter((row) => row.status === group.status) })).filter((group) => group.rows.length);

  return (
    <div className="live-board">
      <div className="live-board__toolbar">
        <div className="tabs" role="tablist" aria-label="Filter by status">
          {FILTERS.map((filter) => (
            <button type="button" key={filter.value || "all"} role="tab" aria-selected={status === filter.value}
              className={status === filter.value ? "active" : ""} onClick={() => setStatus(filter.value)}>
              {filter.label}
            </button>
          ))}
        </div>
        <SearchField value={search} onChange={setSearch} placeholder="Find an employee" />
      </div>

      {visible.length ? (
        <div className="live-board__scroll">
          <table className="live-table">
            <thead>
              <tr>
                <th>Employee</th><th>Status</th><th>Clocked in</th>
                <th className="align-right">Worked today</th><th className="align-right">Break today</th><th className="align-right">Current stretch</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.status}>
                <tr className="live-group">
                  <th colSpan={6} scope="colgroup">{group.label}<span className="tabular">{group.rows.length}</span></th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.employeeId} className={row.status === "ON_BREAK" ? "is-live is-break" : row.live ? "is-live" : ""} onClick={() => onSelect?.(row)} tabIndex={0}
                    onKeyDown={(event) => { if (event.key === "Enter") onSelect?.(row); }}>
                    <td data-label="Employee">
                      <span className="overview-person"><i aria-hidden="true">{initialsOf(row.employeeName)}</i>
                        <b>{row.employeeName}</b>{row.department ? <small>{row.department}</small> : null}</span>
                    </td>
                    <td data-label="Status"><StatusBadge value={row.status === "ON_LEAVE" ? (row.leave?.leaveTypeName || "On leave") : row.status} /></td>
                    <td data-label="Clocked in" className="tabular">{timeText(row.loginAt, timeZone)}</td>
                    <td data-label="Worked today" className="align-right"><span className="live-duration" aria-live="off">{formatDuration(row.workedSeconds)}</span></td>
                    <td data-label="Break today" className="align-right"><span className="live-duration live-duration--muted" aria-live="off">{formatDuration(row.breakSeconds)}</span></td>
                    <td data-label="Current stretch" className="align-right">
                      {row.currentSeconds == null ? <span className="muted">—</span>
                        : <span className="live-duration live-duration--muted" aria-live="off">{formatDuration(row.currentSeconds)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : <EmptyState title="Nobody matches" description="No employee matches this status and search." />}

      <div className="live-board__foot">
        {truncated ? <span className="muted">Showing the first 500 employees.</span> : <span className="muted">{visible.length} of {rows.length} shown</span>}
        <Link to="/attendance">Open the attendance register <ArrowUpRight size={14} /></Link>
      </div>
    </div>
  );
}
