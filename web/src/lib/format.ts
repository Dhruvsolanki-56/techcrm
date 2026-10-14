import { asDate, daysUntil, labelOf, money, today, type Option } from '@crm/shared';

export { money, labelOf, today };
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-08-30 → 30 Aug 2026 */
export function fmtDate(s: unknown): string {
  if (!s) return '—';
  const str = String(s).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return String(s);
  const d = asDate(str);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export const fmtMonth = (m: string): string => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(2, 4)}`;

/** "in 3 days", "today", "5 days ago" */
export function relDay(s: unknown): string {
  if (!s) return '';
  const n = daysUntil(String(s).slice(0, 10));
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function fmtDateTime(s: unknown): string {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') || String(s).includes('+') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const initials = (name: unknown): string =>
  String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

export const label = (list: readonly Option[], v: unknown): string => labelOf(list, v as string);
export const num = (v: unknown): number => Number(v) || 0;
export const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
