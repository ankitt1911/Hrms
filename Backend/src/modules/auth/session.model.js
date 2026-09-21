const { Schema, model } = require('mongoose');

const SessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  refreshTokenHash: { type: String, required: true, select: false },
  usedTokenHashes: [{ type: String, select: false }],
  familyId: { type: String, required: true, index: true },
  deviceId: { type: String, default: null },
  userAgent: { type: String, default: null },
  ipHash: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });
SessionSchema.index({ userId: 1, revokedAt: 1, createdAt: -1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 * 30 });
module.exports = model('Session', SessionSchema);
