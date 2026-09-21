const { Schema, model } = require('mongoose');

const CompanySchema = new Schema({
  singletonKey: { type: String, enum: ['PRIMARY'], default: 'PRIMARY', unique: true, immutable: true },
  name: { type: String, required: true, trim: true },
  timezone: { type: String, default: 'UTC' },
  settings: {
    invoiceClauseDaysDefault: { type: Number, default: 45, min: 0 },
    payrollDefaultDeductionPct: { type: Number, default: 10, min: 0, max: 100 },
    payrollSalariedHoursBase: { type: Number, default: 208, min: 1 },
    // Workday shape. Attendance analytics need to know which calendar days count
    // as working days and what a full day looks like; punctuality additionally
    // needs a shift start, which stays unset until an owner opts in so the
    // dashboard can omit the metric rather than invent one.
    workdayStartTime: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    workdayGraceMinutes: { type: Number, default: 10, min: 0, max: 240 },
    standardWorkMinutes: { type: Number, default: 480, min: 1, max: 1440 },
    workweek: { type: [Number], default: [1, 2, 3, 4, 5] },
  },
}, { timestamps: true });

module.exports = model('Company', CompanySchema);
