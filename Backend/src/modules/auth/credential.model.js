const { Schema, model } = require('mongoose');

const TokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  purpose: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });
TokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PasswordResetToken = model('PasswordResetToken', TokenSchema);
const OtpCode = model('OtpCode', TokenSchema.clone());
module.exports = { PasswordResetToken, OtpCode };
