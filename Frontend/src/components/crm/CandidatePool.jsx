import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { PencilLine, RefreshCw, Send, UserMinus, UserPlus, UsersRound } from "lucide-react";
import * as api from "../../Services/apiCalling/crmApis";
import * as jobsApi from "../../Services/apiCalling/vendorJobApis";
import * as employeesApi from "../../Services/apiCalling/employeeApis";
import { CANDIDATE_LANGUAGES, CANDIDATE_PROFILE_STATUSES, JOB_TYPES } from "../../constants/enums.constants";
import { ROLES } from "../../constants/roles.constants";
import { transitionResult, unwrapCollection } from "../custom/apiBridge";
import { Button, DataTable, EmptyState, ErrorState, Field, Modal, PageHeading, Pagination, SearchField, Skeleton, StatusBadge } from "../custom/ui";

const blankProfile = { name: "", phone: "", email: "", candidateType: "NON_IT", qualification: "", languages: [], otherLanguage: "", location: "", source: "", experienceYears: "", remarks: "" };
const trimmedOrNull = (value) => (String(value ?? "").trim() ? String(value).trim() : null);
const recruiterLabel = (recruiter) => recruiter?.displayName || [recruiter?.firstName, recruiter?.lastName].filter(Boolean).join(" ").trim() || recruiter?.workEmail || "—";
const jobLabel = (job) => (job ? `${job.title}${job.companyName ? ` · ${job.companyName}` : ""}` : "—");

function profilePayload(form) {
  const email = trimmedOrNull(form.email);
  return {
    name: form.name.trim(),
    contact: { phone: form.phone.trim(), ...(email ? { email } : {}) },
    candidateType: form.candidateType,
    languages: form.languages,
    qualification: trimmedOrNull(form.qualification),
    otherLanguage: form.languages.includes("OTHER") ? trimmedOrNull(form.otherLanguage) : null,
    location: trimmedOrNull(form.location),
    source: trimmedOrNull(form.source),
    experienceYears: String(form.experienceYears).trim() === "" ? null : Number(form.experienceYears),
    remarks: trimmedOrNull(form.remarks),
  };
}

function useCandidateProfiles(query) {
  const [rows, setRows] = useState();
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState("");
  const signature = JSON.stringify(query);
  const load = useCallback(async () => {
    try {
      const data = unwrapCollection(await api.handleGetCrmCandidateProfiles(JSON.parse(signature)));
      setRows(data.items); setMeta(data); setError("");
    } catch (requestError) { setError(requestError.message); }
  }, [signature]);
  useEffect(() => { load(); }, [load]);
  return { rows, meta, error, load };
}

