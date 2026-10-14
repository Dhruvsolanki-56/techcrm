import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createContext, type AppContext } from '../src/core/context';
import { createLogger } from '../src/logger';

export interface Reply {
  s: number;
  j: any;
  h: Record<string, string | string[] | undefined>;
}
export interface Api {
  email: string;
  call(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  get(url: string): Promise<Reply>;
  /** GET a list with the largest page, so tests see every row. */
  list(url: string): Promise<Reply>;
  post(url: string, body?: unknown): Promise<Reply>;
  put(url: string, body?: unknown): Promise<Reply>;
  del(url: string): Promise<Reply>;
}

export type LoggedIn = Api & { status: number };

export interface TestApp {
  ctx: AppContext;
  config: Config;
  dir: string;
  request: ReturnType<typeof supertest>;
  login(email: string, password?: string): Promise<LoggedIn>;
  anonymous(): Api;
  close(): void;
}

export const PASSWORD = 'Demo-Pass-2026';

/** A complete, isolated app on a throwaway database — every test file builds its own. */
export function createTestApp(env: Record<string, string> = {}): TestApp {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
  const config = loadConfig({ NODE_ENV: 'test', CRM_DATA_DIR: dir, JOBS: '0', CRM_SECRET: 'test-secret-0123456789abcdef', WEB_DIST: path.join(dir, 'no-web'), ...env } as NodeJS.ProcessEnv);
  const ctx = createContext(config, createLogger(config));
  const { app } = createApp(ctx);
  const request = supertest(app);

  const client = (cookie: string, email: string): Api => {
    const call: Api['call'] = async (method, url, body, headers = {}) => {
      let r = request[method.toLowerCase() as 'get'](`/api${url}`).set('X-Requested-With', 'crm').set('Accept-Encoding', 'identity');
      if (cookie) r = r.set('Cookie', cookie);
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      if (body !== undefined && method !== 'GET') r = r.send(body as object);
      const res = await r;
      return { s: res.status, j: res.body, h: res.headers };
    };
    return { email, call, get: (u) => call('GET', u), list: (u) => call('GET', u + (u.includes('?') ? '&' : '?') + 'limit=500'), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b ?? {}), del: (u) => call('DELETE', u) };
  };
  return {
    ctx, config, dir, request,
    async login(email, password = PASSWORD) {
      const r = await request.post('/api/auth/login').set('X-Requested-With', 'crm').send({ email, password });
      const cookie = String((r.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '').split(';')[0] ?? '';
      return { status: r.status, ...client(cookie, email) };
    },
    anonymous: () => client('', 'anonymous'),
    close() {
      try { ctx.db.close(); } catch { /* already closed */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const ago = (days: number): string => {
  const x = new Date();
  x.setDate(x.getDate() - days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const inn = (days: number): string => ago(-days);
