const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { env } = require('./config/env');
const { isDatabaseReady } = require('./config/database');
const { requestId } = require('./common/middleware/requestId.middleware');
const { mongoSanitize } = require('./common/middleware/mongoSanitize.middleware');
const { notFound, errorHandler } = require('./common/middleware/error.middleware');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(requestId);
app.use(helmet());
app.use(cors({ origin(origin, callback) { if (!origin || env.corsOrigins.includes(origin)) return callback(null, true); return callback(null, false); }, credentials: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(mongoSanitize);

app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
app.get('/health/ready', (_req, res) => res.status(isDatabaseReady() ? 200 : 503).json({ status: isDatabaseReady() ? 'ready' : 'not_ready', database: isDatabaseReady() ? 'connected' : 'disconnected' }));

const base = `/api/${env.API_VERSION}`;
app.use(`${base}/auth`, require('./modules/auth/auth.routes'));
app.use(`${base}/me`, require('./modules/auth/me.routes'));
app.use(`${base}/admin`, require('./modules/company/company.routes'));
app.use(`${base}/employees`, require('./modules/employees/employee.routes'));
app.use(`${base}/attendance`, require('./modules/attendance/attendance.routes'));
const leaveRoutes = require('./modules/leave/leave.routes');
app.use(`${base}/leave-types`, leaveRoutes.typeRouter);
app.use(`${base}/leave-requests`, leaveRoutes.router);

try {
  const businessRoutes = require('./modules/business.routes');
  app.use(base, businessRoutes.router || businessRoutes);
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes('business.routes')) throw error;
}

app.use(notFound);
app.use(errorHandler);
module.exports = app;
