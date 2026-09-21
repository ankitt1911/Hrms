const express = require('express');
const service = require('./attendance.service');
const schemas = require('./attendance.validator');
const { success } = require('../../common/http/response');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { requireSuperAdmin, requireEmployee } = require('../../common/middleware/access.middleware');
const { validate } = require('../../common/middleware/validate.middleware');
const router = express.Router(); router.use(authenticate);
router.get('/me/state', requireEmployee, async (req, res) => {
  return success(res, await service.state(req.actor));
});
router.post('/me/clock-in', requireEmployee, validate(schemas.empty), async (req, res) => success(res, await service.clockIn(req.actor), 'Clocked in', 201));
router.post('/me/break', requireEmployee, validate(schemas.empty), async (req, res) => success(res, await service.startBreak(req.actor), 'Break started'));
router.post('/me/resume', requireEmployee, validate(schemas.empty), async (req, res) => success(res, await service.resume(req.actor), 'Work resumed'));
router.post('/me/clock-out', requireEmployee, validate(schemas.empty), async (req, res) => success(res, await service.clockOut(req.actor), 'Clocked out'));
router.get('/me/history', requireEmployee, validate(schemas.history), async (req, res) => success(res, await service.history(req.actor, req.validated.query)));
router.get('/', requireSuperAdmin, validate(schemas.adminList), async (req, res) => success(res, await service.adminList(req.actor, req.validated.query)));
router.patch('/:id/correction', requireSuperAdmin, validate(schemas.correction), async (req, res) => success(res, await service.correct(req.actor, req.validated.params.id, req.validated.body), 'Attendance corrected'));
module.exports = router;