function CandidateProfileModal({ open, profile, onClose, onSaved }) {
  const [form, setForm] = useState(blankProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(profile);
  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(profile ? {
      ...blankProfile, name: profile.name || "", phone: profile.contact?.phone || "", email: profile.contact?.email || "",
      candidateType: profile.candidateType || "NON_IT", qualification: profile.qualification || "", languages: profile.languages || [],
      otherLanguage: profile.otherLanguage || "", location: profile.location || "", source: profile.source || "",
      experienceYears: profile.experienceYears ?? "", remarks: profile.remarks || "",
    } : blankProfile);
  }, [open, profile]);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggleLanguage = (language) => setForm((current) => ({ ...current, languages: current.languages.includes(language) ? current.languages.filter((item) => item !== language) : [...current.languages, language] }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.languages.length) { setError("Select at least one language the candidate speaks."); return; }
    setSaving(true); setError("");
    try {
      const payload = profilePayload(form);
      transitionResult(editing ? await api.handleUpdateCrmCandidateProfile(profile._id, payload) : await api.handleCreateCrmCandidateProfile(payload));
      onClose(); await onSaved();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };
  return <Modal className="modal--employee" open={open} onClose={onClose} title={editing ? "Edit candidate" : "Add candidate"} description="Candidate details are stored in the pool until you assign them to a recruiter." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="candidate-profile-form" loading={saving}>{editing ? "Save changes" : "Add candidate"}</Button></>}>
    <form id="candidate-profile-form" className="form-grid" onSubmit={submit}>
      <Field label="Full name" value={form.name} onChange={update("name")} required maxLength={200} placeholder="e.g. Darshan Kumar" />
      <Field label="Phone number" value={form.phone} onChange={update("phone")} required minLength={7} maxLength={30} inputMode="tel" placeholder="e.g. +91 98765 43210" />
      <Field label="Email (optional)" type="email" value={form.email} onChange={update("email")} placeholder="name@example.com" />
      <Field label="Candidate type"><select className="control" value={form.candidateType} onChange={update("candidateType")}>{JOB_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></Field>
      <Field label="Qualification" value={form.qualification} onChange={update("qualification")} maxLength={500} placeholder="e.g. B.Com" />
      <Field label="Experience (years)" type="number" min="0" max="60" step="0.5" value={form.experienceYears} onChange={update("experienceYears")} placeholder="e.g. 2" />
      <Field label="Location" value={form.location} onChange={update("location")} maxLength={200} placeholder="e.g. Bangalore" />
      <Field label="Source" value={form.source} onChange={update("source")} maxLength={200} placeholder="e.g. Naukri, Referral" />
      <Field className="span-2" label="Languages spoken">
        <div className="language-options">{CANDIDATE_LANGUAGES.map((language) => <label className="language-option" key={language}><input type="checkbox" checked={form.languages.includes(language)} onChange={() => toggleLanguage(language)} /><span>{language.replaceAll("_", " ")}</span></label>)}</div>
      </Field>
      {form.languages.includes("OTHER") && <Field className="span-2" label="Other language" value={form.otherLanguage} onChange={update("otherLanguage")} maxLength={100} placeholder="Name the additional language" />}
      <Field className="span-2" label="Remarks" as="textarea" rows={3} value={form.remarks} onChange={update("remarks")} maxLength={5000} placeholder="Anything the recruiter should know" />
      {error && <div className="auth-error span-2" role="alert">{error}</div>}
      <button type="submit" hidden />
    </form>
  </Modal>;
}

