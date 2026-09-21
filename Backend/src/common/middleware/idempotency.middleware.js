const crypto = require('node:crypto');
const { Schema, model, models } = require('mongoose');
const { AppError } = require('../errors/AppError');

const IdempotencyKey = models.IdempotencyKey || model('IdempotencyKey', new Schema({
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, route: { type: String, required: true }, key: { type: String, required: true },
  requestHash: { type: String, required: true }, responseBody: { type: Schema.Types.Mixed, default: null }, responseStatus: { type: Number, default: null }, expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } }));
IdempotencyKey.schema.index({ actorUserId: 1, route: 1, key: 1 }, { unique: true });
IdempotencyKey.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function idempotency({ required = false, ttlHours = 24 } = {}) {
  return async (req, res, next) => {
    try {
      const key = req.get('Idempotency-Key');
      if (!key && !required) return next();
      if (!key || !/^[A-Za-z0-9_.:-]{8,200}$/.test(key)) throw new AppError('VALIDATION_ERROR', 400, 'A valid Idempotency-Key header is required');
      const route = `${req.method} ${req.baseUrl}${req.route?.path || req.path}`;
      const requestHash = crypto.createHash('sha256').update(JSON.stringify(stable({ body: req.body, params: req.params }))).digest('hex');
      try {
        const row = await IdempotencyKey.create({ actorUserId: req.actor.userId, route, key, requestHash, expiresAt: new Date(Date.now() + ttlHours * 3600000) });
        const json = res.json.bind(res);
        res.json = (body) => {
          IdempotencyKey.updateOne({ _id: row._id }, { $set: { responseBody: body, responseStatus: res.statusCode } }).catch(() => {});
          return json(body);
        };
        return next();
      } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await IdempotencyKey.findOne({ actorUserId: req.actor.userId, route, key });
        if (!existing || existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED', 409, 'Idempotency key was reused with a different payload');
        if (!existing.responseBody) throw new AppError('CONFLICT', 409, 'An identical request is still in progress');
        return res.status(existing.responseStatus || 200).json(existing.responseBody);
      }
    } catch (error) { return next(error); }
  };
}

module.exports = { IdempotencyKey, idempotency };
