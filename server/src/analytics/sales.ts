import { addDays, CLOSED_STAGES, round2, STAGE_PROB, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import type { Engine } from '../crud/engine';
import type { User } from '../security/permissions';

type Lead = Row;
const isOpen = (l: Lead): boolean => !(CLOSED_STAGES as readonly string[]).includes(l.stage);
const pct = (a: number, b: number): number => (b ? Math.round((1000 * a) / b) / 10 : 0);

/** The numbers the team's sheet showed on its Dashboard / Dept / Source / Monthly tabs, plus what a sales lead needs on top. */
export function salesAnalytics(ctx: AppContext, engine: Engine, user: User, query: { year?: string } = {}): Row {
  const leads = engine.list('leads', user, { all: true }).rows as Lead[];
  const t = today();
  const in7 = addDays(t, 7);
  const sum = (arr: Lead[], f: (l: Lead) => number): number => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));

  const block = (arr: Lead[]) => {
    const open = arr.filter(isOpen);
    const won = arr.filter((l) => l.stage === 'won');
    return {
      leads: arr.length, open: open.length, converted: won.length, lost: arr.filter((l) => l.stage === 'lost' || l.stage === 'closed').length,
      conversion: pct(won.length, arr.length), hot: open.filter((l) => l.priority === 'hot').length, hot_all: arr.filter((l) => l.priority === 'hot').length,
      india: arr.filter((l) => l.market === 'India').length, foreign: arr.filter((l) => l.market === 'Foreign').length,
      pipeline: sum(open, (l) => l.value), weighted: sum(open, (l) => (l.value * (STAGE_PROB[l.stage] || 0)) / 100), won_value: sum(won, (l) => l.value),
      overdue: open.filter((l) => l.next_followup && l.next_followup < t).length, due_today: open.filter((l) => l.next_followup === t).length,
      next_7: open.filter((l) => l.next_followup && l.next_followup > t && l.next_followup <= in7).length, no_date: open.filter((l) => !l.next_followup).length,
    };
  };
  const group = (key: string, fallback: string) => {
    const m = new Map<string, Lead[]>();
    for (const l of leads) {
      const k = (l[key] as string) || fallback;
      if (!m.has(k)) m.set(k, []);
      (m.get(k) as Lead[]).push(l);
    }
    return [...m].map(([name, arr]) => ({ name, ...(key === 'department' ? { side: arr.find((x) => x.business_side)?.business_side ?? null } : {}), ...block(arr) })).sort((a, b) => b.leads - a.leads);
  };

  // Monthly Analytics: a calendar year (like the sheet's "Analysis Year"), or the last 12 months
  const years = [...new Set(leads.map((l) => String(l.created_at).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort();
  const year = /^\d{4}$/.test(query.year ?? '') ? (query.year as string) : null;
  const months: string[] = [];
  if (year) for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, '0')}`);
  else for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const monthly = months.map((mo) => {
    const added = leads.filter((l) => String(l.created_at).slice(0, 7) === mo);
    const won = leads.filter((l) => l.stage === 'won' && String(l.closed_on || '').slice(0, 7) === mo);
    const fu = leads.filter((l) => isOpen(l) && String(l.next_followup || '').slice(0, 7) === mo);
    return {
      month: mo, added: added.length, converted: won.length, lost: leads.filter((l) => ['lost', 'closed'].includes(l.stage) && String(l.closed_on || '').slice(0, 7) === mo).length,
      india_converted: won.filter((l) => l.market === 'India').length, foreign_converted: won.filter((l) => l.market === 'Foreign').length, conversion: pct(won.length, added.length),
      value_added: sum(added, (l) => l.value), won_value: sum(won, (l) => l.value), followups_scheduled: fu.length, overdue: fu.filter((l) => l.next_followup < t).length,
    };
  });

  // how long a deal takes from first entry to conversion (only leads with both dates)
  const cycles = leads.filter((l) => l.stage === 'won' && l.closed_on).map((l) => (new Date(l.closed_on).getTime() - new Date(String(l.created_at).slice(0, 10)).getTime()) / 86_400_000).filter((d) => d >= 0);
  const stageOrder = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'negotiation', 'accepted', 'won'];
  const funnel = stageOrder.map((s) => {
    const arr = leads.filter((l) => l.stage === s);
    return { stage: s, count: arr.length, value: sum(arr, (l) => l.value) };
  });
  // quotations sent to leads that are still open: the deals closest to money
  const quotes = ctx.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM quotes WHERE status IN ('sent','draft') AND lead_id IS NOT NULL").get() as { n: number; v: number };

  return {
    today: t, total: block(leads), by_market: group('market', 'Not set'), by_side: group('business_side', 'Not set'), by_department: group('department', 'Not set'),
    by_category: group('category', 'Not set'), by_source: group('source', 'Not set'), by_owner: group('owner_name', 'Unassigned'), by_stage: group('stage', 'new'),
    by_priority: group('priority', 'Not set'), monthly, year, years, funnel,
    sales_cycle_days: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    open_quotes: quotes,
    follow_up_queue: leads.filter((l) => isOpen(l) && l.next_followup && l.next_followup <= in7).sort((a, b) => a.next_followup.localeCompare(b.next_followup)).slice(0, 15)
      .map((l) => ({ id: l.id, ref: l.ref, name: l.name, company: l.company, stage: l.stage, priority: l.priority, next_followup: l.next_followup, owner_name: l.owner_name, next_action: l.next_action })),
  };
}
