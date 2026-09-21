const { Schema, model } = require('mongoose');
const USER_STATUSES = ['INVITATION_PENDING', 'ACTIVE', 'LOCKED', 'DISABLED'];
const USER_ROLES = ['SUPER_ADMIN', 'RECRUITER'];

const UserSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  role: { type: String, enum: USER_ROLES, required: true, index: true },
  email: { type: String, required: true, trim: true },
  normalizedEmail: { type: String, required: true, trim: true, lowercase: true },
  displayName: { type: String, default: null, trim: true },
  passwordHash: { type: String, default: null, select: false },
  status: { type: String, enum: USER_STATUSES, default: 'INVITATION_PENDING' },
  mustChangePassword: { type: Boolean, default: false },
  failedLoginCount: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  tokenVersion: { type: Number, default: 0 },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

UserSchema.index({ normalizedEmail: 1 }, { unique: true });
UserSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null }, name: 'one_active_super_admin' },
);
UserSchema.index({ companyId: 1, status: 1 });
module.exports = { User: model('User', UserSchema), USER_STATUSES, USER_ROLES };
