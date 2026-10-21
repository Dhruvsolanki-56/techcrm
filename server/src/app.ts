import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './core/context';
import { createEngine, crudRouter, type Engine } from './crud/engine';
import { apiGuard, demoGuard, errorHandler, passwordChangeGate, permissionsPolicy, requireUser, securityHeaders, unknownApi } from './http/middleware';
import { accountRoutes } from './modules/account';
import { authRoutes } from './modules/auth';
import { collabRoutes } from './modules/collab';
import { documentRoutes } from './modules/documents';
import { flowRoutes } from './modules/flows';
import { insightRoutes } from './modules/insights';
import { settingsRoutes } from './modules/settings';
import { userRoutes } from './modules/users';
import { vaultRoutes } from './modules/vault';
import { buildResources } from './resources';
import { setExportBrand } from './modules/exporters';

export interface BuiltApp {
  app: Express;
  engine: Engine;
}

/** Wires the whole HTTP application from a context. No globals, so tests can build as many isolated apps as they like. */
export function createApp(ctx: AppContext): BuiltApp {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.trustProxy) app.set('trust proxy', ctx.config.trustProxy);

  const engineRef: { current?: Engine } = {};
  const { resources, tasks } = buildResources(ctx, () => engineRef.current as Engine);
  const engine = createEngine(ctx, resources);
  engineRef.current = engine;

  app.use(pinoHttp({
    logger: ctx.log, genReqId: (req, res) => { const id = (req.headers['x-request-id'] as string) || randomUUID(); res.setHeader('X-Request-Id', id); return id; },
    autoLogging: { ignore: (req) => !req.url?.startsWith('/api') },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url }), res: (r) => ({ statusCode: r.statusCode }) },
  }));
  app.use(securityHeaders());
  app.use(permissionsPolicy);
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '4mb' }));

  /* ---------- API ---------- */
  const api = express.Router();
  api.use(apiGuard);
  if (ctx.config.demo) api.use(demoGuard);
  // a generous overall ceiling per IP; sign-in has its own, much tighter limit (security/loginLimiter)
  if (ctx.config.env !== 'test') api.use(rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Slow down for a minute.' } }));
  // liveness / readiness for Docker, Render and uptime monitors: no login, no data
  api.get('/health', (_req, res) => {
    try {
      ctx.db.prepare('SELECT 1').get();
      res.setHeader('Cache-Control', 'no-store').json({ ok: true, uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  api.use('/auth', authRoutes(ctx));

  const secured = express.Router();
  secured.use(requireUser(ctx), passwordChangeGate);
  setExportBrand(() => { const s = ctx.settings.get(); return { company: String(s.company_name || 'TechSentinals CRM'), logo: s.logo ? String(s.logo) : undefined }; });
  const { lookups, settings } = settingsRoutes(ctx, engine);
  secured.use(accountRoutes(ctx));
  secured.use('/users', userRoutes(ctx));
  secured.use('/lookups', lookups);
  secured.use('/settings', settings);
  secured.use('/credentials', vaultRoutes(ctx));
  secured.use(collabRoutes(ctx, engine, tasks));
  secured.use(documentRoutes(ctx, engine));
  secured.use(flowRoutes(ctx, engine));
  secured.use(insightRoutes(ctx, engine));
  secured.use(crudRouter(ctx, engine));
  api.use(secured);
  api.use(unknownApi);
  app.use('/api', api);

  /* ---------- the React app (built into web/dist): hashed files are cached for a year, index.html is always revalidated ---------- */
  const dist = ctx.config.webDist;
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use('/_app', express.static(path.join(dist, '_app'), { immutable: true, maxAge: '1y', fallthrough: false }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler(ctx));
  return { app, engine };
}
