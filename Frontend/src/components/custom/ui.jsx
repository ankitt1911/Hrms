import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Inbox, LoaderCircle, Search, X } from "lucide-react";
import usePrefersReducedMotion from "../../motion/usePrefersReducedMotion";
import { modalSpring, rowSettle } from "../../motion/variants";

export function Button({ variant = "primary", loading, success, icon: Icon, children, className = "", ...props }) {
  return (
    <button className={`button button--${variant} ${className}`} aria-busy={loading || undefined} disabled={loading || props.disabled} {...props}>
      {loading ? <LoaderCircle className="spin" size={16} /> : success ? <Check size={16} /> : Icon ? <Icon size={16} /> : null}
      <span>{success ? "Done" : children}</span>
    </button>
  );
}

export function Field({ label, error, helper, as = "input", children, className = "", ...props }) {
  const Tag = as;
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {children ?? <Tag className={`control ${error ? "control--error" : ""}`} {...props} />}
      {error ? <span className="field__error">{error}</span> : helper ? <span className="field__helper">{helper}</span> : null}
    </label>
  );
}

const toneFor = (value = "") => {
  const v = String(value).toUpperCase();
  if (["ACTIVE", "APPROVED", "PUBLISHED", "CLEAN", "WORKING", "JOINED", "SELECTED", "RAISED", "COMPLETED", "PAID"].includes(v)) return "success";
  if (["PENDING", "ON_BREAK", "UNDER_REVIEW", "READY_TO_RAISE", "DUE", "INTERVIEW_SCHEDULED", "ON_HOLD"].includes(v)) return "warning";
  if (["REJECTED", "NOT_INTERESTED", "CANCELLED", "INACTIVE", "FAILED", "LOCKED", "WITHDRAWN"].includes(v)) return "danger";
  if (["GENERATED", "CALCULATED", "NEW_LEAD", "CALLED", "INTERESTED", "SHORTLISTED"].includes(v)) return "info";
  return "neutral";
};

export function StatusBadge(input) {
  const value = input && typeof input === "object" && "value" in input ? input.value : input;
  if (!value) return <span className="muted">—</span>;
  return <span className={`badge badge--${toneFor(value)}`}><i />{String(value).replaceAll("_", " ").toLowerCase()}</span>;
}

export function Money(input, currencyOverride) {
  const value = input && typeof input === "object" && "value" in input ? input.value : input;
  const currency = input && typeof input === "object" && input.currency ? input.currency : currencyOverride || "INR";
  if (value == null || value === "") return <span>—</span>;
  let formatted = String(value);
  try { formatted = new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(value)); } catch { /* display raw */ }
  return <span className="money">{formatted}</span>;
}

export function DateText(input) {
  const value = input && typeof input === "object" && "value" in input ? input.value : input;
  const withTime = Boolean(input && typeof input === "object" && input.withTime);
  if (!value) return <span>—</span>;
  const date = new Date(value);
  return <time className="tabular" dateTime={value}>{Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date)}</time>;
}

export function SearchField({ value, onChange, placeholder = "Search records" }) {
  return <div className="search-field"><Search size={17} /><input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

export function EmptyState({ title = "Nothing here yet", description = "New records will appear here as soon as they are available.", action }) {
  return <div className="empty-state"><span className="empty-state__icon"><Inbox size={28} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function ErrorState({ message = "We couldn’t load this section.", onRetry }) {
  return <div className="error-state" role="alert"><AlertCircle size={20} /><div><strong>Something went wrong</strong><p>{message}</p></div>{onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}</div>;
}

export function Skeleton({ rows = 5 }) {
  return <div className="skeleton-list" role="status" aria-label="Loading content">{Array.from({ length: rows }, (_, i) => <div className="skeleton-row" aria-hidden="true" key={i}><i /><i /><i /></div>)}</div>;
}

export function Modal({ open, title, description, onClose, children, footer, className = "" }) {
  const reduced = usePrefersReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = dialogRef.current?.querySelector("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
      if (event.key !== "Tab") return;
      const nodes = [...(dialogRef.current?.querySelectorAll("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])") || [])].filter((node) => !node.disabled);
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener("keydown", onKeyDown); previous?.focus?.(); };
  }, [open]);
  return <AnimatePresence>{open && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}><motion.section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} {...modalSpring(reduced)}><header><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></header><div className="modal__body">{children}</div>{footer && <footer>{footer}</footer>}</motion.section></motion.div>}</AnimatePresence>;
}

export function Pagination({ page = 1, pages = 1, onChange }) {
  if (pages <= 1) return null;
  return <nav className="pagination" aria-label="Pagination"><Button variant="quiet" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><span>Page <b>{page}</b> of {pages}</span><Button variant="quiet" icon={ChevronRight} disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button></nav>;
}

export function DataTable({ columns, rows, rowKey = "_id", actions, justAddedId }) {
  const reduced = usePrefersReducedMotion();
  return <div className="data-table-wrap"><table className="data-table"><thead><tr>{columns.map((c) => <th key={c.key} className={c.align ? `align-${c.align}` : ""}>{c.label}</th>)}{actions && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{rows.map((row, index) => <motion.tr key={row[rowKey] ?? index} {...(row[rowKey] === justAddedId ? rowSettle(reduced) : {})}>{columns.map((c) => <td key={c.key} data-label={c.label} className={c.align ? `align-${c.align}` : ""}>{c.render ? c.render(row[c.key], row) : row[c.key] ?? "—"}</td>)}{actions && <td data-label="Actions" className="row-actions">{actions(row)}</td>}</motion.tr>)}</tbody></table></div>;
}

export function PageHeading({ title, description, actions, meta }) {
  return <header className="page-heading"><div><div className="page-heading__meta">{meta}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-heading__actions">{actions}</div>}</header>;
}

export function SegmentedTabs({ tabs, active, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((tab) => <button type="button" key={tab.value} className={active === tab.value ? "active" : ""} onClick={() => onChange(tab.value)} role="tab" aria-selected={active === tab.value}>{tab.label}</button>)}</div>;
}
