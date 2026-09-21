const { Schema, model } = require('mongoose');
// PER_JOINING pays a recruiter per candidate who reaches the JOINED stage, at a
// different rate for IT and non-IT job openings.
const SALARY_TYPES = ['HOURLY', 'SALARIED', 'PER_JOINING'];
const EMPLOYMENT_STATUSES = ['ACTIVE', 'TERMINATED'];

const SalaryComponentSchema = new Schema({
  label: { type: String, required: true, trim: true, maxlength: 100 },
  amount: { type: Schema.Types.Decimal128, required: true },
}, { _id: false });

const EmployeeSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  workEmail: { type: String, required: true, trim: true, lowercase: true },
  employeeCode: { type: String, required: true, trim: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  phone: { type: String, default: null },
  qualification: { type: String, default: null },
  designation: { type: String, default: null },
  department: { type: String, default: null },
  managerId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
  employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES, default: 'ACTIVE' },
  joiningDate: { type: Date, required: true },
  terminationDate: { type: Date, default: null },
  salaryType: { type: String, enum: SALARY_TYPES, required: true },
  hourlyRate: { type: Schema.Types.Decimal128, default: null },
  monthlyCtc: { type: Schema.Types.Decimal128, default: null },
  takeHomeSalary: { type: Schema.Types.Decimal128, default: null },
  itJoiningRate: { type: Schema.Types.Decimal128, default: null },
  nonItJoiningRate: { type: Schema.Types.Decimal128, default: null },
  // The named pay structure. When earnings are present they replace the derived
  // gross for a salaried employee, and deductions replace the percentage default.
  salaryComponents: {
    earnings: { type: [SalaryComponentSchema], default: [] },
    deductions: { type: [SalaryComponentSchema], default: [] },
  },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

EmployeeSchema.index({ companyId: 1, employeeCode: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
EmployeeSchema.index({ userId: 1 }, { unique: true, sparse: true });
EmployeeSchema.index({ companyId: 1, workEmail: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
EmployeeSchema.index({ companyId: 1, employmentStatus: 1 });
module.exports = { Employee: model('Employee', EmployeeSchema), SalaryComponentSchema, SALARY_TYPES, EMPLOYMENT_STATUSES };
