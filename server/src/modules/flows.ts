import express, { type Request, type Response } from 'express';
import { SCHEDULE_TEMPLATES, addDays, addMonths, CLOSED_STAGES, CYCLE_MONTHS, today, validDate, round2, values, FOLLOWUP_ROUNDS, LEAD_STAGES } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import type { Engine } from '../crud/engine';
import { projectCode } from '../domain/entities';
import { linkInvoiceToChangeRequest, syncChangeRequestWithQuote } from '../domain/changeRequests';
import { nextNumber } from '../domain/billing';
import { toPdf, toXlsx } from './exporters';
import { badRequest, conflict, forbidden, HttpError, need, notFound } from '../shared/errors';
import { founderOnly } from '../http/middleware';
import { intOrNull, str } from '../http/validate';
import { hasFlag, type User } from '../security/permissions';

/** Multi-step business flows that touch several kinds of records in one all-or-nothing step. */
export function flowRoutes(ctx: AppContext, engine: Engine): express.Router {
  const router = express.Router();
  const { db } = ctx;
  const user = (req: Request): User => req.user as User;
  const one = (sql: string, ...p: unknown[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];

  /* ---------- log a contact on a lead: the note, the stage and the next follow-up are saved together ---------- */
  router.post('/leads/:id/contact', (req: Request, res: Response) => {
    const u = user(req);
    if (!hasFlag(u, 'leads')) throw forbidden();
    const hit = engine.scoped('leads', String(req.params.id), u);
    if (!hit) throw notFound();
    const lead = hit.row;
    const b = (req.body ?? {}) as Record<string, unknown>;
    need(b.body && String(b.body).trim(), 'Write the outcome of the contact first.');
    const stage = String(b.stage ?? lead.stage);
    need((values(LEAD_STAGES) as string[]).includes(stage), 'Unknown sales stage.');
    const ended = (CLOSED_STAGES as readonly string[]).includes(stage);
    const round = ended ? 'complete' : String(b.followup_round ?? lead.followup_round);
    need((values(FOLLOWUP_ROUNDS) as string[]).includes(round), 'Unknown follow-up round.');
    const nextF = ended ? null : str(b.next_followup, 10);
    need(!nextF || validDate(nextF), 'Next Follow-Up Date must be a real date.');
    const kind = ['call', 'whatsapp', 'email', 'meeting', 'demo', 'proposal', 'visit', 'note'].includes(String(b.kind)) ? String(b.kind) : 'call';
    db.transaction(() => {
      db.prepare('INSERT INTO notes(entity_type,entity_id,user_id,kind,body,followup_round,next_followup) VALUES(?,?,?,?,?,?,?)').run('lead', lead.id, u.id, kind, String(b.body).trim().slice(0, 10_000), round, nextF);
      engine.update('leads', lead.id, { user: u, ip: req.ip, body: { stage, followup_round: round, next_followup: nextF, next_action: ended ? null : str(b.next_action, 500), last_contact: today() } });
    })();
    res.json(engine.scoped('leads', lead.id, u)?.row);
  });

  /* ---------- lead → client (and optionally a project from the accepted quote) ---------- */
  router.post('/leads/:id/convert', founderOnly, (req: Request, res: Response) => {
    const lead = one('SELECT * FROM leads WHERE id=?', req.params.id);
    if (!lead) throw notFound('Lead not found');
    // a lead made for an existing client has its client already: converting it only starts the work
    if (lead.client_id && lead.stage === 'won') throw badRequest('This lead was already converted.');
    const existingClient = (lead.client_id as number | null) ?? null;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const u = user(req);
    const quote = b.quote_id ? one('SELECT * FROM quotes WHERE id=? AND lead_id=?', intOrNull(b.quote_id), lead.id) : undefined;
    if (b.quote_id && !quote) throw badRequest('That quotation does not belong to this lead.');
    const out = db.transaction(() => {
      const clientId = existingClient ?? Number(db.prepare('INSERT INTO clients(company,website,city,status,account_manager_id,notes) VALUES(?,?,?,?,?,?)')
        .run(lead.company || lead.name, lead.website, lead.city, 'active', lead.owner_id, lead.notes).lastInsertRowid);
      if (!existingClient) db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(clientId, lead.name, lead.email, lead.phone);
      db.prepare("UPDATE leads SET client_id=?, stage='won', closed_on=COALESCE(closed_on, ?), next_followup=NULL, updated_at=datetime('now') WHERE id=?").run(clientId, today(), lead.id);
      db.prepare('UPDATE quotes SET client_id=? WHERE lead_id=?').run(clientId, lead.id);
      db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('client',?,?,'system',?)").run(clientId, u.id, `Converted from lead "${lead.name}" (source: ${lead.source || 'n/a'}, expected value ${lead.value || 0})`);
      db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('lead',?,?,'system','Converted to client')").run(lead.id, u.id);
      for (const n of all("SELECT * FROM notes WHERE entity_type='lead' AND entity_id=? AND kind<>'system'", lead.id)) {
        db.prepare('INSERT INTO notes(entity_type,entity_id,user_id,kind,body,created_at) VALUES(?,?,?,?,?,?)').run('client', clientId, n.user_id, n.kind, n.body, n.created_at);
      }
      let projectId: number | null = null;
      if (b.create_project) {
        const value = quote ? round2(quote.subtotal - quote.discount) : lead.value || 0;
        projectId = Number(db.prepare("INSERT INTO projects(client_id,name,type,status,budget,manager_id,description) VALUES(?,?,?,'planning',?,?,?)")
          .run(clientId, str(b.project_name) || `${lead.company || lead.name} — ${lead.department || lead.service || 'Project'}`, lead.service, value, lead.owner_id, lead.requirement || null).lastInsertRowid);
        // what was discussed with the lead becomes the project's specification, and its files move with it
        const specs = [lead.specs, lead.notes ? `Notes from the sales conversation:\n${lead.notes}` : ''].filter(Boolean).join('\n\n');
        db.prepare('UPDATE projects SET specs=? WHERE id=?').run(specs || null, projectId);
        db.prepare("UPDATE documents SET entity_type='project', entity_id=? WHERE entity_type='lead' AND entity_id=?").run(projectId, lead.id); // the lead's files follow the work
        db.prepare('UPDATE projects SET code=? WHERE id=?').run(projectCode(projectId), projectId);
        if (lead.owner_id) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(projectId, lead.owner_id);
        if (quote) {
          // the accepted quotation becomes the agreed scope and value of the project
          db.prepare("UPDATE quotes SET project_id=?, client_id=?, status='accepted', updated_at=datetime('now') WHERE id=?").run(projectId, clientId, quote.id);
          db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('project',?,?,'system',?)").run(projectId, u.id, `Started from accepted quotation ${quote.number} (₹${value.toLocaleString('en-IN')})`);
        }
      }
      // with no project yet, the lead's files go to the client
      db.prepare("UPDATE documents SET entity_type='client', entity_id=? WHERE entity_type='lead' AND entity_id=?").run(clientId, lead.id);
      return { client_id: clientId, project_id: projectId };
    })();
    ctx.audit(u, 'convert', 'leads', lead.id, `${lead.name} → client #${out.client_id}`, req.ip);
    res.json(out);
  });


  /* ---------- payment schedule of a project: a ready-made split of the agreed value ---------- */
  router.post('/projects/:id/schedule', founderOnly, (req: Request, res: Response) => {
    const p = one('SELECT * FROM projects WHERE id=?', req.params.id);
    if (!p) throw notFound('Project not found');
    const tpl = SCHEDULE_TEMPLATES[String((req.body ?? {}).template)];
    need(tpl, 'Choose a payment schedule.');
    need(p.budget > 0, 'Set the agreed value of the project first.');
    db.transaction(() => {
      // payments already invoiced are kept; the rest of the value is split over a fresh schedule
      const kept = one('SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM milestones WHERE project_id=? AND invoice_id IS NOT NULL', p.id) as { s: number; n: number };
      db.prepare('DELETE FROM milestones WHERE project_id=? AND invoice_id IS NULL').run(p.id);
      let left = round2(Math.max(0, (p.budget as number) - kept.s));
      const base = left;
      tpl.items.forEach(([title, kind, percent], i) => {
        const last = i === tpl.items.length - 1;
        const amount = last ? left : round2((base * percent) / 100);
        left = round2(left - amount);
        if (amount <= 0) return;
        const due = kind === 'advance' ? p.start_date || today() : last ? p.deadline || null : null;
        db.prepare('INSERT INTO milestones(project_id,title,kind,percent,amount,due_date,position) VALUES(?,?,?,?,?,?,?)').run(p.id, title, kind, percent, amount, due, kept.n + i + 1);
      });
    })();
    ctx.audit(user(req), 'update', 'projects', p.id, `Payment schedule: ${tpl.label}`, req.ip);
    res.json(all('SELECT * FROM milestones WHERE project_id=? ORDER BY position', p.id));
  });

  /* ---------- milestone → draft invoice ---------- */
  router.post('/milestones/:id/invoice', founderOnly, (req: Request, res: Response) => {
    const m = one('SELECT ms.*, p.client_id, p.name AS project_name FROM milestones ms JOIN projects p ON p.id=ms.project_id WHERE ms.id=?', req.params.id);
    if (!m) throw notFound('Payment not found');
    need(!m.invoice_id, 'This payment has already been invoiced.');
    need(m.client_id, 'The project has no client yet.');
    const inv = engine.create('invoices', {
      user: user(req), ip: req.ip,
      body: { client_id: m.client_id, project_id: m.project_id, title: `${m.project_name} — ${m.title}`, due_date: addDays(today(), 15), items: [{ description: `${m.project_name} — ${m.title}`, qty: 1, rate: m.amount }] },
    });
    db.prepare("UPDATE milestones SET invoice_id=?, reached_on=COALESCE(reached_on, ?), updated_at=datetime('now') WHERE id=?").run(inv.id, today(), m.id);
    res.status(201).json({ invoice_id: inv.id, number: inv.number });
  });

  /* ---------- quotation → project (new work for a client who already exists) ---------- */
  router.post('/quotes/:id/start-project', founderOnly, (req: Request, res: Response) => {
    const q = one('SELECT * FROM quotes WHERE id=?', req.params.id);
    if (!q) throw notFound('Quote not found');
    need(q.client_id, 'Link the quotation to a client first (convert the lead to a client).');
    need(!q.project_id, 'This quotation already has a project.');
    need(!q.change_request_id, 'A quotation for a change request belongs to its project.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const u = user(req);
    const out = db.transaction(() => {
      const value = round2(q.subtotal - q.discount);
      const pid = Number(db.prepare("INSERT INTO projects(client_id,name,status,budget,manager_id,start_date,description) VALUES(?,?,'planning',?,?,?,?)")
        .run(q.client_id, str(b.project_name) || q.title || `Project ${q.number}`, value, u.id, today(), q.notes ?? null).lastInsertRowid);
      db.prepare('UPDATE projects SET code=? WHERE id=?').run(projectCode(pid), pid);
      db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(pid, u.id);
      db.prepare("UPDATE quotes SET project_id=?, status='accepted', updated_at=datetime('now') WHERE id=?").run(pid, q.id);
      if (q.lead_id) db.prepare("UPDATE leads SET stage='won', closed_on=COALESCE(closed_on, ?), client_id=COALESCE(client_id, ?), next_followup=NULL WHERE id=?").run(today(), q.client_id, q.lead_id);
      db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('project',?,?,'system',?)").run(pid, u.id, `Started from accepted quotation ${q.number} (₹${value.toLocaleString('en-IN')})`);
      return pid;
    })();
    ctx.audit(u, 'convert', 'quotes', q.id, `${q.number} → project #${out}`, req.ip);
    res.status(201).json({ project_id: out });
  });

  /* ---------- quotation → invoice ---------- */
  router.post('/quotes/:id/to-invoice', founderOnly, (req: Request, res: Response) => {
    const q = one('SELECT * FROM quotes WHERE id=?', req.params.id);
    if (!q) throw notFound('Quote not found');
    need(q.client_id, 'Link this quotation to a client first (convert the lead to a client).');
    const s = ctx.settings.get();
    const issue = today();
    const due = new Date();
    due.setDate(due.getDate() + 15);
    const id = db.transaction(() => {
      const invoiceId = Number(db.prepare(`INSERT INTO invoices(number,client_id,project_id,quote_id,change_request_id,title,issue_date,due_date,status,items,subtotal,discount,tax_type,tax_rate,tax_amount,total,currency,terms,notes,created_by)
        VALUES(?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?)`)
        .run(nextNumber(ctx, 'invoices', s.invoice_prefix, issue), q.client_id, q.project_id, q.id, q.change_request_id, q.title, issue, due.toISOString().slice(0, 10), q.items, q.subtotal, q.discount,
          q.tax_type, q.tax_rate, q.tax_amount, q.total, q.currency, s.terms_invoice, q.notes, user(req).id).lastInsertRowid);
      db.prepare("UPDATE quotes SET status='accepted', updated_at=datetime('now') WHERE id=?").run(q.id);
      syncChangeRequestWithQuote(ctx, { ...q, status: 'accepted' }, q.status, user(req).id);
      linkInvoiceToChangeRequest(ctx, one('SELECT * FROM invoices WHERE id=?', invoiceId) as Row, user(req).id);
      return invoiceId;
    })();
    ctx.audit(user(req), 'convert', 'quotes', q.id, `${q.number} → invoice`, req.ip);
    res.json({ invoice_id: id });
  });

  /* ---------- change request → quotation ---------- */
  router.post('/change-requests/:id/quote', founderOnly, (req: Request, res: Response) => {
    const cr = one('SELECT cr.*, p.name AS project_name FROM change_requests cr JOIN projects p ON p.id=cr.project_id WHERE cr.id=?', req.params.id);
    if (!cr) throw notFound('Change request not found');
    need(cr.billable, 'This change request is marked as not billable, so there is nothing to quote.');
    need(cr.estimate_amount > 0, 'Enter the estimated amount first.');
    need(['requested', 'estimated', 'quoted'].includes(cr.status), `A change request that is ${String(cr.status).replace(/_/g, ' ')} cannot be quoted.`);
    const open = one("SELECT number FROM quotes WHERE change_request_id=? AND status IN ('draft','sent','accepted')", cr.id);
    if (open) throw conflict(`Quotation ${open.number} already exists for this change request. Edit it, or reject / delete it first.`);
    need(cr.client_id, 'The project has no client yet.');
    const item = { description: `${cr.title}${cr.estimate_hours > 0 ? ` (about ${cr.estimate_hours} hours)` : ''}`, hsn: '', qty: 1, rate: cr.estimate_amount };
    const quote = engine.create('quotes', {
      user: user(req), ip: req.ip,
      body: { client_id: cr.client_id, project_id: cr.project_id, change_request_id: cr.id, title: `Change request ${`CR-${String(cr.id).padStart(4, '0')}`}: ${cr.title}`, items: [item],
        notes: cr.description ?? null },
    });
    res.status(201).json({ quote_id: quote.id, number: quote.number });
  });

  /* ---------- subscriptions: roll the renewal date forward by hand (items that debit themselves do not need this) ---------- */
  router.post('/renewals/:id/renew', founderOnly, (req: Request, res: Response) => {
    const r = one('SELECT * FROM renewals WHERE id=?', req.params.id);
    if (!r) throw notFound('Not found');
    const step = CYCLE_MONTHS[r.cycle as string];
    need(step, 'This item has a one-time cycle and cannot be renewed automatically.');
    const next = addMonths(r.renewal_date || today(), step as number);
    db.prepare("UPDATE renewals SET renewal_date=?, status='active' WHERE id=?").run(next, r.id);
    ctx.audit(user(req), 'renew', 'renewals', r.id, `${r.name} → ${next}`, req.ip);
    res.json({ renewal_date: next });
  });

  /* ---------- contact log: every call / WhatsApp / visit … on every lead, newest first, paged ---------- */
  function contactLog(req: Request, everything: boolean): { rows: Row[]; total: number } {
    if (!hasFlag(user(req), 'leads')) throw forbidden();
    const where = ["n.entity_type='lead'", "n.kind NOT IN ('system','history')"];
    const p: unknown[] = [];
    const leadId = intOrNull(req.query.lead_id);
    const userId = intOrNull(req.query.user_id);
    if (leadId) { where.push('n.entity_id=?'); p.push(leadId); }
    if (userId) { where.push('n.user_id=?'); p.push(userId); }
    if (typeof req.query.from === 'string' && validDate(req.query.from)) { where.push('date(n.created_at)>=?'); p.push(req.query.from); }
    if (typeof req.query.to === 'string' && validDate(req.query.to)) { where.push('date(n.created_at)<=?'); p.push(req.query.to); }
    if (typeof req.query.kind === 'string' && /^[a-z]{2,12}$/.test(req.query.kind)) { where.push('n.kind=?'); p.push(req.query.kind); }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q) { where.push("(n.body LIKE ? ESCAPE '\\' OR l.company LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(like, like, like); }
    const limit = everything ? 100_000 : Math.min(Math.max(intOrNull(req.query.limit) ?? 50, 1), 500);
    const offset = everything ? 0 : Math.max(intOrNull(req.query.offset) ?? 0, 0);
    const from = `FROM notes n JOIN leads l ON l.id=n.entity_id LEFT JOIN users u ON u.id=n.user_id WHERE ${where.join(' AND ')}`;
    return {
      total: (one(`SELECT COUNT(*) n ${from}`, ...p) as { n: number }).n,
      rows: all(`SELECT n.id, date(n.created_at) AS contact_date, n.entity_id AS lead_id, COALESCE(l.company, l.name) AS company, n.kind, n.followup_round, n.body, n.next_followup,
        u.name AS user_name ${from} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset),
    };
  }
  router.get('/contact-log', (req: Request, res: Response) => {
    const r = contactLog(req, false);
    res.setHeader('X-Total-Count', String(r.total));
    res.json(r.rows);
  });
  for (const fmt of ['xlsx', 'pdf'] as const) {
    router.get(`/contact-log/export.${fmt}`, async (req: Request, res: Response) => {
      const rows = contactLog(req, true).rows.map((r) => ({ ...r, outcome: r.body, body: undefined })) as Row[];
      const out = fmt === 'xlsx' ? await toXlsx('Contact log', rows) : await toPdf('Contact log', 'contact_log', rows);
      res.setHeader('Content-Type', fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="contact-log-${today()}.${fmt}"`);
      res.send(out);
    });
  }

  /* ---------- bank statement lines: match to income / expenses (same amount, within 5 days) ---------- */
  router.post('/bank-match', founderOnly, (req: Request, res: Response) => {
    let matched = 0;
    db.transaction(() => {
      for (const b of all("SELECT * FROM bank_transactions WHERE matched_status='Unmatched' ORDER BY date")) {
        if (b.deposit > 0) {
          const p = one(`SELECT pm.id, pm.date, c.company FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id WHERE ABS(pm.amount-?)<0.01 AND ABS(julianday(pm.date)-julianday(?))<=5
            AND pm.id NOT IN (SELECT payment_id FROM bank_transactions WHERE payment_id IS NOT NULL) ORDER BY ABS(julianday(pm.date)-julianday(?)) LIMIT 1`, b.deposit, b.date, b.date);
          if (p) {
            db.prepare("UPDATE bank_transactions SET matched_status='Matched', payment_id=?, match_note=? WHERE id=?").run(p.id, `Income on ${p.date}${p.company ? ` from ${p.company}` : ''}`, b.id);
            matched++;
          }
        } else if (b.withdrawal > 0) {
          const e = one(`SELECT id, date, COALESCE(vendor, category) who FROM expenses WHERE status='paid' AND paid_by_id IS NULL AND ABS(amount-?)<0.01 AND ABS(julianday(date)-julianday(?))<=5
            AND id NOT IN (SELECT expense_id FROM bank_transactions WHERE expense_id IS NOT NULL) ORDER BY ABS(julianday(date)-julianday(?)) LIMIT 1`, b.withdrawal, b.date, b.date);
          if (e) {
            db.prepare("UPDATE bank_transactions SET matched_status='Matched', expense_id=?, match_note=? WHERE id=?").run(e.id, `Expense on ${e.date}${e.who ? ` — ${e.who}` : ''}`, b.id);
            matched++;
          }
        }
      }
    })();
    ctx.audit(user(req), 'update', 'bank_transactions', null, `Auto-matched ${matched}`, req.ip);
    res.json({ matched, unmatched: (one("SELECT COUNT(*) n FROM bank_transactions WHERE matched_status='Unmatched'") as { n: number }).n });
  });

  void HttpError;
  return router;
}
