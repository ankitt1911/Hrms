import { CalendarRange, RotateCcw } from "lucide-react";
import { Button, SegmentedTabs } from "../../custom/ui";
import { GRANULARITIES, PRESETS, dateText } from "./constants";

/*
 * The whole filter set lives in the URL, so a filtered view is shareable, survives
 * a refresh, and every drill-down inherits exactly what is on screen.
 */
export default function OverviewFilterBar({ filters, filterOptions, rangeLabel, granularity, onChange, onClear, onOpenCustomRange, busy }) {
  const departments = filterOptions?.departments || [];
  const employees = filterOptions?.employees || [];
  const activeChips = [
    filters.department && { key: "department", label: "Department", value: filters.department },
    filters.employeeId && { key: "employeeId", label: "Employee", value: employees.find((employee) => String(employee._id) === filters.employeeId)?.name || "Selected employee" },
    filters.preset === "custom" && filters.startDate && { key: "range", label: "Range", value: `${dateText(filters.startDate)} – ${dateText(filters.endDate)}` },
  ].filter(Boolean);

  return (
    <div className="crm-monitor-filters overview-filters">
      <div className="crm-monitor-filters__row">
        <SegmentedTabs
          tabs={PRESETS}
          active={filters.preset}
          onChange={(value) => (value === "custom" ? onOpenCustomRange() : onChange({ preset: value, startDate: "", endDate: "" }))}
        />
        <p className="crm-monitor-filters__range"><CalendarRange size={14} aria-hidden="true" />{rangeLabel}</p>
        <label className="crm-filter crm-monitor-filters__granularity">
          <span className="sr-only">Trend granularity</span>
          <select aria-label="Trend granularity" value={granularity} onChange={(event) => onChange({ granularity: event.target.value })} disabled={busy}>
            {GRANULARITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="crm-monitor-filters__row crm-monitor-filters__row--slices">
        <span className="crm-monitor-filters__legend">Narrow to</span>
        <label className="crm-filter">
          <span className="sr-only">Department</span>
          <select aria-label="Department" value={filters.department} onChange={(event) => onChange({ department: event.target.value, employeeId: "" })} disabled={busy || !departments.length}>
            <option value="">All departments</option>
            {departments.map((department) => <option key={department} value={department}>{department}</option>)}
          </select>
        </label>
        <label className="crm-filter">
          <span className="sr-only">Employee</span>
          <select aria-label="Employee" value={filters.employeeId} onChange={(event) => onChange({ employeeId: event.target.value })} disabled={busy || !employees.length}>
            <option value="">All employees</option>
            {employees.map((employee) => <option key={employee._id} value={String(employee._id)}>{employee.name}{employee.employeeCode ? ` · ${employee.employeeCode}` : ""}</option>)}
          </select>
        </label>
        <Button variant="quiet" icon={CalendarRange} onClick={onOpenCustomRange}>Custom range</Button>
      </div>

      {activeChips.length ? (
        <div className="crm-monitor-filters__row crm-monitor-filters__chips">
          {activeChips.map((chip) => (
            <button type="button" className="crm-monitor-chip" key={chip.key} onClick={() => onChange(chip.key === "range" ? { preset: "month", startDate: "", endDate: "" } : { [chip.key]: "" })} aria-label={`Remove the ${chip.label.toLowerCase()} filter`}>
              <small>{chip.label}</small><b>{chip.value}</b><span aria-hidden="true">×</span>
            </button>
          ))}
          <Button variant="quiet" icon={RotateCcw} onClick={onClear}>Clear all</Button>
        </div>
      ) : null}
    </div>
  );
}
