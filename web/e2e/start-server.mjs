// Starts the real API (with the built web app) on a throw-away data folder, so every e2e run begins with the first-time setup screen.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-e2e-'));
const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server', 'src', 'main.ts')], {
  cwd: path.join(root, 'server'),
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development', PORT: process.env.E2E_PORT ?? '3201', HOST: '127.0.0.1', CRM_DATA_DIR: dir, JOBS: '0', LOG_LEVEL: 'warn', WEB_DIST: path.join(root, 'web', 'dist') },
});
const stop = () => { child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows may still hold the file */ } };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(code ?? 0); });
