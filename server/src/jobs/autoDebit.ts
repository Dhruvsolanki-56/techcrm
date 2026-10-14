import { addMonths, CYCLE_MONTHS, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';

const CATEGORY_BY_KIND: Record<string, string> = {
  subscription: 'Software/SaaS', email: 'Software/SaaS', hosting: 'Hosting/Cloud', domain: 'Hosting/Cloud', ssl: 'Hosting/Cloud', bill: 'Telecom & Utilities', amc: 'Other', other: 'Other',
};

export interface Debit {
  renewal: string;
  date: string;
  amount: number;
  estimate: boolean;
}

/**
 * Recurring expenses that debit themselves.
 *
 * A subscription / hosting / domain / bill with "Debit automatically" ticked gets its expense recorded on the renewal date,
 * from the account chosen on the item, and the renewal date moves on by one cycle. Days missed while the server was off are caught up.
 * Each debit is stamped with the renewal and date (unique index), so running this twice can never record the same payment twice.
 *
 * A bill whose amount changes every month (a postpaid phone bill) is recorded as a PENDING ESTIMATE based on the last real bill,
 * and the founders are asked to enter the actual amount; until then it is not counted as money spent.
 */
export function runAutoDebits(ctx: AppContext, now: string = today()): Debit[] {
  const { db } = ctx;
  const done: Debit[] = [];
  const categories = ctx.settings.get().expense_categories.split('\n').map((x) => x.trim()).filter(Boolean);
  const insert = db.prepare(`INSERT OR IGNORE INTO expenses(date,category,vendor,description,amount,account_id,method,status,notes,project_id,client_id,renewal_id,is_estimate)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const lastReal = db.prepare("SELECT amount FROM expenses WHERE renewal_id=? AND status='paid' AND is_estimate=0 ORDER BY date DESC, id DESC LIMIT 1");
  const due = db.prepare("SELECT * FROM renewals WHERE status='active' AND auto_debit=1 AND our_cost>0 AND renewal_date IS NOT NULL AND renewal_date<=?").all(now) as Row[];
  const founders = db.prepare("SELECT id FROM users WHERE role='founder' AND active=1").all() as { id: number }[];
  const defaultAccount = (): number | null =>
    ((db.prepare("SELECT id FROM accounts WHERE active=1 ORDER BY CASE type WHEN 'bank' THEN 0 ELSE 1 END, id LIMIT 1").get() as { id: number } | undefined)?.id) ?? null;

  for (const r of due) {
    const step = CYCLE_MONTHS[r.cycle as string];
    if (!step) continue; // a one-time item has no "next" date to roll to
    const account = r.pay_account_id || defaultAccount();
    const day = new Date(`${r.renewal_date}T00:00:00`).getDate();
    const varies = !!r.amount_varies;
    db.transaction(() => {
      let date: string = r.renewal_date;
      let guard = 0;
      let n = 0;
      while (date <= now && guard++ < 36) {
        const amount = varies ? ((lastReal.get(r.id) as { amount: number } | undefined)?.amount ?? r.our_cost) : r.our_cost;
        const res = insert.run(
          date, categories.includes(r.category) ? r.category : CATEGORY_BY_KIND[r.kind as string] ?? 'Other', r.vendor || r.name,
          `${r.name} — ${varies ? 'bill (estimate, enter the real amount)' : 'automatic debit'}`, amount, account, 'Auto-debit', varies ? 'pending' : 'paid',
          varies ? `Estimated from the last bill. Open this expense and enter the actual amount of the "${r.name}" bill.` : `Recorded automatically from the recurring item "${r.name}" (${r.cycle}).`,
          r.project_id, r.client_id, r.id, varies ? 1 : 0,
        );
        if (res.changes) {
          n++;
          done.push({ renewal: r.name, date, amount, estimate: varies });
        }
        date = addMonths(date, step, day);
      }
      db.prepare('UPDATE renewals SET renewal_date=?, last_debited=? WHERE id=?').run(date, n ? now : r.last_debited, r.id);
      if (n) {
        ctx.audit(null, 'create', 'expenses', null, `${r.name}: ${n} ${varies ? 'estimated bill' : 'automatic debit'}${n === 1 ? '' : 's'}`, 'auto-debit');
        const text = varies
          ? `Bill due: ${r.name} — enter the actual amount (estimate ₹${Number(r.our_cost).toLocaleString('en-IN')})`
          : `Auto-debit recorded: ${r.name} ₹${Number(r.our_cost).toLocaleString('en-IN')}${n > 1 ? ` × ${n}` : ''}`;
        for (const f of founders) ctx.notify(f.id, text, '/finance?tab=expenses');
      }
    })();
  }
  return done;
}
