const crypto = require('node:crypto');
const { env } = require('../../config/env');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
const ipHash = (ip) => (ip ? sha256(ip) : null);

function encryptSensitive(value) {
  if (value == null || value === '') return null;
  const key = crypto.createHash('sha256').update(env.BANK_DATA_ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSensitive(payload) {
  if (!payload) return null;
  const [version, iv, tag, encrypted] = payload.split('.');
  if (version !== 'v1') throw new Error('Unsupported encrypted value');
  const key = crypto.createHash('sha256').update(env.BANK_DATA_ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

function mask(value, visible = 4) {
  if (!value) return null;
  return `${'*'.repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

module.exports = { sha256, randomToken, ipHash, encryptSensitive, decryptSensitive, mask };
