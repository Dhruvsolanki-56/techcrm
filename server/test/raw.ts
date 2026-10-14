import type { TestApp } from './helpers';
import { PASSWORD } from './helpers';

export interface RawOpts {
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  ip?: string;
  /** Send `body` as given (string / Buffer) instead of JSON. */
  rawBody?: boolean;
  /** Skip the CSRF header, to test it is enforced. */
  noCsrf?: boolean;
  attach?: { field: string; content: string; filename: string; type?: string; fields?: Record<string, string> };
}
export interface RawReply {
  s: number;
  j: any;
  text: string;
  h: Record<string, string>;
}

/** Low-level request: lets a test pick the client IP (X-Forwarded-For), send broken bodies, files, or leave out the CSRF header. */
export function makeRaw(app: TestApp) {
  return async function raw(method: string, url: string, opts: RawOpts = {}): Promise<RawReply> {
    const path = url.startsWith('/') && !url.startsWith('/api') && !opts.headers?.['x-raw-path'] ? `/api${url}` : url;
    let r = app.request[method.toLowerCase() as 'get'](path).set('X-Forwarded-For', opts.ip ?? '198.51.100.1').set('Accept-Encoding', 'identity');
    if (!opts.noCsrf) r = r.set('X-Requested-With', 'crm');
    if (opts.cookie) r = r.set('Cookie', opts.cookie);
    for (const [k, v] of Object.entries(opts.headers ?? {})) r = r.set(k, v);
    if (opts.attach) {
      r = r.attach(opts.attach.field, Buffer.from(opts.attach.content), { filename: opts.attach.filename, contentType: opts.attach.type ?? 'text/plain' });
      for (const [k, v] of Object.entries(opts.attach.fields ?? {})) r = r.field(k, v);
    } else if (opts.body !== undefined) {
      r = opts.rawBody ? r.send(opts.body as string) : r.send(opts.body as object);
    }
    const res = await r;
    let j: unknown = res.body;
    if (!j || (typeof j === 'object' && Object.keys(j as object).length === 0 && !Array.isArray(j))) {
      try { j = JSON.parse(res.text); } catch { j = null; }
    }
    return { s: res.status, j, text: res.text ?? '', h: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])) };
  };
}

let ipSeq = 10;
export const newIp = (): string => `203.0.113.${ipSeq++}`;

/** Signs in from a given IP; the returned `call` sends every later request from the same address. */
export function makeLogin(app: TestApp) {
  const raw = makeRaw(app);
  return async function login(email: string, password = PASSWORD, o: { ip?: string; code?: string } = {}) {
    const ip = o.ip ?? newIp();
    const r = await raw('POST', '/auth/login', { body: { email, password, ...(o.code ? { code: o.code } : {}) }, ip });
    const cookie = (r.h['set-cookie'] ?? '').split(';')[0] ?? '';
    const call = (m: string, u: string, b?: unknown, extra: Partial<RawOpts> = {}): Promise<RawReply> => raw(m, u, { body: b, cookie, ip, ...extra });
    return { ...r, cookie, call, ip };
  };
}
export type LoginResult = Awaited<ReturnType<ReturnType<typeof makeLogin>>>;
