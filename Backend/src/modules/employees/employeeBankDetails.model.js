const { Schema, model } = require('mongoose');
const EmployeeBankDetailsSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
  accountHolder: { type: String, default: null },
  bankName: { type: String, default: null },
  accountNumberEncrypted: { type: String, default: null, select: false },
  ifscOrRouting: { type: String, default: null },
  panEncrypted: { type: String, default: null, select: false },
  aadhaarEncrypted: { type: String, default: null, select: false },
}, { timestamps: { createdAt: false, updatedAt: true } });
module.exports = model('EmployeeBankDetails', EmployeeBankDetailsSchema);
