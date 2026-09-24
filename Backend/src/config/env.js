const path = require('path');

// Load Backend/.env (tests stay isolated from local secrets)
if (!process.env.VITEST) require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const { z } = require('zod');

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_VERSION: z.string().default('v1'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/smart_hrms'),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(20),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().nonnegative().default(2),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  JWT_ACCESS_SECRET: z.string().min(16).default('development-only-access-secret-change-me'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  CORS_ALLOWED_ORIGINS: z.string().default('https://hrms-six-pied-88.vercel.app'),
  BANK_DATA_ENCRYPTION_KEY: z.string().default('development-only-bank-secret-change-me'),
  EMAIL_PROVIDER: z.string().default('console'),
  EMAIL_FROM: z.string().default('no-reply@example.com'),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid environment: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
}

const env = Object.freeze({
  ...result.data,
  corsOrigins: result.data.CORS_ALLOWED_ORIGINS.split(',').map((v) => v.trim()).filter(Boolean),
});

module.exports = { env };
