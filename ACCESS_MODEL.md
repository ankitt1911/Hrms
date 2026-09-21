# Two-role access and workflow

## Identities

`SUPER_ADMIN` is the single active installation owner. It is never linked to an Employee record and has unrestricted administrative access.

`RECRUITER` is always linked one-to-one to an active Employee record. Disabling recruiter access or terminating that employee increments the account token version and revokes all live sessions immediately.

An ordinary employee has no `Employee.userId`. Employee work email is stored in `Employee.workEmail`; this does not imply login access.

## Access

The owner administers employees, attendance, leave decisions, payroll and payslips, vendors, jobs, placements and invoices, all candidates, documents, reports, audit, monitoring, and settings.

Recruiters can use only personal attendance, leave, payslips, owner-shared documents, assigned jobs, their owned candidates, messages, notifications, and recruiter dashboard. That dashboard is the same CRM dashboard the owner sees on the CRM monitor tab, scoped server-side to their own candidates on assigned jobs; peer performance and placement revenue are omitted from their payload. Both server endpoints and direct frontend URLs enforce the fixed role.

## Recruitment workflow

1. The owner creates an active employee and optionally supplies `recruiterAccount.temporaryPassword`, or enables access later through `PATCH /employees/:id/recruiter-access`.
2. The owner creates a job and replaces its assignment list through `PATCH /job-openings/:id/recruiters`.
3. A recruiter can create a candidate only for an assigned active job. Ownership is always taken from the authenticated recruiter; ownership fields submitted by a recruiter are rejected.
4. On-hold or closed jobs reject new candidates but keep the existing pipeline visible to still-assigned recruiters.
5. Removing a recruiter from the assignment list immediately removes access to that job and its candidates. The candidate’s historical recruiter ID is retained.
6. Only the owner can reassign or clear candidate ownership. A non-null target must be an active recruiter currently assigned to the candidate’s job.

There are no dynamic roles, permission keys, per-company role catalogues, or legacy role compatibility paths.
