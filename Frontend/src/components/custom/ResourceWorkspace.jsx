import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, X } from "lucide-react";
import { callFirst, transitionResult, unwrapCollection } from "./apiBridge";
import { Button, DataTable, EmptyState, ErrorState, Field, Modal, PageHeading, Pagination, SearchField, Skeleton } from "./ui";

const initialValues = (fields = []) => Object.fromEntries(fields.filter((field) => field.name).map((field) => [field.name, field.initial ?? (field.type === "checkbox" ? false : "")]));

/*
 * `urlFilterKeys` lets a page be deep-linked: any of those query params present in
 * the URL is passed straight through to the read call and shown as a removable
 * chip. The static `query` prop stays the base, so a caller that pins a filter
 * (JobsWorkspace pinning status=ACTIVE) still wins over the URL.
 */
export default function ResourceWorkspace({ api, title, description, meta, read, create, createLabel = "Add record", createModalClassName = "", className = "", fields = [], columns, query = {}, urlFilterKeys = [], emptyTitle, emptyDescription, rowActions, transformPayload, secondary }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(() => initialValues(fields));
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [justAddedId, setJustAddedId] = useState(null);
  const urlFilters = useMemo(() => Object.fromEntries(urlFilterKeys.map((key) => [key, searchParams.get(key) || ""]).filter(([, value]) => value)), [searchParams, urlFilterKeys]);
  const effectiveQuery = useMemo(() => ({ ...urlFilters, ...(query || {}) }), [query, urlFilters]);
  const clearUrlFilter = (key) => setSearchParams((current) => { const next = new URLSearchParams(current); next.delete(key); return next; }, { replace: true });

  const readKey = (read || []).join("\u0000");
  const queryKey = JSON.stringify(effectiveQuery);
  const requestSignature = `${readKey}\u0001${queryKey}`;
  const requestRef = useRef({ read, query: effectiveQuery, signature: requestSignature });
  requestRef.current = { read, query: effectiveQuery, signature: requestSignature };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const request = requestRef.current;
      if (request.signature !== requestSignature) return;
      const data = await callFirst(api, request.read, { ...request.query, page, limit: 20, ...(search ? { search } : {}) });
      const normalized = unwrapCollection(data);
      setRecords(normalized.items); setPageMeta(normalized);
    } catch (requestError) { setError(requestError?.message || "The records could not be loaded."); }
    finally { setLoading(false); }
  }, [api, requestSignature, page, search]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [queryKey]);

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setFormError("");
    try {
      const clean = transformPayload ? transformPayload(form) : Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ""));
      const result = transitionResult(await callFirst(api, create, clean));
      setJustAddedId(result?._id); setModal(false); setForm(initialValues(fields)); await load();
    } catch (requestError) { setFormError(requestError?.message || "The record could not be saved."); }
    finally { setSaving(false); }
  };

  const visibleRecords = useMemo(() => search && !pageMeta.total ? records.filter((record) => JSON.stringify(record).toLowerCase().includes(search.toLowerCase())) : records, [records, search, pageMeta.total]);
  return <main className={`page-content ${className}`}><PageHeading title={title} description={description} meta={meta} actions={<>{secondary}{create?.length > 0 && <Button icon={Plus} onClick={() => setModal(true)}>{createLabel}</Button>}</>} />
    <section className="surface"><div className="toolbar"><SearchField value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={`Search ${title.toLowerCase()}`} /><div className="toolbar-spacer" />{Object.entries(urlFilters).map(([key, value]) => <button type="button" className="crm-monitor-chip" key={key} onClick={() => clearUrlFilter(key)} aria-label={`Remove the ${key} filter`}><small>{key}</small><b>{String(value).replaceAll("_", " ")}</b><X size={12} aria-hidden="true" /></button>)}<Button variant="quiet" icon={RefreshCw} onClick={load}>Refresh</Button></div>
      {loading ? <div className="inside-loader"><Skeleton rows={6} /></div> : error ? <ErrorState message={error} onRetry={load} /> : visibleRecords.length ? <><DataTable columns={columns} rows={visibleRecords} actions={rowActions ? (row) => rowActions(row, { reload: load }) : undefined} justAddedId={justAddedId} /><Pagination page={pageMeta.page ?? page} pages={pageMeta.pages ?? 1} onChange={setPage} /></> : <EmptyState title={emptyTitle || `No ${title.toLowerCase()} yet`} description={emptyDescription} action={create?.length > 0 ? <Button icon={Plus} onClick={() => setModal(true)}>{createLabel}</Button> : null} />}
    </section>
    <Modal className={createModalClassName} open={modal} onClose={() => setModal(false)} title={createLabel} description={`Add the details below. Required fields are marked.`} footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button type="submit" form="resource-form" loading={saving}>Save record</Button></>}><form id="resource-form" onSubmit={submit} className="form-grid">{fields.filter((field) => !field.showWhen || field.showWhen(form)).map((field) => field.type === "section" ? <div className="form-section-title span-2" key={field.label}><strong>{field.label}</strong>{field.helper&&<small>{field.helper}</small>}</div> : field.type === "custom" ? <div className={field.span === 2 ? "span-2" : ""} key={field.name}>{field.render(form, setForm)}</div> : field.type === "checkbox" ? <label className="check-field span-2" key={field.name}><input type="checkbox" checked={form[field.name]} onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.checked }))} /><span><strong>{field.label}</strong>{field.helper && <small>{field.helper}</small>}</span></label> : <Field key={field.name} label={field.label} helper={field.helper} className={field.span === 2 ? "span-2" : ""}>{field.type === "select" ? <select value={form[field.name]} required={field.required} onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))}><option value="">Select {field.label.toLowerCase()}</option>{field.options?.map((option) => <option key={typeof option === "string" ? option : option.value} value={typeof option === "string" ? option : option.value}>{typeof option === "string" ? option.replaceAll("_", " ") : option.label}</option>)}</select> : field.type === "textarea" ? <textarea value={form[field.name]} required={field.required} placeholder={field.placeholder} onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))} /> : <input className="control" type={field.type || "text"} inputMode={field.inputMode} autoComplete={field.autoComplete} step={field.step} min={field.min} max={field.max} maxLength={field.maxLength} value={form[field.name]} required={field.required} placeholder={field.placeholder} onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))} />}</Field>)}{formError && <div className="auth-error span-2" role="alert">{formError}</div>}<button type="submit" hidden /></form></Modal>
  </main>;
}
