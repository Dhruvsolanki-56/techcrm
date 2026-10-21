import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import type { AppContext } from '../core/context';
import { forbidden, HttpError } from '../shared/errors';
import { isFounder } from '../security/permissions';
import { parseCookies, SESSION_COOKIE } from './cookies';

/** Security headers. The policy only allows our own scripts: nothing typed into the CRM can ever run as code. */
export const securityHeaders = (): RequestHandler =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"], 'img-src': ["'self'", 'data:', 'blob:'], 'style-src': ["'self'", "'unsafe-inline'"], 'script-src': ["'self'"],
        'object-src': ["'none'"], 'base-uri': ["'none'"], 'frame-ancestors': ["'none'"], 'form-action': ["'self'"], 'connect-src': ["'self'"], 'font-src': ["'self'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    strictTransportSecurity: { maxAge: 15_552_000 },
  });

export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
};

/** Every state-changing API request must carry our custom header: it blocks cross-site form posts (CSRF). */
export const apiGuard: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'crm') {
    res.status(403).json({ error: 'Blocked: missing request header.' });
    return;
  }
  next();
};

/** The public demo lets visitors try everything except what would lock other visitors out. */
export const demoGuard: RequestHandler = (req, res, next) => {
  const blocked: [string, RegExp][] = [['POST', /^\/api\/auth\/setup$/], ['POST', /^\/api\/password$/], ['POST', /^\/api\/2fa\//], ['POST', /^\/api\/users$/], ['PUT', /^\/api\/users\//], ['DELETE', /^\/api\/users\//], ['PUT', /^\/api\/settings$/]];
  if (blocked.some(([m, re]) => m === req.method && re.test(req.path))) {
    res.status(403).json({ error: 'This is switched off in the public demo, so visitors cannot lock each other out.' });
    return;
  }
  next();
};

/** Finds the person behind the session cookie, or answers 401. */
export const requireUser = (ctx: AppContext): RequestHandler => (req, res, next) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  const user = ctx.sessions.userFor(token);
  if (!user) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }
  req.user = user;
  req.sessionToken = token;
  next();
};

/** Someone signed in with a temporary password can do nothing else until they choose their own. */
const OPEN_WITH_TEMP_PASSWORD = new Set(['/me', '/password', '/lookups']);
export const passwordChangeGate: RequestHandler = (req, res, next) => {
  if (req.user?.must_change_password && !OPEN_WITH_TEMP_PASSWORD.has(req.path)) {
    res.status(403).json({ error: 'Choose your own password first.', code: 'password_change_required' });
    return;
  }
  next();
};

export const founderOnly: RequestHandler = (req, _res, next) => {
  if (!req.user || !isFounder(req.user)) throw forbidden();
  next();
};

export const unknownApi: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/** One place that turns every failure into a calm, plain-English JSON answer (and never leaks a stack trace). */
export const errorHandler = (ctx: AppContext): ErrorRequestHandler => (err, req: Request, res: Response, _next: NextFunction) => {
  const e = err as { status?: number; code?: string; type?: string; message?: string; expose?: boolean };
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return;
  }
  if (e.code === 'LIMIT_FILE_SIZE') { res.status(413).json({ error: 'File is larger than 60 MB.' }); return; }
  const rule = /crm: (.+)/.exec(e.message ?? '');
  if (rule) { res.status(409).json({ error: rule[1] }); return; } // a rule the database itself enforces, in plain words
  if (/UNIQUE constraint/.test(e.message ?? '')) { res.status(409).json({ error: 'That value already exists (it must be unique).' }); return; }
  if (/FOREIGN KEY/.test(e.message ?? '')) {
    res.status(409).json({ error: req.method === 'DELETE' ? 'This record is still used by other records, so it cannot be deleted.' : 'One of the records you picked (client, project, invoice, account …) no longer exists. Refresh and choose again.' });
    return;
  }
  if (e.type === 'entity.parse.failed') { res.status(400).json({ error: 'The request could not be read.' }); return; }
  if (e.type === 'entity.too.large') { res.status(413).json({ error: 'The request is too large.' }); return; }
  if (e.expose && e.status && e.status >= 400 && e.status < 500) { res.status(e.status).json({ error: 'Bad request.' }); return; }
  ctx.log.error({ err, method: req.method, url: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: 'Something went wrong on the server.' });
};
