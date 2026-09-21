import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BadgeIndianRupee, CalendarDays, ChevronDown, FileClock, FileText, Percent, UserCheck, UserPlus, UsersRound } from "lucide-react";
import * as api from "../../Services/apiCalling/crmApis";
import { BarChart, ChartCard, DonutChart, FunnelChart, TrendChart } from "../custom/charts";
import { Button, DataTable, DateText, EmptyState, ErrorState, Field, Modal, Money, PageHeading, SegmentedTabs, Skeleton, StatusBadge } from "../custom/ui";
import { CATEGORICAL, STAGE_RAMP, STATUS_LOST, STATUS_PAUSED, categoricalColor, formatCount, formatMoney, formatPercent, stageColor, stageLabel } from "../../constants/chart.constants";
import usePrefersReducedMotion from "../../motion/usePrefersReducedMotion";
import { listReveal } from "../../motion/variants";
import MonitorFilterBar from "./monitor/MonitorFilterBar";
import KpiTile from "../custom/KpiTile";
import DrilldownModal from "./monitor/DrilldownModal";
import CandidateDetailModal from "./monitor/CandidateDetailModal";

const FILTER_KEYS = ["preset", "startDate", "endDate", "employeeId", "jobOpeningId", "vendorId", "candidateType", "source", "location", "granularity"];
const DEFAULT_FILTERS = { preset: "month", startDate: "", endDate: "", employeeId: "", jobOpeningId: "", vendorId: "", candidateType: "", source: "", location: "", granularity: "" };

const FEATURED_STAGES = ["NEW_LEAD", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "JOINED", "REJECTED"];
const ALL_STAGES = ["NEW_LEAD", "CALLED", "RNR", "INTERESTED", "NOT_INTERESTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "JOINED", "ON_HOLD"];
const PAUSED_STAGES = ["RNR", "ON_HOLD"];
const LOST_STAGES = ["NOT_INTERESTED", "REJECTED"];
const MIX_TABS = [
  { value: "byJob", label: "Job opening", dimension: "JOB" }, { value: "byVendor", label: "Client", dimension: "VENDOR" },
  { value: "byCandidateType", label: "Candidate type", dimension: "CANDIDATE_TYPE" }, { value: "bySource", label: "Source", dimension: "SOURCE" },
  { value: "byLocation", label: "Location", dimension: "LOCATION" }, { value: "byLanguage", label: "Language", dimension: "LANGUAGE" },
];

const dateText = (value) => (value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)) : "—");
const bucketTick = (value) => (typeof value === "string" && value.length === 10 ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)) : value);

/*
 * Shared by the owner's CRM monitor tab and the recruiter's Overview. The server
 * decides what a viewer may see: a recruiter's payload is scoped to their own
 * candidates on assigned jobs and simply omits the peer leaderboard and the
 * placement revenue, so this component renders whatever it is given rather than
 * hiding privileged data client-side.
 */