export function CandidatePoolWorkspace() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [assignment, setAssignment] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [recruiters, setRecruiters] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editProfile, setEditProfile] = useState();
  const [assignDialog, setAssignDialog] = useState();
  const [assignRecruiter, setAssignRecruiter] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const query = useMemo(() => ({ page, limit: 20, ...(search ? { search } : {}), ...(status ? { status } : {}), ...(assignment ? { assignment } : {}) }), [page, search, status, assignment]);
  const { rows, meta, error, load } = useCandidateProfiles(query);
  useEffect(() => { setPage(1); }, [search, status, assignment]);
  useEffect(() => { setSelectedIds([]); }, [query]);
  useEffect(() => {
    let active = true;
    employeesApi.handleGetEmployees({ page: 1, limit: 100, status: "ACTIVE" })
      .then((data) => { if (active) setRecruiters(unwrapCollection(data).items.filter((employee) => employee.userId?.role === ROLES.RECRUITER && employee.userId?.status === "ACTIVE")); })
      .catch((requestError) => { if (active) setActionError(requestError.message); });
    return () => { active = false; };
  }, []);
  const allRows = rows || [];
  const allSelected = allRows.length > 0 && selectedIds.length === allRows.length;
  const toggleRow = (id) => setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const toggleAll = () => setSelectedIds(allSelected ? [] : allRows.map((row) => String(row._id)));
  const openAssign = (ids, current = "") => { setAssignRecruiter(current); setActionError(""); setAssignDialog({ ids, mode: "ASSIGN" }); };
  const openUnassign = (ids) => { setActionError(""); setAssignDialog({ ids, mode: "UNASSIGN" }); };
  const unassigning = assignDialog?.mode === "UNASSIGN";
  const assign = async () => {
    setSaving(true); setActionError("");
    try {
      transitionResult(await api.handleAssignCrmCandidateProfiles({ candidateProfileIds: assignDialog.ids, recruiterEmployeeId: unassigning ? null : assignRecruiter || null }));
      setAssignDialog(); setSelectedIds([]); await load();
    } catch (requestError) { setActionError(requestError.message); } finally { setSaving(false); }
  };
  const columns = [
    { key: "_id", label: <input type="checkbox" aria-label="Select all candidates" checked={allSelected} disabled={!allRows.length} onChange={toggleAll} />, render: (value, row) => <input type="checkbox" aria-label={`Select ${row.name}`} checked={selectedIds.includes(String(value))} onChange={() => toggleRow(String(value))} /> },
    { key: "name", label: "Candidate", render: (value, row) => <span className="candidate-cell"><strong>{value}</strong><small>{row.contact?.phone}{row.contact?.email ? ` · ${row.contact.email}` : ""}</small></span> },
    { key: "candidateType", label: "Type", render: StatusBadge },
    { key: "location", label: "Location" },
    { key: "assignedRecruiterId", label: "Recruiter", render: (value) => (value ? recruiterLabel(value) : "Unassigned") },
    { key: "activeSubmissionId", label: "Submitted to", render: (value) => (value?.jobOpeningId ? jobLabel(value.jobOpeningId) : "—") },
    { key: "status", label: "Status", render: StatusBadge },
  ];
  return <main className="page-content candidate-pool">
    <PageHeading meta="Recruitment CRM" title="Candidates" description="Build the candidate pool, hand candidates to a recruiter, and follow their status as submissions progress." actions={<Button icon={UserPlus} onClick={() => { setEditProfile(); setCreateOpen(true); }}>Add candidate</Button>} />
    {(error || actionError) && <ErrorState message={error || actionError} onRetry={load} />}
    <section className="surface">
      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Search name, phone, email, or location" />
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{CANDIDATE_PROFILE_STATUSES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
        <select aria-label="Filter by assignment" value={assignment} onChange={(event) => setAssignment(event.target.value)}><option value="">Assigned and unassigned</option><option value="UNASSIGNED">Unassigned only</option><option value="ASSIGNED">Assigned only</option></select>
        <span className="toolbar-spacer" />
        <Button variant="quiet" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>
      {selectedIds.length > 0 && <div className="bulk-bar"><strong>{selectedIds.length} candidate{selectedIds.length === 1 ? "" : "s"} selected</strong><Button variant="quiet" onClick={() => setSelectedIds([])}>Clear</Button><Button variant="secondary" icon={UserMinus} onClick={() => openUnassign(selectedIds)}>Unassign</Button><Button icon={UsersRound} onClick={() => openAssign(selectedIds)}>Assign to recruiter</Button></div>}
      {!rows ? <Skeleton rows={6} /> : rows.length
        ? <><DataTable rows={rows} columns={columns} actions={(row) => <div className="inline-actions candidate-row-actions">
          <Button variant="quiet" icon={UsersRound} onClick={() => openAssign([String(row._id)], String(row.assignedRecruiterId?._id || ""))}>{row.assignedRecruiterId ? "Reassign" : "Assign"}</Button>
          {row.assignedRecruiterId && <Button variant="quiet" icon={UserMinus} onClick={() => openUnassign([String(row._id)])}>Unassign</Button>}
          <Button variant="quiet" icon={PencilLine} onClick={() => { setEditProfile(row); setCreateOpen(true); }}>Edit</Button>
        </div>} /><Pagination page={meta.page || page} pages={meta.pages || 1} onChange={setPage} /></>
        : <EmptyState title="No candidates yet" description="Add a candidate to the pool, then assign them to a recruiter for submission." />}
    </section>
    <CandidateProfileModal open={createOpen} profile={editProfile} onClose={() => { setCreateOpen(false); setEditProfile(); }} onSaved={load} />
    <Modal open={Boolean(assignDialog)} onClose={() => setAssignDialog()} title={unassigning ? "Unassign candidates" : "Assign candidates to a recruiter"}
      description={unassigning
        ? `${assignDialog?.ids.length} candidate${assignDialog?.ids.length === 1 ? "" : "s"} will return to the unassigned pool. Anyone already submitted to a job stays in that pipeline with no owner until you reassign them.`
        : `${assignDialog?.ids.length} candidate${assignDialog?.ids.length === 1 ? "" : "s"} will move to the chosen recruiter. A candidate already submitted to a job moves with their submission, so the recruiter must be assigned to that job opening.`}
      footer={<><Button variant="secondary" onClick={() => setAssignDialog()}>Cancel</Button><Button variant={unassigning ? "danger" : "primary"} loading={saving} onClick={assign}>{unassigning ? "Unassign candidates" : "Save assignment"}</Button></>}>
      {actionError && <div className="auth-error" role="alert">{actionError}</div>}
      {unassigning ? null : recruiters.length
        ? <Field label="Recruiter"><select className="control" value={assignRecruiter} onChange={(event) => setAssignRecruiter(event.target.value)}><option value="">Unassigned</option>{recruiters.map((recruiter) => <option key={recruiter._id} value={recruiter._id}>{recruiterLabel(recruiter)}</option>)}</select></Field>
        : <EmptyState title="No active recruiters" description="Enable recruiter access on an active employee first." />}
    </Modal>
  </main>;
}

