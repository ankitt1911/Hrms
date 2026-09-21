const { z } = require('zod');
const { isValidTimeZone } = require('../../common/utils/dates');
const timeZone = z.string().trim().min(1).max(100).refine(isValidTimeZone, 'Must be a valid IANA timezone');
const companyUpdate = z.object({ body: z.object({
  name: z.string().trim().min(1).max(200).optional(), timezone: timeZone.optional(),
  settings: z.object({
    invoiceClauseDaysDefault: z.number().int().min(0).max(365).optional(), payrollDefaultDeductionPct: z.number().min(0).max(100).optional(), payrollSalariedHoursBase: z.number().positive().max(744).optional(),
    // `null` clears the shift start, which switches punctuality reporting back off.
    workdayStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a 24-hour HH:MM time').nullable().optional(),
    workdayGraceMinutes: z.number().int().min(0).max(240).optional(),
    standardWorkMinutes: z.number().int().min(1).max(1440).optional(),
    workweek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  }).partial().optional(),
}).strict(), query: z.any(), params: z.any() });
module.exports = { companyUpdate };
