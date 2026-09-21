const express = require('express');
const service = require('./company.service');
const schemas = require('./company.validator');
const { success } = require('../../common/http/response');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { requireSuperAdmin } = require('../../common/middleware/access.middleware');
const { validate } = require('../../common/middleware/validate.middleware');
const router = express.Router();

router.use(authenticate);
router.get('/companies', requireSuperAdmin, async (req, res) => success(res, await service.readCompany(req.actor)));
router.patch('/companies', requireSuperAdmin, validate(schemas.companyUpdate), async (req, res) => success(res, await service.updateCompany(req.actor, req.validated.body), 'Company updated'));
module.exports = router;
