import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../config';

export interface Vault {
  encrypt(text: string | null | undefined): string | null;
  decrypt(blob: string | null | undefined): string;
}

/**
 * AES-256-GCM encryption for stored credentials.
 * The key comes from CRM_SECRET, or is generated once into <data>/.vault.key.
 * BACK UP THAT FILE with the database — without it stored passwords cannot be decrypted.
 */
export function createVault(config: Pick<Config, 'secret' | 'dataDir'>): Vault {
  const key = loadKey(config);
  return {
    encrypt(text) {
      if (text == null || text === '') return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return `v1.${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
    },
    decrypt(blob) {
      if (!blob) return '';
      const raw = Buffer.from(blob.slice(3), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

function loadKey(config: Pick<Config, 'secret' | 'dataDir'>): Buffer {
  if (config.secret) return crypto.createHash('sha256').update(config.secret).digest();
  const file = path.join(config.dataDir, '.vault.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}
