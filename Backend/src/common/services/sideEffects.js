async function optionalCall(modulePath, method, payload) {
  try {
    const service = require(modulePath);
    if (typeof service[method] === 'function') return await service[method](payload);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  return null;
}

const recordAudit = (payload) => optionalCall('../../modules/audit/audit.service', 'record', payload);
const notifyUser = (payload) => optionalCall('../../modules/notifications/notification.service', 'create', payload);
module.exports = { recordAudit, notifyUser };
