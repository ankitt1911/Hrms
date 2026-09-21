const { AppError } = require('../errors/AppError');

async function assertExists(Model, id, { companyId, filter = {}, code = 'REFERENCED_ENTITY_NOT_FOUND' } = {}) {
  const query = { _id: id, ...filter };
  if (companyId && Model.schema.path('companyId')) query.companyId = companyId;
  if (Model.schema.path('deletedAt')) query.deletedAt = null;
  const document = await Model.findOne(query);
  if (!document) throw new AppError(code, 422, 'Referenced entity was not found in this company');
  return document;
}

module.exports = { assertExists };
