const { AppError } = require('../../common/errors/AppError');
const Company = require('./company.model');

const readCompany = (ctx) => Company.findById(ctx.companyId);
async function updateCompany(ctx, input) {
  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  for (const [key, value] of Object.entries(input.settings || {})) patch[`settings.${key}`] = value;
  const company = await Company.findByIdAndUpdate(ctx.companyId, { $set: patch }, { new: true, runValidators: true });
  if (!company) throw new AppError('TENANT_SCOPE_VIOLATION', 404, 'Company was not found');
  return company;
}
module.exports = { readCompany, updateCompany };
