const express = require('express');
const controller = require('./auth.controller');
const schemas = require('./auth.validator');
const { validate } = require('../../common/middleware/validate.middleware');
const { authenticate } = require('../../common/middleware/auth.middleware');
const router = express.Router();
router.get('/', authenticate, controller.me);
router.patch('/', authenticate, validate(schemas.profile), controller.updateMe);
module.exports = router;
