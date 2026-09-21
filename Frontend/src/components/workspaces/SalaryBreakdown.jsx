import { Plus, X } from "lucide-react";
import { Money } from "../custom/ui";

export const DEFAULT_EARNINGS = [{ label: "Basic", amount: "" }, { label: "HRA", amount: "" }, { label: "Special Allowance", amount: "" }];
export const DEFAULT_DEDUCTIONS = [{ label: "Professional Tax", amount: "" }];
export const componentTotal = (rows = []) => rows.reduce((total, row) => total + (Number(row.amount) || 0), 0);
// Rows the admin left blank are dropped rather than sent as zero.
export const componentPayload = (rows = []) => rows.filter((row) => String(row.label).trim() && String(row.amount).trim() !== "").map((row) => ({ label: String(row.label).trim(), amount: String(Number(row.amount).toFixed(2)) }));

// Exported so a single-column editor (e.g. invoice line items) can reuse the
// same add/edit/remove row markup and CSS instead of duplicating it.
export function ComponentColumn({ title, rows, total, totalLabel, onChange }) {
  const update = (index, key) => (event) => onChange(rows.map((row, position) => (position === index ? { ...row, [key]: event.target.value } : row)));
  const remove = (index) => () => onChange(rows.filter((_row, position) => position !== index));
  return <div className="salary-components__column">
    <header><strong>{title}</strong><button type="button" className="salary-components__add" onClick={() => onChange([...rows, { label: "", amount: "" }])}><Plus size={13} />Add</button></header>
    {rows.length ? rows.map((row, index) => <div className="salary-components__row" key={index}>
      <input className="control" aria-label={`${title} name ${index + 1}`} value={row.label} placeholder="Component name" onChange={update(index, "label")} />
      <input className="control" aria-label={`${title} amount ${index + 1}`} type="number" min="0" step="0.01" value={row.amount} placeholder="0" onChange={update(index, "amount")} />
      <button type="button" className="salary-components__remove" aria-label={`Remove ${row.label || `row ${index + 1}`}`} onClick={remove(index)}><X size={15} /></button>
    </div>) : <p className="salary-components__empty">No {title.toLowerCase()} added yet.</p>}
    <footer>{totalLabel}: <b><Money value={total} /></b></footer>
  </div>;
}

export default function SalaryBreakdown({ earnings = [], deductions = [], onChange }) {
  const gross = componentTotal(earnings);
  const deducted = componentTotal(deductions);
  return <div className="salary-components">
    <div className="salary-components__grid">
      <ComponentColumn title="Earnings" rows={earnings} total={gross} totalLabel="Gross" onChange={(rows) => onChange({ earnings: rows, deductions })} />
      <ComponentColumn title="Deductions" rows={deductions} total={deducted} totalLabel="Total" onChange={(rows) => onChange({ earnings, deductions: rows })} />
    </div>
    <p className="salary-components__net">Net pay for a full month: <b><Money value={Math.max(gross - deducted, 0)} /></b></p>
  </div>;
}
