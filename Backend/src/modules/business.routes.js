'use strict';

const express = require('express');
const { authenticate } = require('../common/middleware/auth.middleware');
const businessRouter = require('./business/business.routes');

const router = express.Router();
router.use((req, res, next) => {
  if (req.path === '/storage/local/download') return next();
  return req.actor ? next() : authenticate(req, res, next);
}, businessRouter);

module.exports = router;
module.exports.router = router;
