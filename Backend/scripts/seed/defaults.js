const { LeaveType } = require('../../src/modules/leave/leave.model');

const DEFAULT_LEAVE_TYPES = Object.freeze([
  { name: 'Casual Leave', isPaid: true },
  { name: 'Sick Leave', isPaid: true },
  { name: 'Earned Leave', isPaid: true },
  { name: 'Maternity Leave', isPaid: true },
  { name: 'Paternity Leave', isPaid: true },
  { name: 'Bereavement Leave', isPaid: true },
  { name: 'Leave Without Pay', isPaid: false },
]);

async function seedLeaveTypes(companyId) {
  await LeaveType.bulkWrite(DEFAULT_LEAVE_TYPES.map((leaveType) => ({
    updateOne: {
      filter: { companyId, name: leaveType.name, deletedAt: null },
      update: { $setOnInsert: { companyId, ...leaveType, deletedAt: null } },
      upsert: true,
    },
  })));
  return DEFAULT_LEAVE_TYPES.length;
}

module.exports = { DEFAULT_LEAVE_TYPES, seedLeaveTypes };
