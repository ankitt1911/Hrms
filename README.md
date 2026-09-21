# Smart HRMS

Smart HRMS is a single-company application with exactly two authenticated roles: one non-employee `SUPER_ADMIN` owner and any number of employee `RECRUITER` accounts. Other employees are HR records and cannot sign in.

## Local setup

Requirements: Node.js 22+ and MongoDB.

1. Copy `Backend /.env.example` to `Backend /.env` and set secrets, MongoDB, and the owner bootstrap variables.
2. In `Backend `, run `npm install`, `npm run db:indexes`, `npm run seed:admin`, and `npm run dev`.
3. In `Frontend `, run `npm install` and `npm run dev`.

The API base path is `/api/v1`.

When upgrading an existing database for the admin dashboard, run `npm run db:migrate:dashboard` in `Backend ` and then `npm run db:indexes`. The migration assigns legacy candidate stage events to the candidate's current recruiter where attribution is available; new events preserve their historical recruiter automatically.

## Verification

- Backend: `npm run lint && npm run build && npm test`
- Frontend: `npm run lint && npm run build && npm test`
- Demo data for a clean database: `npm run seed:demo` in `Backend `.

See [API.md](API.md) for the contract and [ACCESS_MODEL.md](ACCESS_MODEL.md) for authorization and workflow rules.
