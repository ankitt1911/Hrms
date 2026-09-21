import { useState } from "react";
import { DataTable, DateText, EmptyState, SegmentedTabs } from "../../custom/ui";
import { initialsOf } from "./constants";

const TABS = [
  { value: "joiners", label: "Joined", empty: "Nobody joined in this period", dimension: "JOINERS" },
  { value: "leavers", label: "Left", empty: "Nobody left in this period", dimension: "LEAVERS" },
  { value: "anniversaries", label: "Anniversaries", empty: "No anniversaries coming up", dimension: "ANNIVERSARIES" },
];

const nameCell = (value, row) => (
  <span className="overview-person"><i aria-hidden="true">{initialsOf(value)}</i><b>{value}</b>{row.employeeCode ? <small>{row.employeeCode}</small> : null}</span>
);

const COLUMNS = {
  joiners: [
    { key: "employeeName", label: "Employee", render: nameCell },
    { key: "department", label: "Department" },
    { key: "designation", label: "Designation" },
    { key: "joiningDate", label: "Joined", render: (value) => <DateText value={value} /> },
  ],
  leavers: [
    { key: "employeeName", label: "Employee", render: nameCell },
    { key: "department", label: "Department" },
    { key: "terminationDate", label: "Left", render: (value) => <DateText value={value} /> },
    { key: "tenureDays", label: "Tenure (days)", align: "right" },
  ],
  anniversaries: [
    { key: "employeeName", label: "Employee", render: nameCell },
    { key: "department", label: "Department" },
    { key: "years", label: "Years", align: "right" },
    { key: "onDate", label: "On", render: (value) => <DateText value={value} /> },
  ],
};

const DESCRIPTIONS = {
  joiners: "People who started in this period.",
  leavers: "People whose employment ended in this period.",
  // Only work anniversaries: the employee record has a joining date but no date of birth.
  anniversaries: "Work anniversaries falling in the next 30 days, whatever period is selected.",
};

export default function MovementCard({ movement, onDrill }) {
  const [tab, setTab] = useState("joiners");
  const rows = movement?.[tab] || [];
  const active = TABS.find((item) => item.value === tab);

  return (
    <section className="surface dashboard-section overview-movement">
      <header>
        <div><h2>Joiners, leavers and milestones</h2><p>{DESCRIPTIONS[tab]}</p></div>
        <div className="chart-card__actions">
          <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} />
          {rows.length ? <button type="button" className="crm-drilldown-button overview-see-more" onClick={() => onDrill(active.dimension, "", active.label)}>See all</button> : null}
        </div>
      </header>
      {rows.length
        ? <DataTable rows={rows} rowKey="employeeId" columns={COLUMNS[tab]} />
        : <EmptyState title={active.empty} description={DESCRIPTIONS[tab]} />}
    </section>
  );
}
