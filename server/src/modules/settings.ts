import express, { type Request, type Response } from 'express';
import { check, kindFor } from '@crm/shared';
import type { AppContext } from '../core/context';
import { LIST_KEYS } from '../core/settings';
import { badRequest, need } from '../shared/errors';
import { founderOnly } from '../http/middleware';
import { hasFlag, isFounder, type User } from '../security/permissions';
import type { Engine } from '../crud/engine';
import { ruleCheck } from './auth';

/** Lists for dropdowns (small, cached by the browser) and the company settings (founders only). */
export function settingsRoutes(ctx: AppContext, engine: Engine): { lookups: express.Router; settings: express.Router } {
  const lookups = express.Router();
  const settings = express.Router();
  const { db } = ctx;

  lookups.get('/', (req: Request, res: Response) => {
    const u = req.user as User;
    const pick = (name: string, cols: string, limit = 2000): unknown[] => {
      const def = engine.resources[name];
      if (!def) return [];
      const sc = def.scope(u);
      return db.prepare(`SELECT ${cols} FROM ${def.table} ${def.alias} WHERE (${sc.where}) ORDER BY ${def.order} LIMIT ${limit}`).all(...sc.params);
    };
    const s = ctx.settings.get();
    res.json({
      users: db.prepare('SELECT id,name,role,title FROM users WHERE active=1 ORDER BY name').all(),
      clients: pick('clients', 'c.id, c.company, c.status'),
      projects: pick('projects', 'p.id, p.name, p.client_id, p.status, p.code'),
      accounts: isFounder(u) ? db.prepare('SELECT id,name,type FROM accounts WHERE active=1 ORDER BY name').all() : [],
      leads: hasFlag(u, 'leads') ? pick('leads', 'l.id, l.name, l.company, l.stage') : [],
      grants: isFounder(u) ? db.prepare('SELECT id,name FROM grants ORDER BY id DESC').all() : [],
      settings: {
        company_name: s.company_name, currency: s.currency, default_tax_rate: s.default_tax_rate, default_tax_type: s.default_tax_type, logo: s.logo, fy_start_month: s.fy_start_month,
        lead_services: s.lead_services, lead_products: s.lead_products, lead_categories: s.lead_categories, lead_sources: s.lead_sources, statuses: s.statuses,
        ...(isFounder(u) ? { income_categories: s.income_categories, expense_categories: s.expense_categories, payment_modes: s.payment_modes, asset_types: s.asset_types } : {}),
      },
    });
  });

  settings.use(founderOnly);
  settings.get('/', (_req: Request, res: Response) => {
    res.json(ctx.settings.get());
  });
  settings.put('/', (req: Request, res: Response) => {
    const b = { ...((req.body ?? {}) as Record<string, unknown>) };
    ruleCheck('settings', b, {
      company_email: 'Company email', company_phone: 'Company phone', company_website: 'Website', gstin: 'GSTIN', pan: 'PAN', state: 'State', bank_account_name: 'Account holder',
      bank_ifsc: 'IFSC', upi_id: 'UPI ID', bank_account_no: 'Account number', default_tax_rate: 'Default tax rate',
    });
    for (const k of ['gstin', 'pan', 'bank_ifsc'] as const) {
      const kind = kindFor('settings', k);
      if (typeof b[k] === 'string' && kind && !check(kind, b[k])) b[k] = (b[k] as string).trim().toUpperCase();
    }
    const logo = b.logo;
    if (logo && (typeof logo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo) || logo.length > 900_000)) throw badRequest('Logo must be a PNG/JPG/WebP under ~600 KB.');
    if (b.fy_start_month !== undefined) need(['1', '4', '7', '10'].includes(String(b.fy_start_month)), 'Invalid financial year start.');
    if (b.default_tax_type !== undefined) need(['cgst_sgst', 'igst', 'none'].includes(String(b.default_tax_type)), 'Invalid tax type.');
    // dropdown lists: one value per line, no duplicates, sensible sizes
    for (const k of LIST_KEYS) {
      if (b[k] === undefined) continue;
      const seen = new Set<string>();
      const vals = String(b[k]).split('\n').map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 60)).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
      need(vals.length <= 80, 'A list can have at most 80 values.');
      b[k] = vals.join('\n');
    }
    ctx.settings.set(b);
    ctx.audit(req.user as User, 'update', 'settings', null, 'Company settings updated', req.ip);
    res.json(ctx.settings.get());
  });
  return { lookups, settings };
}
