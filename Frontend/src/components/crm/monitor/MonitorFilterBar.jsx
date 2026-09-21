import { CalendarRange, Filter, X } from "lucide-react";
import { Button, SegmentedTabs } from "../../custom/ui";

const PERIOD_TABS = [
  { value: "today", label: "Today" }, { value: "week", label: "This week" },
  { value: "month", label: "This month" }, { value: "quarter", label: "This quarter" },
  { value: "custom", label: "Custom" },
];

const GRANULARITIES = [{ value: "day", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }];

/*
 * Every dimension select is a named slice of the same query. Whatever is active
 * here is merged into every drill-down request, so opening a record from a
 * filtered chart never silently widens the scope it was read in.
 */
const SLICES = [
  { key: "employeeId", label: "Recruiter", allLabel: "All recruiters", options: (o) => o.recruiters?.map((r) => ({ key: String(r.employeeId), label: r.status === "FORMER" ? `${r.name} · Former` : r.name })) },
  { key: "jobOpeningId", label: "Job opening", allLabel: "All jobs", options: (o) => o.jobs },
  { key: "vendorId", label: "Client / vendor", allLabel: "All clients", options: (o) => o.vendors },
  { key: "candidateType", label: "Candidate type", allLabel: "All types", options: (o) => o.candidateTypes?.map((v) => ({ key: v, label: v === "NON_IT" ? "Non-IT" : "IT" })) },
  { key: "source", label: "Source", allLabel: "All sources", options: (o) => o.sources?.map((v) => ({ key: v, label: v })) },
  { key: "location", label: "Location", allLabel: "All locations", options: (o) => o.locations?.map((v) => ({ key: v, label: v })) },
];

export default function MonitorFilterBar({ filters, filterOptions = {}, onChange, onClear, onOpenCustomRange, rangeLabel, granularity, onGranularityChange, owner = true, busy }) {
  // `jobOpeningId` is the narrower of the two, so the API ignores vendorId when
  // both are set; disable it here rather than letting the UI imply otherwise.
  const jobSelected = Boolean(filters.jobOpeningId);
  const slices = owner ? SLICES : SLICES.filter((slice) => slice.key !== "employeeId");
  const chips = slices
    .map((slice) => { const value = filters[slice.key]; if (!value) return null; const option = slice.options(filterOptions)?.find((item) => String(item.key) === String(value)); return { key: slice.key, dimension: slice.label, value, label: option?.label || value }; })
    .filter(Boolean);

  return (
    <section className="crm-monitor-filters" aria-label="Dashboard filters">
      <div className="crm-monitor-filters__row">
        <SegmentedTabs tabs={PERIOD_TABS} active={filters.preset} onChange={(value) => (value === "custom" ? onOpenCustomRange() : onChange({ preset: value, startDate: "", endDate: "" }))} />
        <p className="crm-monitor-filters__range"><CalendarRange size={14} aria-hidden="true" />{rangeLabel}</p>
        <label className="crm-filter crm-monitor-filters__granularity">
          <span className="sr-only">Trend interval</span>
          <select aria-label="Trend interval" value={granularity} onChange={(event) => onGranularityChange(event.target.value)}>
            {GRANULARITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="crm-monitor-filters__row crm-monitor-filters__row--slices">
        <span className="crm-monitor-filters__legend"><Filter size={14} aria-hidden="true" />Slice by</span>
        {slices.map((slice) => {
          const options = slice.options(filterOptions) || [];
          const disabled = busy || !options.length || (slice.key === "vendorId" && jobSelected);
          return (
            <label className="crm-filter" key={slice.key}>
              <span className="sr-only">{slice.label}</span>
              <select aria-label={slice.label} disabled={disabled} value={filters[slice.key] || ""} onChange={(event) => onChange({ [slice.key]: event.target.value })}>
                <option value="">{slice.allLabel}</option>
                {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
          );
        })}
      </div>

      {chips.length ? (
        <div className="crm-monitor-filters__row crm-monitor-filters__chips">
          {chips.map((chip) => (
            <button type="button" className="crm-monitor-chip" key={chip.key} onClick={() => onChange({ [chip.key]: "" })} aria-label={`Remove the ${chip.label} filter`}>
              <small>{chip.dimension}</small><b>{chip.label}</b><X size={13} aria-hidden="true" />
            </button>
          ))}
          <Button variant="quiet" onClick={onClear}>Clear all</Button>
        </div>
      ) : null}
    </section>
  );
}
