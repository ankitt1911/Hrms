'use strict';

const { notify } = require('../business/support');

async function create(payload) {
  return notify(payload, { bestEffort: true });
}

module.exports = { create };
