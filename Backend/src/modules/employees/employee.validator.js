const { z } = require('zod');
const { objectId } = require('../../common/utils/objectId');
const { password } = require('../auth/auth.validator');

const money = z.union([z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().nonnegative()]).transform(String);
const salaryComponent = z.object({ label: z.string().trim().min(1).max(100), amount: money }).strict();
const salaryComponents = z.object({
  earnings: z.array(salaryComponent).max(20).optional(),
  deductions: z.array(salaryComponent).max(20).optional(),
}).strict();
const employeeFields = {
  employeeCode: z.string().trim().min(1).max(50), workEmail: z.email(),
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).nullable().optional(), qualification: z.string().trim().max(500).nullable().optional(), designation: z.string().trim().max(150).nullable().optional(), department: z.string().trim().max(150).nullable().optional(),
  managerId: objectId.nullable().optional(), joiningDate: z.iso.date(), salaryType: z.enum(['HOURLY', 'SALARIED', 'PER_JOINING']),
  hourlyRate: money.nullable().optional(), monthlyCtc: money.nullable().optional(), takeHomeSalary: money.nullable().optional(),
  itJoiningRate: money.nullable().optional(), nonItJoiningRate: money.nullable().optional(), salaryComponents: salaryComponents.optional(),
};
const bank = z.object({ accountHolder: z.string().trim().max(200).nullable().optional(), bankName: z.string().trim().max(150).nullable().optional(), accountNumber: z.string().trim().min(4).max(50).nullable().optional(), ifscOrRouting: z.string().trim().max(50).nullable().optional(), pan: z.string().trim().max(30).nullable().optional(), aadhaar: z.string().trim().max(30).nullable().optional() }).strict();
const create = z.object({ body: z.object({ ...employeeFields, recruiterAccount: z.object({ temporaryPassword: password }).strict().optional(), bankDetails: bank.optional() }).strict().superRefine((data, ctx) => {
  if (data.salaryType === 'HOURLY' && data.hourlyRate == null) ctx.addIssue({ code: 'custom', path: ['hourlyRate'], message: 'hourlyRate is required for hourly employees' });
  if (data.salaryType === 'SALARIED' && data.monthlyCtc == null) ctx.addIssue({ code: 'custom', path: ['monthlyCtc'], message: 'monthlyCtc is required for salaried employees' });
  if (data.salaryType === 'PER_JOINING' && data.itJoiningRate == null) ctx.addIssue({ code: 'custom', path: ['itJoiningRate'], message: 'itJoiningRate is required for per-joining employees' });
  if (data.salaryType === 'PER_JOINING' && data.nonItJoiningRate == null) ctx.addIssue({ code: 'custom', path: ['nonItJoiningRate'], message: 'nonItJoiningRate is required for per-joining employees' });
}), query: z.any(), params: z.any() });
const update = z.object({ body: z.object(employeeFields).partial().strict(), query: z.any(), params: z.object({ id: objectId }) });
const id = z.object({ body: z.any(), query: z.any(), params: z.object({ id: objectId }) });
const credentialReset = z.object({
  params: z.object({ id: objectId }), query: z.any(),
  body: z.object({ newPassword: password.optional(), confirmPassword: z.string().max(128).optional() }).strict().default({})
    .superRefine((value, ctx) => {
      if (value.newPassword && value.confirmPassword !== value.newPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' });
    }),
});
const list = z.object({ body: z.any(), params: z.any(), query: z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(), search: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'TERMINATED']).optional(), department: z.string().trim().max(150).optional() }) });
const status = z.object({ body: z.object({ employmentStatus: z.enum(['ACTIVE', 'TERMINATED']), terminationDate: z.iso.date().nullable().optional(), reason: z.string().trim().min(3).max(1000) }).strict(), query: z.any(), params: z.object({ id: objectId }) });
const recruiterAccess = z.object({ body: z.object({ enabled: z.boolean(), temporaryPassword: password.optional() }).strict(), query: z.any(), params: z.object({ id: objectId }) });
const bankUpdate = z.object({ body: bank, query: z.any(), params: z.object({ id: objectId }) });
module.exports = { create, update, id, list, status, recruiterAccess, bankUpdate, credentialReset };
