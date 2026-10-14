import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: server/src (dev) or server/dist (built) → two levels up. */
export const ROOT = path.resolve(here, '..', '..');

const bool = z
  .enum(['1', '0', 'true', 'false', ''])
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Folder with crm.db, uploads/ and backups/. Same variable the earlier version used. */
  CRM_DATA_DIR: z.string().optional(),
  /** Secret that protects stored credentials (vault). If unset, a key file is created inside the data folder. */
  CRM_SECRET: z.string().min(16, 'CRM_SECRET must be at least 16 characters').optional(),
  /** Number of reverse proxies in front of the app (Render, Caddy, nginx …). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  DEMO_MODE: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  SESSION_HOURS: z.coerce.number().min(0.1).max(24 * 30).default(12),
  /** Folder with the built React app. */
  WEB_DIST: z.string().optional(),
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  /** Background jobs (reminders, auto-debit, backup): on by default, off in tests; set JOBS=0 to disable. */
  JOBS: z.enum(['1', '0', 'true', 'false']).optional(),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  dataDir: string;
  uploadDir: string;
  backupDir: string;
  secret?: string;
  trustProxy: number;
  demo: boolean;
  logLevel: string;
  sessionMs: number;
  webDist: string;
  backupKeep: number;
  /** Background jobs (reminders, auto-debit, backup). Switched off in tests. */
  jobs: boolean;
};

/** Reads and validates the environment once; an invalid value stops the server at start with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(e.CRM_DATA_DIR ?? path.join(ROOT, 'data'));
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    dataDir,
    uploadDir: path.join(dataDir, 'uploads'),
    backupDir: path.join(dataDir, 'backups'),
    secret: e.CRM_SECRET,
    trustProxy: e.TRUST_PROXY,
    demo: e.DEMO_MODE,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : e.NODE_ENV === 'production' ? 'info' : 'debug'),
    sessionMs: Math.round(e.SESSION_HOURS * 3_600_000),
    webDist: path.resolve(e.WEB_DIST ?? path.join(ROOT, 'web', 'dist')),
    backupKeep: e.BACKUP_KEEP,
    jobs: e.JOBS === undefined ? e.NODE_ENV !== 'test' : e.JOBS === '1' || e.JOBS === 'true',
  };
}
