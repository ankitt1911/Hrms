const express = require('express');
const controller = require('./auth.controller');
const schemas = require('./auth.validator');
const { validate } = require('../../common/middleware/validate.middleware');
const { authenticate } = require('../../common/middleware/auth.middleware');
const router = express.Router();

router.post('/login', validate(schemas.login), controller.login);
router.post('/refresh', validate(schemas.refresh), controller.refresh);
router.post('/forgot-password', validate(schemas.forgot), controller.forgot);
router.post('/request-otp', validate(schemas.requestOtp), controller.requestOtp);
router.post('/verify-otp', validate(schemas.verifyOtp), controller.verifyOtp);
router.post('/reset-password', validate(schemas.reset), controller.reset);
router.post('/logout', authenticate, controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);
router.post('/change-password', authenticate, validate(schemas.change), controller.change);
router.get('/sessions', authenticate, controller.sessions);
router.delete('/sessions/:id', authenticate, validate(schemas.sessionId), controller.revoke);
module.exports = router;
