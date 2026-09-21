import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import * as api from "../../../Services/apiCalling/crmApis";
import { BarChart, ChartCard, TrendChart } from "../../custom/charts";
import { DataTable, DateText, EmptyState, ErrorState, Modal, Pagination, SearchField, Skeleton, StatusBadge } from "../../custom/ui";
import { CATEGORICAL, STAGE_RAMP, formatCount, stageColor, stageLabel } from "../../../constants/chart.constants";

const SORTS = [
  { value: "recent", label: "Recently updated" }, { value: "name", label: "Candidate name" },
  { value: "stage", label: "Stage" }, { value: "oldest", label: "Oldest submission" },
];

const comparators = {
  recent: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
  stage: (a, b) => String(a.stage).localeCompare(String(b.stage)),
};

/*
 * Level 2 of the drill-down. It charts the slice it was opened on (by stage, by
 * recruiter, by job, over time) and lists the candidate rows behind it; a row
 * opens level 3. Search and sort are applied to the fetched page only, which is
 * why the page size is generous and the server total is always shown.
 */
export default function DrilldownModal({ open, request, onClose, onSelectCandidate }) {
  const [data, setData] = useState();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const requestRef = useRef(0);

  useEffect(() => { if (open) { setPage(1); setSearch(""); setSort("recent"); setData(undefined); } }, [open, request?.dimension, request?.value]);

  const load = useCallback(async () => {
    if (!open || !request) return;
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    try {
      const next = await api.handleGetCrmDrilldown({ ...request.params, dimension: request.dimension, ...(request.value ? { value: request.value } : {}), page, limit: 50 });
      if (requestId === requestRef.current) setData(next);
    } catch (requestError) {
      if (requestId === requestRef.current) setError(requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [open, page, request]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = !term ? (data?.items || []) : (data?.items || []).filter((item) => [item.name, item.contact?.phone, item.contact?.email, item.jobTitle, item.client, item.recruiterName, item.location].some((field) => String(field || "").toLowerCase().includes(term)));
    return [...filtered].sort(comparators[sort]);
  }, [data?.items, search, sort]);

  const summary = data?.summary;
  const columns = [
    { key: "name", label: "Candidate", render: (value, row) => <span className="crm-drilldown-name"><b>{value}</b><small>{row.contact?.phone || row.contact?.email || "No contact"}</small></span> },
    { key: "stage", label: "Stage", render: (value) => <StatusBadge value={value} /> },
    { key: "jobTitle", label: "Job" },
    { key: "client", label: "Client" },
    { key: "recruiterName", label: "Recruiter" },
    { key: "location", label: "Location" },
    { key: "updatedAt", label: "Last activity", render: (value) => <DateText value={value} withTime /> },
  ];

  const trendSeries = [
    { key: "NEW_LEAD", label: stageLabel("NEW_LEAD"), color: stageColor("NEW_LEAD") },
    { key: "SELECTED", label: stageLabel("SELECTED"), color: stageColor("SELECTED") },
    { key: "JOINED", label: stageLabel("JOINED"), color: stageColor("JOINED") },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="modal--crm-drilldown"
      title={summary?.label || request?.label || "Drill-down"}
      description={summary ? `${formatCount(summary.total)} candidate${summary.total === 1 ? "" : "s"}${summary.range ? ` · ${summary.range.startDate} to ${summary.range.endDate} (${summary.range.timezone})` : ""}${data?.capped ? " · showing the first 5,000" : ""}` : "Loading the records behind this figure."}
    >
      {error ? <ErrorState message={error} onRetry={load} /> : loading && !data ? <Skeleton rows={6} /> : summary ? (
        <div className="crm-drilldown">
          <div className="crm-drilldown__charts">
            {summary.byStage?.length ? (
              <ChartCard title="By current stage" description="Where these candidates stand right now." className="chart-card--inset">
                <BarChart
                  data={summary.byStage.map((row) => ({ ...row, color: stageColor(row.key) }))}
                  series={[{ key: "count", label: "Candidates" }]}
                  layout="vertical" height={Math.max(160, summary.byStage.length * 34 + 40)}
                  ariaLabel="Candidates by current stage"
                />
              </ChartCard>
            ) : null}
            {summary.byRecruiter?.length > 1 ? (
              <ChartCard title="By recruiter" description="Who owns these candidates." className="chart-card--inset">
                <BarChart
                  data={summary.byRecruiter.slice(0, 8).map((row, index) => ({ ...row, color: CATEGORICAL[index % CATEGORICAL.length] }))}
                  series={[{ key: "count", label: "Candidates" }]}
                  layout="vertical" height={Math.max(160, Math.min(8, summary.byRecruiter.length) * 34 + 40)}
                  ariaLabel="Candidates by recruiter"
                />
              </ChartCard>
            ) : null}
            {summary.byJob?.length > 1 ? (
              <ChartCard title="By job opening" description="The top requisitions in this slice." className="chart-card--inset">
                <BarChart
                  data={summary.byJob.slice(0, 8).map((row) => ({ ...row, color: STAGE_RAMP[3] }))}
                  series={[{ key: "count", label: "Candidates" }]}
                  layout="vertical" height={Math.max(160, Math.min(8, summary.byJob.length) * 34 + 40)}
                  ariaLabel="Candidates by job opening"
                />
              </ChartCard>
            ) : null}
            {summary.trend?.length > 1 ? (
              <ChartCard title="Activity over the period" description="Stage events recorded for this slice." className="chart-card--inset chart-card--wide">
                <TrendChart data={summary.trend} series={trendSeries} height={200} ariaLabel="Activity over the period for this slice" />
              </ChartCard>
            ) : null}
          </div>

          <div className="crm-drilldown__toolbar">
            <SearchField value={search} onChange={setSearch} placeholder="Search these candidates" />
            <label className="crm-filter">
              <span className="sr-only">Sort</span>
              <select aria-label="Sort candidates" value={sort} onChange={(event) => setSort(event.target.value)}>
                {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <p className="muted crm-drilldown__count">{formatCount(rows.length)} shown of {formatCount(summary.total)}</p>
          </div>

          {rows.length ? (
            <div className="crm-drilldown__table">
              <DataTable
                rows={rows}
                columns={columns}
                actions={(row) => <button type="button" className="crm-drilldown-open" onClick={() => onSelectCandidate(row._id)} aria-label={`Open the full record for ${row.name}`}>Open<ArrowRight size={14} aria-hidden="true" /></button>}
              />
              <Pagination page={data.page} pages={data.pages} onChange={setPage} />
            </div>
          ) : <EmptyState title="No candidates here" description={search ? "No candidate on this page matches your search." : "Nothing matched this figure for the selected period and filters."} />}
        </div>
      ) : null}
    </Modal>
  );
}
