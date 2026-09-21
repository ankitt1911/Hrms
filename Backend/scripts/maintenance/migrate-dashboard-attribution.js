'use strict';

const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { Candidate } = require('../../src/modules/business/models');

async function backfillCandidate(candidate) {
  if (!candidate.recruiterEmployeeId) return false;
  const missing = (candidate.stageHistory || []).some((event) => !event.recruiterEmployeeId);
  if (!missing) return false;
  await Candidate.collection.updateOne(
    { _id: candidate._id },
    { $set: { 'stageHistory.$[event].recruiterEmployeeId': candidate.recruiterEmployeeId } },
    { arrayFilters: [{ 'event.recruiterEmployeeId': null }] },
  );
  return true;
}

async function run() {
  await connectDatabase();
  const cursor = Candidate.collection.find({ recruiterEmployeeId: { $ne: null }, 'stageHistory.recruiterEmployeeId': null });
  let updated = 0;
  for await (const candidate of cursor) if (await backfillCandidate(candidate)) updated += 1;
  process.stdout.write(`Dashboard attribution migration complete: ${updated} candidate(s) updated\n`);
  await disconnectDatabase();
}

if (require.main === module) run().catch(async (error) => { process.stderr.write(`${error.stack || error.message}\n`); await disconnectDatabase(); process.exit(1); });

module.exports = { backfillCandidate };
