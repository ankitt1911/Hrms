const app = require('./app');
const { env } = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { registerBusinessSchedules } = require('./modules/business/scheduler');

async function start() {
  await connectDatabase();
  const scheduledTasks = registerBusinessSchedules({
    onError: (error) => process.stderr.write(`Scheduled task failed: ${error.message}\n`),
  });
  const server = app.listen(env.PORT, () => process.stdout.write(`Smart HRMS API listening on port ${env.PORT}\n`));
  const shutdown = async () => {
    scheduledTasks.forEach((task) => task.stop());
    server.close(async () => { await disconnectDatabase(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
module.exports = { start };