export default function CrmMonitorDashboard({ title, meta, description }) {
  const reduced = usePrefersReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftRange, setDraftRange] = useState({ startDate: "", endDate: "" });
  const [hiddenSeries, setHiddenSeries] = useState([]);
  const [stagesExpanded, setStagesExpanded] = useState(false);
  const [mixTab, setMixTab] = useState("byJob");
  const [leaderboardSort, setLeaderboardSort] = useState("total");
  const [drilldown, setDrilldown] = useState(null);
  const [candidateId, setCandidateId] = useState(null);
  const requestRef = useRef(0);

  // The filter set lives in the URL, so a filtered view is shareable and
  // survives a refresh, and every drill-down inherits exactly what is on screen.
  const filters = useMemo(() => {
    const next = { ...DEFAULT_FILTERS };
    for (const key of FILTER_KEYS) { const value = searchParams.get(key); if (value) next[key] = value; }
    return next;
  }, [searchParams]);

  const setFilters = useCallback((patch) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const queryParams = useMemo(() => {
    const params = { preset: filters.preset };
    if (filters.preset === "custom") { params.startDate = filters.startDate; params.endDate = filters.endDate; }
    for (const key of ["employeeId", "jobOpeningId", "vendorId", "candidateType", "source", "location"]) if (filters[key]) params[key] = filters[key];
    return params;
  }, [filters]);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    try {
      const next = await api.handleGetCrmAnalytics({ ...queryParams, ...(filters.granularity ? { granularity: filters.granularity } : {}) });
      if (requestId === requestRef.current) setData(next);
    } catch (requestError) {
      if (requestId === requestRef.current) setError(requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [filters.granularity, queryParams]);

  useEffect(() => { load(); }, [load]);

  const openDrilldown = useCallback((dimension, value, label) => setDrilldown({ dimension, value: value == null ? "" : String(value), label, params: queryParams }), [queryParams]);
  const toggleSeries = (key) => setHiddenSeries((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  const rangeError = draftRange.startDate && draftRange.endDate && draftRange.startDate > draftRange.endDate ? "The end date must be on or after the start date." : "";
  const applyCustom = () => { if (!draftRange.startDate || !draftRange.endDate || rangeError) return; setFilters({ preset: "custom", ...draftRange }); setCustomOpen(false); };
  const openCustomRange = () => { setDraftRange({ startDate: filters.startDate, endDate: filters.endDate }); setCustomOpen(true); };

  const range = data?.range;
  const rangeLabel = range ? `${dateText(range.startDate)} – ${dateText(range.endDate)} · ${range.timezone}` : "Selected period";
  const timeseries = data?.timeseries || [];
  const sparkFor = (key) => timeseries.map((bucket) => ({ value: bucket[key] || 0 }));

  const trendSeries = FEATURED_STAGES.map((stage) => ({ key: stage, label: stageLabel(stage), color: stageColor(stage) })).filter((series) => timeseries.some((bucket) => bucket[series.key] != null));

  // Eleven raw slices would exceed what any categorical palette can separate, so
  // the two pause stages and the two loss stages fold into one slice each — and
  // each still drills down to the individual stages behind it.
  const pipelineDonut = useMemo(() => {
    const snapshot = Object.fromEntries((data?.pipelineSnapshot || []).map((row) => [row.stage, row.count]));
    const main = ["NEW_LEAD", "CALLED", "INTERESTED", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "JOINED"]
      .map((stage) => ({ key: stage, label: stageLabel(stage), value: snapshot[stage] || 0, color: stageColor(stage), dimension: "PIPELINE_STAGE" }));
    const sum = (stages) => stages.reduce((total, stage) => total + (snapshot[stage] || 0), 0);
    return [...main,
      { key: "RNR", label: "Paused (RNR, on hold)", value: sum(PAUSED_STAGES), color: STATUS_PAUSED, dimension: "PIPELINE_STAGE" },
      { key: "REJECTED", label: "Lost (rejected, not interested)", value: sum(LOST_STAGES), color: STATUS_LOST, dimension: "PIPELINE_STAGE" },
    ].filter((slice) => slice.value > 0);
  }, [data?.pipelineSnapshot]);

  const leaderboard = useMemo(() => {
    const rows = data?.leaderboard || [];
    const by = { total: (a, b) => b.total - a.total, joined: (a, b) => (b.counts?.JOINED || 0) - (a.counts?.JOINED || 0), conversion: (a, b) => b.conversionRate - a.conversionRate };
    return [...rows].sort(by[leaderboardSort]).slice(0, 12);
  }, [data?.leaderboard, leaderboardSort]);

  const leaderboardSeries = FEATURED_STAGES.map((stage) => ({ key: stage, label: stageLabel(stage), color: stageColor(stage) }));
  const leaderboardData = leaderboard.map((row) => ({ label: row.name, employeeId: String(row.employeeId), ...Object.fromEntries(FEATURED_STAGES.map((stage) => [stage, row.counts?.[stage] || 0])) }));

  const mix = MIX_TABS.find((tab) => tab.value === mixTab);
  const mixRows = (data?.breakdowns?.[mixTab] || []).slice(0, 8).map((row, index) => ({ ...row, value: row.count, color: categoricalColor(index) }));

  const owner = data ? data.viewer?.owner !== false : true;
  const revenueRows = (data?.revenue?.byInvoiceState || []).filter((row) => row.count > 0).map((row) => ({ key: row.state, label: row.state.replaceAll("_", " ").toLowerCase(), count: row.count, amount: row.amount, color: STAGE_RAMP[3] }));
  const stageCards = (stagesExpanded ? ALL_STAGES : FEATURED_STAGES);

  const kpis = data?.kpis;
  const comparisonLabel = data?.comparisonRange ? `vs ${dateText(data.comparisonRange.startDate)} – ${dateText(data.comparisonRange.endDate)}` : "vs previous period";

  return (
    <main className="page-content crm-monitor-page">
      <PageHeading
        meta={meta || "Business management overview"}
        title={title || "CRM monitor"}
        description={data ? `${data.scope?.name || "All recruiters"} · ${rangeLabel}` : (description || "Recruitment pipeline, conversion and revenue at a glance.")}
      />

      <MonitorFilterBar
        filters={filters}
        filterOptions={data?.filterOptions}
        onChange={setFilters}
        onClear={() => setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])))}
        onOpenCustomRange={openCustomRange}
        rangeLabel={rangeLabel}
        granularity={filters.granularity || data?.granularity || "day"}
        onGranularityChange={(value) => setFilters({ granularity: value })}
        owner={owner}
        busy={loading && !data}
      />

      {error ? <ErrorState message={error} onRetry={load} /> : loading && !data ? <Skeleton rows={8} /> : data ? (
        <>
          <motion.div className="crm-kpi-grid" variants={listReveal(reduced)} initial="hidden" animate="show">
            <KpiTile label="Submissions" metric={kpis.submissions} tone={1} icon={UserPlus} spark={sparkFor("NEW_LEAD")} sparkColor={stageColor("NEW_LEAD")} comparisonLabel={comparisonLabel} reduced={reduced} onClick={() => openDrilldown("STAGE", "NEW_LEAD", "Submissions")} />
            <KpiTile label="Interviews scheduled" metric={kpis.interviews} tone={2} icon={CalendarDays} spark={sparkFor("INTERVIEW_SCHEDULED")} sparkColor={stageColor("INTERVIEW_SCHEDULED")} comparisonLabel={comparisonLabel} reduced={reduced} onClick={() => openDrilldown("STAGE", "INTERVIEW_SCHEDULED", "Interviews scheduled")} />
            <KpiTile label="Selected" metric={kpis.selected} tone={3} icon={UserCheck} spark={sparkFor("SELECTED")} sparkColor={stageColor("SELECTED")} comparisonLabel={comparisonLabel} reduced={reduced} onClick={() => openDrilldown("STAGE", "SELECTED", "Selected")} />
            <KpiTile label="Joined" metric={kpis.joined} tone={4} icon={UsersRound} spark={sparkFor("JOINED")} sparkColor={stageColor("JOINED")} comparisonLabel={comparisonLabel} reduced={reduced} onClick={() => openDrilldown("STAGE", "JOINED", "Joined")} />
            <KpiTile label="Submission to join rate" metric={kpis.conversionRate} tone={5} icon={Percent} spark={sparkFor("JOINED")} sparkColor={stageColor("JOINED")} comparisonLabel={comparisonLabel} reduced={reduced} />
            {kpis.placementRevenue
              ? <KpiTile label="Placement revenue" metric={kpis.placementRevenue} tone={6} icon={BadgeIndianRupee} spark={sparkFor("JOINED")} sparkColor={stageColor("JOINED")} comparisonLabel="in this period" reduced={reduced} onClick={() => openDrilldown("PIPELINE_STAGE", "JOINED", "Joined candidates")} />
              : <KpiTile label="Active pipeline" metric={kpis.activePipeline} tone={6} icon={UsersRound} spark={sparkFor("SHORTLISTED")} sparkColor={stageColor("SHORTLISTED")} comparisonLabel="candidates still open" reduced={reduced} onClick={() => openDrilldown("ALL", "", "My active pipeline")} />}
          </motion.div>

          {kpis.paidInvoices ? (
            <motion.div className="crm-kpi-grid crm-kpi-grid--invoices" variants={listReveal(reduced)} initial="hidden" animate="show">
              <KpiTile label="Due for invoicing" metric={kpis.dueForInvoicing} tone={7} icon={FileClock} positive={false} comparisonLabel="outstanding across portfolio" reduced={reduced} onClick={() => openDrilldown("INVOICE_STATE", "DUE", "Due for invoicing")} />
              <KpiTile label="Invoiced (pipeline)" metric={kpis.invoicedPipeline} tone={8} icon={FileText} comparisonLabel="invoiced, not yet paid" reduced={reduced} onClick={() => openDrilldown("INVOICE_STATE", "GENERATED,READY_TO_RAISE,RAISED", "Invoiced, awaiting payment")} />
              <KpiTile label="Paid" metric={kpis.paidInvoices} tone={9} icon={BadgeIndianRupee} comparisonLabel="settled across portfolio" reduced={reduced} onClick={() => openDrilldown("INVOICE_STATE", "PAID", "Paid invoices")} />
            </motion.div>
          ) : null}

          <ChartCard
            title="Activity trend"
            description={`Stage events per ${data.granularity} across ${rangeLabel.toLowerCase()}. Select a legend key to hide a series.`}
            empty={!timeseries.some((bucket) => bucket.total > 0)}
            emptyDescription="No stage activity was recorded in this period."
          >
            <TrendChart
              data={timeseries} series={trendSeries} hidden={hiddenSeries} onToggleSeries={toggleSeries}
              xTickFormat={bucketTick} height={320} brush
              ariaLabel={`Recruitment stage events per ${data.granularity} for ${rangeLabel}`}
            />
          </ChartCard>

          <div className="crm-monitor-chart-row">
            <ChartCard
              title="Conversion funnel"
              description="Of the candidates submitted in this period, how many got at least this far. Select a step to see who is in it."
              empty={!data.funnel?.some((step) => step.count > 0)}
              emptyDescription="No candidate reached a pipeline stage in this period."
            >
              <FunnelChart steps={data.funnel} onStepClick={(step) => openDrilldown("STAGE", step.stage, `Moved to ${stageLabel(step.stage).toLowerCase()}`)} ariaLabel="Conversion funnel from submission to joined" />
            </ChartCard>

            <ChartCard
              title="Live pipeline"
              description="Where every candidate stands today, regardless of period."
              empty={!pipelineDonut.length}
              emptyDescription="There are no candidates in the pipeline yet."
              footer={<p className="muted">Paused and lost group two stages each — select a slice to see the split.</p>}
            >
              <DonutChart
                data={pipelineDonut}
                centerLabel="Candidates"
                centerValue={formatCount(pipelineDonut.reduce((total, slice) => total + slice.value, 0))}
                onSliceClick={(slice) => slice && openDrilldown("PIPELINE_STAGE", slice.key, slice.label)}
                ariaLabel="Current pipeline distribution by stage"
              />
            </ChartCard>
          </div>

          {owner ? (
            <ChartCard
              title="Recruiter performance"
              description="Stage events attributed to each recruiter in this period. Select a bar to see the candidates behind it."
              empty={!leaderboard.length}
              emptyDescription="No recruiter activity was attributed in this period."
              actions={(
                <label className="crm-filter">
                  <span className="sr-only">Sort recruiters</span>
                  <select aria-label="Sort recruiters" value={leaderboardSort} onChange={(event) => setLeaderboardSort(event.target.value)}>
                    <option value="total">Sort by total activity</option><option value="joined">Sort by joins</option><option value="conversion">Sort by conversion rate</option>
                  </select>
                </label>
              )}
              footer={(
                <DataTable
                  rows={leaderboard} rowKey="employeeId"
                  columns={[
                    { key: "name", label: "Recruiter", render: (value, row) => <span className="crm-leaderboard-name"><i style={{ background: stageColor("SELECTED") }} aria-hidden="true" /><b>{value}</b>{row.status === "FORMER" ? <small>Former</small> : null}</span> },
                    ...FEATURED_STAGES.map((stage) => ({ key: stage, label: stageLabel(stage), align: "right", render: (value, row) => formatCount(row.counts?.[stage] || 0) })),
                    { key: "total", label: "Total events", align: "right", render: formatCount },
                    { key: "conversionRate", label: "Conversion", align: "right", render: (value) => formatPercent(value) },
                  ]}
                />
              )}
            >
              <BarChart
                data={leaderboardData} series={leaderboardSeries} stacked layout="vertical"
                height={Math.max(220, leaderboardData.length * 42 + 60)}
                hidden={hiddenSeries} onToggleSeries={toggleSeries}
                onBarClick={(row, key) => row && openDrilldown("STAGE", key, `${stageLabel(key)} · ${row.label}`)}
                ariaLabel="Stage events per recruiter"
              />
            </ChartCard>
          ) : null}

          <ChartCard
            title="Portfolio mix"
            description="How this period's candidates split across the business. Select a bar or slice to drill in."
            empty={!mixRows.length}
            emptyDescription="No candidates matched this breakdown in the selected period."
            actions={<SegmentedTabs tabs={MIX_TABS} active={mixTab} onChange={setMixTab} />}
          >
            <div className="crm-monitor-mix">
              <BarChart
                data={mixRows} series={[{ key: "count", label: "Candidates" }]} layout="vertical"
                height={Math.max(200, mixRows.length * 36 + 50)}
                onBarClick={(row) => row && openDrilldown(mix.dimension, row.key, row.label)}
                ariaLabel={`Candidates by ${mix.label.toLowerCase()}`}
              />
              <DonutChart
                data={mixRows} height={260} centerLabel="Candidates"
                onSliceClick={(slice) => slice && openDrilldown(mix.dimension, slice.key, slice.label)}
                ariaLabel={`Share of candidates by ${mix.label.toLowerCase()}`}
              />
            </div>
          </ChartCard>

          {owner ? (
            <ChartCard
              title="Revenue and invoices"
              description={`${formatMoney(data.revenue.periodRevenue)} from ${formatCount(data.revenue.periodPlacements)} placement${data.revenue.periodPlacements === 1 ? "" : "s"} joining in this period · ${formatMoney(data.revenue.totalInvoiced)} across the whole portfolio.`}
              empty={!revenueRows.length}
              emptyDescription="No placements have been recorded yet."
              footer={data.revenue.upcomingDue?.length ? (
                <DataTable
                  rows={data.revenue.upcomingDue}
                  columns={[
                    { key: "candidateName", label: "Candidate" }, { key: "jobTitle", label: "Job" }, { key: "client", label: "Client" },
                    { key: "actualDoj", label: "Joined", render: (value) => <DateText value={value} /> },
                    { key: "invoiceDueDate", label: "Invoice due", render: (value) => <DateText value={value} /> },
                    { key: "invoiceState", label: "State", render: (value) => <StatusBadge value={value} /> },
                    { key: "invoiceAmount", label: "Amount", align: "right", render: (value) => <Money value={value} /> },
                  ]}
                />
              ) : <p className="muted">No invoices are currently approaching their due date.</p>}
            >
              <BarChart
                data={revenueRows} series={[{ key: "count", label: "Placements" }]} layout="vertical"
                height={Math.max(180, revenueRows.length * 36 + 50)}
                onBarClick={(row) => row && openDrilldown("INVOICE_STATE", row.key, `Invoices ${row.label}`)}
                ariaLabel="Placements by invoice state"
              />
            </ChartCard>
          ) : null}

          <section className="surface dashboard-section chart-card">
            <header>
              <div><h2>Stage counters</h2><p>Today against {rangeLabel.toLowerCase()}. Select a counter to see the records behind it.</p></div>
              <button type="button" className="crm-drilldown-button" aria-expanded={stagesExpanded} aria-controls="crm-monitor-stage-cards" title={stagesExpanded ? "Show fewer stages" : "Show all stages"} onClick={() => setStagesExpanded((current) => !current)}><ChevronDown size={17} /></button>
            </header>
            <div className="chart-card__body">
              <div className="crm-monitor-stage-grid" id="crm-monitor-stage-cards">
                {stageCards.map((stage) => (
                  <button type="button" className="crm-monitor-stage-card" key={stage} onClick={() => openDrilldown("STAGE", stage, `Moved to ${stageLabel(stage).toLowerCase()}`)} aria-label={`${stageLabel(stage)}: ${formatCount(data.stageCounts.period[stage])} this period, ${formatCount(data.stageCounts.today[stage])} today. Show the records.`}>
                    <i style={{ background: stageColor(stage) }} aria-hidden="true" />
                    <span>{stageLabel(stage)}</span>
                    <strong className="tabular">{formatCount(data.stageCounts.period[stage])}</strong>
                    <small className="tabular">{formatCount(data.stageCounts.today[stage])} today</small>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : <EmptyState title="Nothing to show" description="The dashboard returned no data for this period." />}

      <Modal
        open={customOpen} onClose={() => setCustomOpen(false)}
        title="Custom date range" description="Choose an inclusive reporting period."
        footer={<><Button variant="secondary" onClick={() => setCustomOpen(false)}>Cancel</Button><Button disabled={!draftRange.startDate || !draftRange.endDate || Boolean(rangeError)} onClick={applyCustom}>Apply range</Button></>}
      >
        <div className="form-stack">
          <Field label="From date"><input className="control" type="date" required value={draftRange.startDate} onChange={(event) => setDraftRange((current) => ({ ...current, startDate: event.target.value }))} /></Field>
          <Field label="To date" error={rangeError}><input className={`control ${rangeError ? "control--error" : ""}`} type="date" required min={draftRange.startDate || undefined} value={draftRange.endDate} onChange={(event) => setDraftRange((current) => ({ ...current, endDate: event.target.value }))} /></Field>
        </div>
      </Modal>

      {/* Levels 2 and 3 are siblings, not nested: while the candidate modal is
          open the drill-down ignores its own close so Escape unwinds one step. */}
      <DrilldownModal
        open={Boolean(drilldown)} request={drilldown}
        onClose={() => { if (!candidateId) setDrilldown(null); }}
        onSelectCandidate={setCandidateId}
      />
      <CandidateDetailModal open={Boolean(candidateId)} candidateId={candidateId} onClose={() => setCandidateId(null)} />
    </main>
  );
}
