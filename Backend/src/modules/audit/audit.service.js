'use strict';

const { audit } = require('../business/support');

async function record(payload) {
  const { ctx, ...event } = payload;
  return audit(ctx, event);
}

module.exports = { record };
