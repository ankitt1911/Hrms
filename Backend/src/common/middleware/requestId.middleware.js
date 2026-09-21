const { randomUUID } = require('node:crypto');

function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.requestId = incoming && /^[A-Za-z0-9_.:-]{1,128}$/.test(incoming) ? incoming : `req_${randomUUID()}`;
  res.set('X-Request-Id', req.requestId);
  next();
}

module.exports = { requestId };
