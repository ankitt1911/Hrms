function serialize(value) {
  if (value == null) return value;
  if (value?._bsontype === 'Decimal128') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const json = value.toJSON ? value.toJSON() : value;
    if (json !== value && (json == null || typeof json !== 'object')) return serialize(json);
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

function success(res, data, message = 'Operation completed successfully', status = 200) {
  return res.status(status).json({ success: true, message, data: serialize(data), meta: { requestId: res.req.requestId } });
}

module.exports = { success, serialize };