export function AssignedCandidatesWorkspace() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState([]);
  const [submitProfile, setSubmitProfile] = useState();
  const [jobId, setJobId] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const query = useMemo(() => ({ page, limit: 20, ...(search ? { search } : {}) }), [page, search]);
  const { rows, meta, error, load } = useCandidateProfiles(query);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => {
    let active = true;
    jobsApi.handleGetJobOpenings({ page: 1, limit: 100, status: "ACTIVE" })
      .then((data) => { if (active) setJobs(unwrapCollection(data).items); })
      .catch((requestError) => { if (active) setActionError(requestError.message); });
    return () => { active = false; };
  }, []);
  const openSubmit = (row) => { setJobId(""); setActionError(""); setSubmitProfile(row); };
  const submit = async () => {
    if (!jobId) return;
    setSaving(true); setActionError("");
    try {
      transitionResult(await api.handleSubmitCrmCandidateProfile(submitProfile._id, { jobOpeningId: jobId }));
      setSubmitProfile(); await load();
    } catch (requestError) { setActionError(requestError.message); } finally { setSaving(false); }
  };
  const columns = [
    { key: "name", label: "Candidate", render: (value, row) => <span className="candidate-cell"><strong>{value}</strong><small>{row.contact?.phone}{row.contact?.email ? ` · ${row.contact.email}` : ""}</small></span> },
    { key: "candidateType", label: "Type", render: StatusBadge },
    { key: "qualification", label: "Qualification" },
    { key: "location", label: "Location" },
    { key: "activeSubmissionId", label: "Submitted to", render: (value) => (value?.jobOpeningId ? jobLabel(value.jobOpeningId) : "—") },
    { key: "status", label: "Status", render: StatusBadge },
  ];
  return <main className="page-content candidate-pool">
    <PageHeading meta="Recruitment" title="My candidates" description="Candidates assigned to you by the admin. Submit one against any job opening assigned to you." />
    {(error || actionError) && <ErrorState message={error || actionError} onRetry={load} />}
    <section className="surface">
      <div className="toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search name, phone, email, or location" /><span className="toolbar-spacer" /><Button variant="quiet" icon={RefreshCw} onClick={load}>Refresh</Button></div>
      {!rows ? <Skeleton rows={6} /> : rows.length
        ? <><DataTable rows={rows} columns={columns} actions={(row) => <div className="inline-actions candidate-row-actions"><Button variant="quiet" icon={Send} disabled={Boolean(row.activeSubmissionId)} title={row.activeSubmissionId ? "Already submitted to a job opening" : undefined} onClick={() => openSubmit(row)}>Submit to job</Button></div>} /><Pagination page={meta.page || page} pages={meta.pages || 1} onChange={setPage} /></>
        : <EmptyState title="No candidates assigned" description="Candidates appear here as soon as the admin assigns them to you." />}
    </section>
    <Modal open={Boolean(submitProfile)} onClose={() => setSubmitProfile()} title="Submit candidate" description={`Choose the job opening to submit ${submitProfile?.name || "this candidate"} against. They enter the pipeline as a new lead.`} footer={<><Button variant="secondary" onClick={() => setSubmitProfile()}>Cancel</Button><Button loading={saving} disabled={!jobId} onClick={submit}>Submit candidate</Button></>}>
      {jobs.length
        ? <Field label="Job opening"><select className="control" value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Select a job opening</option>{jobs.map((job) => <option key={job._id} value={job._id}>{jobLabel(job)}</option>)}</select></Field>
        : <EmptyState title="No active jobs assigned" description="You need an active assigned job opening before submitting a candidate." />}
    </Modal>
  </main>;
}
