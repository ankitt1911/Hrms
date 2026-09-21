import { useCallback, useEffect, useState } from "react";
import { Download, Eye } from "lucide-react";
import * as api from "../../Services/apiCalling/placementApis";
import { transitionResult } from "../custom/apiBridge";
import { Button, ErrorState, Modal, Money, Skeleton } from "../custom/ui";
import { ComponentColumn, componentPayload, componentTotal } from "../workspaces/SalaryBreakdown";

const editableRows = (rows = []) => rows.map((row) => ({ label: row.label, amount: String(row.amount) }));
const dateText = (value) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// Mirrors PayslipView: loaded fresh every time it opens, PDF only ever
// produced on request, nothing is stored until "Save invoice" is pressed.
export default function InvoiceModal({ placementId, open, onClose, onSaved }) {
  const [draft, setDraft] = useState();
  const [lineItems, setLineItems] = useState([]);
  const [ackEarly, setAckEarly] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!placementId) return;
    setDraft(); setError(""); setAckEarly(false);
    try {
      const data = await api.handleGetInvoiceDraft(placementId);
      setDraft(data);
      setLineItems(editableRows(data.lineItems));
    } catch (requestError) { setError(requestError.message); }
  }, [placementId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const total = componentTotal(lineItems);
  const items = componentPayload(lineItems);
  const canSubmit = items.length > 0 && total > 0 && (!draft?.isEarly || ackEarly);

  const preview = async () => {
    setPreviewing(true); setError("");
    try { await api.handlePreviewInvoice(placementId, { lineItems: items }); } catch (requestError) { setError(requestError.message); } finally { setPreviewing(false); }
  };
  const download = async () => {
    setDownloading(true); setError("");
    try { await api.handleDownloadInvoice(placementId); } catch (requestError) { setError(requestError.message); } finally { setDownloading(false); }
  };
  const save = async () => {
    setSaving(true); setError("");
    try {
      transitionResult(await api.handleSaveInvoice(placementId, { lineItems: items }));
      onClose(); await onSaved?.();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };

  const footer = <>
    <Button variant="secondary" onClick={onClose}>Cancel</Button>
    {draft?.saved && <Button variant="quiet" icon={Download} loading={downloading} onClick={download}>Download PDF</Button>}
    <Button variant="secondary" icon={Eye} loading={previewing} disabled={!items.length} onClick={preview}>Preview PDF</Button>
    <Button loading={saving} disabled={!draft || !canSubmit} onClick={save}>{draft?.saved ? "Save changes" : "Confirm & generate"}</Button>
  </>;

  return <Modal className="modal--invoice" open={open} onClose={onClose} title="Placement invoice"
    description={draft ? `${draft.invoiceNumber} · Issued ${dateText(draft.issueDate)}${draft.dueDate ? ` · Due ${dateText(draft.dueDate)}` : ""}` : "Loading the invoice."} footer={footer}>
    {error ? <ErrorState message={error} onRetry={load} /> : !draft ? <Skeleton rows={6} /> : <div className="invoice-editor">
      <div className="invoice-editor__meta">
        {[["Candidate", draft.candidateName], ["Role", draft.jobTitle], ["Bill to", draft.clientName]]
          .map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}
      </div>
      {draft.isEarly && <div className="invoice-editor__early-notice">
        <p>This placement's invoice is not due until <b>{dateText(draft.dueDate)}</b>. You can still generate it now.</p>
        <label><input type="checkbox" checked={ackEarly} onChange={(event) => setAckEarly(event.target.checked)} /> I confirm this invoice is being generated early.</label>
      </div>}
      <div className="invoice-editor__items">
        <ComponentColumn title="Line items" rows={lineItems} total={total} totalLabel="Total" onChange={setLineItems} />
      </div>
      <div className="invoice-editor__total">Total due: <b><Money value={total} /></b></div>
    </div>}
  </Modal>;
}
