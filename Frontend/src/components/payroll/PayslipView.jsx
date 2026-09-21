import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import * as payroll from "../../Services/apiCalling/payrollApis";
import * as payslips from "../../Services/apiCalling/payslipApis";
import { transitionResult } from "../custom/apiBridge";
import { Button, ErrorState, Field, Modal, Money, Skeleton, StatusBadge } from "../custom/ui";
import SalaryBreakdown, { componentPayload, componentTotal } from "../workspaces/SalaryBreakdown";

const fullName = (employee) => [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || "Employee";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const periodLabel = (period) => (period ? `${MONTHS[Number(period.periodMonth) - 1] || period.periodMonth} ${period.periodYear}` : "—");
const editableRows = (rows = []) => rows.map((row) => ({ label: row.label, amount: String(row.amount) }));
const amount = (value) => Number(value || 0).toFixed(2);
// Seed the editor with exactly what the payslip shows. A line with no configured
// rows still displays a derived Basic / Allowances split and a deduction total,
// so those become editable rows rather than an empty form.
const seedDraft = (line) => ({
  earnings: line.earnings?.length ? editableRows(line.earnings) : [{ label: "Basic", amount: amount(line.basicPay) }, { label: "Allowances", amount: amount(line.allowances) }],
  deductions: line.deductionItems?.length ? editableRows(line.deductionItems) : (Number(line.deductions) - Number(line.extraDeductions || 0) > 0 ? [{ label: "Deduction", amount: amount(Number(line.deductions) - Number(line.extraDeductions || 0)) }] : []),
  workedHours: amount(line.workedHours),
});

// Rendered from the payroll line every time it is opened; the PDF is only ever
// produced when the viewer asks to download one. In approve mode the owner can
// correct the figures first, which rewrites the payroll line behind it.
export default function PayslipView({ payslipId, open, mode = "view", onClose, onApproved }) {
  const [view, setView] = useState();
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState();
  const [baseline, setBaseline] = useState("");
  const approving = mode === "approve";
  const load = useCallback(async () => {
    if (!payslipId) return;
    setView(); setDraft(); setError("");
    try {
      const data = await payslips.handleGetPayslip(payslipId);
      setView(data);
      const seeded = seedDraft(data.line || {});
      setBaseline(JSON.stringify(seeded));
      setDraft({ ...seeded, reason: "" });
    } catch (requestError) { setError(requestError.message); }
  }, [payslipId]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const download = async () => {
    setDownloading(true);
    try { await payslips.handleDownloadPayslip(payslipId); } catch (requestError) { setError(requestError.message); } finally { setDownloading(false); }
  };
  const approve = async () => {
    setSaving(true); setError("");
    try {
      // Only touch the payroll line when the owner actually changed something.
      if (dirty) transitionResult(await payroll.handleUpdatePayrollLineBreakdown(view.line._id, { earnings: componentPayload(draft.earnings), deductionItems: componentPayload(draft.deductions), workedHours: draft.workedHours, reason: draft.reason.trim() }));
      transitionResult(await payslips.handleApprovePayslip(payslipId));
      onClose(); await onApproved?.();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };
  const line = view?.line;
  const dirty = Boolean(draft) && JSON.stringify({ earnings: draft.earnings, deductions: draft.deductions, workedHours: draft.workedHours }) !== baseline;
  const earnings = line?.earnings?.length ? line.earnings : line ? [{ label: "Basic", amount: line.basicPay }, { label: "Allowances", amount: line.allowances }] : [];
  const deductions = line?.deductionItems?.length ? [...line.deductionItems] : [];
  if (line && Number(line.extraDeductions)) deductions.push({ label: "Adjustment", amount: line.extraDeductions });
  const footer = approving
    ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!view || (dirty && !draft?.reason.trim())} onClick={approve}>{dirty ? "Save changes & approve" : "Approve payslip"}</Button></>
    : <><Button variant="secondary" onClick={onClose}>Close</Button><Button icon={Download} loading={downloading} disabled={!view} onClick={download}>Download PDF</Button></>;
  return <Modal className="modal--payslip" open={open} onClose={onClose} title={approving ? "Review and approve payslip" : "Payslip"}
    description={view ? `${fullName(view.employee)} · ${periodLabel(view.period)}${approving ? " · Corrections here update the payroll line too." : ""}` : "Loading the payslip."} footer={footer}>
    {error ? <ErrorState message={error} onRetry={load} /> : !view ? <Skeleton rows={6} /> : <article className="payslip-sheet">
      <header className="payslip-sheet__head">
        <div><strong>{view.company?.name}</strong><small>Payslip for {periodLabel(view.period)}</small></div>
        <StatusBadge value={view.payslip?.status} />
      </header>
      <div className="payslip-sheet__meta">
        {[["Employee", fullName(view.employee)], ["Employee code", view.employee?.employeeCode], ["Designation", view.employee?.designation], ["Department", view.employee?.department], ["Salary type", view.employee?.salaryType?.replaceAll("_", " ")], ...(approving ? [] : [["Worked hours", Number(line.workedHours || 0).toFixed(2)]])]
          .map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}
      </div>
      {(line.itJoinings || line.nonItJoinings) ? <p className="payslip-sheet__note">Paid on {line.itJoinings} IT and {line.nonItJoinings} non-IT candidate joinings this period.</p> : null}
      {approving ? <div className="payslip-sheet__edit">
        <Field label="Worked hours" helper="Hours recorded on the payslip for this period.">
          <input className="control" type="number" min="0" step="0.01" value={draft.workedHours} onChange={(event) => setDraft({ ...draft, workedHours: event.target.value })} />
        </Field>
        <SalaryBreakdown earnings={draft.earnings} deductions={draft.deductions} onChange={(value) => setDraft({ ...draft, earnings: value.earnings, deductions: value.deductions })} />
        <p className="payslip-sheet__note">These rows are the final amounts for this payslip. The month was already pro-rated when the period was calculated, so what you enter here is what gets paid.</p>
        <Field label="Reason for the change" error={dirty && !draft.reason.trim() ? "A reason is required before approving an edited payslip." : ""} helper="Stored on the payroll line's audit trail.">
          <textarea value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder="e.g. Corrected HRA for the month" />
        </Field>
        <div className="payslip-sheet__preview"><span>Estimated net pay after your changes</span><strong><Money value={Math.max(componentTotal(draft.earnings) - componentTotal(draft.deductions), 0)} /></strong></div>
      </div> : <>
        <div className="payslip-sheet__columns">
          {[["Earnings", earnings, line.grossPay, "Gross"], ["Deductions", deductions, line.deductions, "Total"]].map(([title, rows, total, totalLabel]) => <section key={title}>
            <h4>{title}</h4>
            {rows.length ? rows.map((row, index) => <div className="payslip-sheet__row" key={`${row.label}-${index}`}><span>{row.label}</span><b><Money value={row.amount} /></b></div>) : <div className="payslip-sheet__row"><span>None</span><b>—</b></div>}
            <div className="payslip-sheet__row payslip-sheet__row--total"><span>{totalLabel}</span><b><Money value={total} /></b></div>
          </section>)}
        </div>
        <footer className="payslip-sheet__net"><span>Net pay</span><strong><Money value={line.netPay} /></strong></footer>
      </>}
    </article>}
  </Modal>;
}
