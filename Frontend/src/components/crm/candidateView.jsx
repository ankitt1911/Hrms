import { BriefcaseBusiness, CalendarDays, GraduationCap, Languages, Mail, MapPin, Phone, UsersRound } from "lucide-react";
import { DateText } from "../custom/ui";

/*
 * Presentation helpers shared by the candidate bucket workspace and the CRM
 * monitor's drill-down, so the two can never drift apart on what a field is
 * called or how a stage-history event is labelled.
 */
export const candidateName = (candidate) => candidate?.name || "Candidate";
export const recruiterName = (candidate) => { const recruiter = candidate?.recruiterEmployeeId; return recruiter ? [recruiter.firstName, recruiter.lastName].filter(Boolean).join(" ") || recruiter.workEmail : "Unassigned"; };
export const jobCompany = (job) => job?.vendorId?.name || job?.companyName || "Company not specified";
export const interviewHistoryLabel = (item) => item.eventType === "INTERVIEW_RESCHEDULED" ? "Interview rescheduled" : item.eventType === "INTERVIEW_CANCELLED" ? "Interview cancelled" : String(item.toStage).replaceAll("_", " ");

export const candidateDetailRows = (candidate) => [
  [Mail, "Email", candidate?.contact?.email],
  [Phone, "Phone", candidate?.contact?.phone],
  [BriefcaseBusiness, "Candidate type", candidate?.candidateType?.replaceAll("_", " ")],
  [GraduationCap, "Qualification", candidate?.qualification],
  [Languages, "Languages", (candidate?.languages || []).map((value) => value === "OTHER" ? (candidate.otherLanguage || "Other") : value.replaceAll("_", " ").toLowerCase()).join(", ")],
  [MapPin, "Location", candidate?.location],
  [UsersRound, "Recruiter", recruiterName(candidate)],
  [CalendarDays, "Submitted", candidate?.createdAt ? <DateText value={candidate.createdAt} withTime /> : null],
  [CalendarDays, "Expected joining", candidate?.expectedDoj ? <DateText value={candidate.expectedDoj} /> : null],
  [CalendarDays, "Actual joining", candidate?.actualDoj ? <DateText value={candidate.actualDoj} withTime /> : null],
];
