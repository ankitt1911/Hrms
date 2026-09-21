'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

class StorageAdapter {
  async put() { throw new Error('StorageAdapter.put not implemented'); }
  async signedDownloadUrl() { throw new Error('StorageAdapter.signedDownloadUrl not implemented'); }
  async remove() { throw new Error('StorageAdapter.remove not implemented'); }
}

class LocalPrivateStorage extends StorageAdapter {
  constructor(root = process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), '.private-storage')) { super(); this.root = path.resolve(root); }
  resolve(key) {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes('..')) throw new Error('Invalid object key');
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new Error('Invalid object key');
    return resolved;
  }
  async put({ key, buffer }) { const target = this.resolve(key); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, buffer, { mode: 0o600 }); return { key }; }
  async signedDownloadUrl({ key, expiresIn = 900 }) {
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const signature = crypto.createHmac('sha256', process.env.LOCAL_STORAGE_SIGNING_SECRET || 'development-only-change-me').update(`${key}:${expires}`).digest('hex');
    return `/api/v1/storage/local/download?key=${Buffer.from(key).toString('base64url')}&expires=${expires}&signature=${signature}`;
  }
  verify({ encodedKey, expires, signature }) {
    if (!/^\d+$/.test(String(expires)) || Number(expires) < Math.floor(Date.now() / 1000)) return null;
    let key; try { key = Buffer.from(encodedKey, 'base64url').toString(); } catch { return null; }
    const expected = crypto.createHmac('sha256', process.env.LOCAL_STORAGE_SIGNING_SECRET || 'development-only-change-me').update(`${key}:${expires}`).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    return { key, path: this.resolve(key) };
  }
  async remove({ key }) { await fs.unlink(this.resolve(key)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

class S3CompatibleStorage extends StorageAdapter {
  constructor(client) { super(); this.client = client; }
  requireClient() { if (!this.client) throw new Error('S3 client adapter is not configured'); }
  async put(input) { this.requireClient(); return this.client.put(input); }
  async signedDownloadUrl(input) { this.requireClient(); return this.client.signedDownloadUrl(input); }
  async remove(input) { this.requireClient(); return this.client.remove(input); }
}

let active = new LocalPrivateStorage();
function setStorageAdapter(adapter) { if (!(adapter instanceof StorageAdapter) && !adapter?.put) throw new TypeError('Invalid storage adapter'); active = adapter; }
function getStorageAdapter() { return active; }
function safeFilename(name) { return path.basename(String(name || 'document')).normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'document'; }
function detectType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return null;
}

module.exports = { StorageAdapter, LocalPrivateStorage, S3CompatibleStorage, setStorageAdapter, getStorageAdapter, safeFilename, detectType };
