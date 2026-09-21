import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CircleSlash, RefreshCcw } from "lucide-react";
import * as api from "../../../Services/apiCalling/crmApis";
import { Button, DateText, ErrorState, Modal, Skeleton, StatusBadge } from "../../custom/ui";
import { candidateDetailRows, candidateName, interviewHistoryLabel, jobCompany } from "../candidateView";
import { stageColor } from "../../../constants/chart.constants";

const BUCKET_ROUTE = { SHORTLISTED: "/crm/shortlisted", INTERVIEW_SCHEDULED: "/crm/interview-scheduled", SELECTED: "/crm/selected", REJECTED: "/crm/rejected", JOINED: "/crm/joined" };

const elapsed = (from, to) => {
  if (!from || !to) return null;
  const days = Math.round((new Date(to) - new Date(from)) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return "same day";
  return days === 1 ? "1 day later" : `${days} days later`;
};

const EVENT_ICON = { INTERVIEW_RESCHEDULED: RefreshCcw, INTERVIEW_CANCELLED: CircleSlash };

/*
 * Level 3 of the drill-down. Reuses the candidate endpoints and the detail-row
 * and history helpers from Crm.jsx so this view and the bucket workspace can
 * never drift apart in what they call a field or how they label an event.
 */
export default function CandidateDetailModal({ candidateId, open, onClose }) {
  const [candidate, setCandidate] = useState();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!candidateId) return;
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    try {
      const next = await api.handleGetCrmCandidate(candidateId);
      if (requestId === requestRef.current) setCandidate(next);
    } catch (requestError) {
      if (requestId === requestRef.current) setError(requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { if (open) { setCandidate(undefined); load(); } }, [load, open]);

  const history = [...(candidate?.stageHistory || [])].reverse();
  const bucket = BUCKET_ROUTE[candidate?.stage] || "/crm/submissions";

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="modal--crm-candidate"
      title={candidate ? candidateName(candidate) : "Candidate record"}
      description={candidate ? `${candidate.jobOpeningId?.title || "Job unavailable"} · ${jobCompany(candidate.jobOpeningId)}` : "Loading the full candidate record."}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Link className="button button--primary" to={bucket} onClick={onClose}>Open in workspace</Link></>}
    >
      {error ? <ErrorState message={error} onRetry={load} /> : loading && !candidate ? <Skeleton rows={6} /> : candidate ? (
        <div className="crm-candidate-detail">
          <div className="crm-candidate-detail__status">
            <StatusBadge value={candidate.stage} />
            {candidate.stage === "INTERVIEW_SCHEDULED" && candidate.interviewDate ? <span className="muted"><CalendarDays size={14} aria-hidden="true" /> Interview <DateText value={candidate.interviewDate} withTime /></span> : null}
          </div>

          <section className="crm-candidate-detail__section">
            <h3>Candidate details</h3>
            <div className="candidate-detail-grid">
              {candidateDetailRows(candidate).map(([Icon, label, value]) => (
                <div key={label}><span className="candidate-detail-icon"><Icon size={17} /></span><span><small>{label}</small><strong>{value || "—"}</strong></span></div>
              ))}
            </div>
            {candidate.remarks ? <div className="candidate-remarks"><small>Remarks</small><p>{candidate.remarks}</p></div> : null}
          </section>

          <section className="crm-candidate-detail__section">
            <h3>Stage history</h3>
            {history.length ? (
              <ol className="crm-timeline">
                {history.map((item, index) => {
                  const EventIcon = EVENT_ICON[item.eventType];
                  const previous = history[index + 1];
                  const gap = previous ? elapsed(previous.changedAt, item.changedAt) : null;
                  return (
                    <li key={item._id || `${item.toStage}-${item.changedAt}`}>
                      <i style={{ background: stageColor(item.toStage) }} aria-hidden="true">{EventIcon ? <EventIcon size={11} /> : null}</i>
                      <div>
                        <strong>{interviewHistoryLabel(item)}</strong>
                        {item.interviewDate ? <small>Interview: <DateText value={item.interviewDate} withTime /></small> : null}
                        <small>{item.changedBy?.displayName || "Team member"} · <DateText value={item.changedAt} withTime /></small>
                        {gap ? <small className="crm-timeline__gap">{gap}</small> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="muted">No stage history has been recorded for this candidate.</p>}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
