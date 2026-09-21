const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
require('../../src/app');

async function run() {
  await connectDatabase();
  for (const model of Object.values(mongoose.models)) await model.syncIndexes();
  process.stdout.write(`Synchronized indexes for ${Object.keys(mongoose.models).length} models\n`);
  await disconnectDatabase();
}
run().catch(async (error) => { process.stderr.write(`${error.message}\n`); await disconnectDatabase(); process.exit(1); });
