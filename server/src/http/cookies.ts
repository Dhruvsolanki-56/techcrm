import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'crm_session';

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie: ignore */ }
    }
  }
  return out;
}

/** HttpOnly + SameSite=Lax (+ Secure on https) — the browser's scripts can never read the session. */
export function setSessionCookie(req: Request, res: Response, token: string, maxAgeSeconds: number): void {
  const secure = req.secure; // behind a proxy, set TRUST_PROXY so Express trusts X-Forwarded-Proto
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
