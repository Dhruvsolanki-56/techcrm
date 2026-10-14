import { validDate } from '@crm/shared';
import type { Sheet } from './xlsx';

/** Lower-case letters and digits only: "Phone / WhatsApp" → "phonewhatsapp". Makes header matching forgiving. */
export const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const clean = (v: unknown, max = 300): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
export const sp = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

const isISO = (s: string): boolean => validDate(s); // strict: 2026-02-31 is not a date
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Reads a date written 2026-08-30, 30/08/2026 (day first, Indian style), 30-Aug-2026 or as a spreadsheet day number. */
export function toDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && isISO(s.slice(0, 10))) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const d = `${(m[3] as string).length === 2 ? '20' : ''}${m[3]}-${(m[2] as string).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`;
    return isISO(d) ? d : null;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})$/);
  if (m && MONTHS[(m[2] as string).toLowerCase()]) {
    const d = `${m[3]}-${String(MONTHS[(m[2] as string).toLowerCase()]).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`;
    return isISO(d) ? d : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) return new Date(Math.round((+s - 25569) * 86_400_000)).toISOString().slice(0, 10);
  return null;
}

/** "1,50,000.00" or "₹ 2,399" → 150000 / 2399. */
export const toMoney = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export type Record_ = Record<string, string>;

/** Finds the heading row (the first row holding every `need` heading) and returns the rows below as objects keyed by normalised heading. */
export function table(sheet: Sheet | undefined, ...need: string[]): Record_[] {
  if (!sheet) return [];
  const wanted = need.map(norm);
  const hi = sheet.rows.slice(0, 15).findIndex((r) => wanted.every((n) => r.some((c) => norm(c) === n)));
  if (hi < 0) throw new Error(`Sheet "${sheet.name}" does not have the expected headings (${need.join(', ')}). Was the layout changed?`);
  const head = (sheet.rows[hi] as string[]).map(norm);
  return sheet.rows.slice(hi + 1).filter((r) => r.some((c) => String(c ?? '').trim())).map((r, n) => {
    const o: Record_ = { _row: String(hi + n + 2) };
    head.forEach((h, i) => { if (h && !(h in o)) o[h] = String(r[i] ?? '').trim(); });
    return o;
  });
}

/**
 * Dates typed day-first (12/08/2026) in a month-first spreadsheet: values like 18/08/2026 stay text, but 12/08/2026 is stored as the date
 * 8 Dec and shows as 2026-12-08. A tab with text dates whose day is above 12 proves it was typed day-first, so each date-cell with day ≤ 12 is
 * either right or has day and month swapped. The rows are in the order they were entered, so the reading that fits between the dates around it
 * (and is not in the future) wins. Returns how many dates were changed.
 */
export function fixSwappedDates(rows: Record_[], key: string, now: string): number {
  const cell = (r: Record_): string => String(r[key] ?? '').trim();
  const text = (s: string) => s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!rows.some((r) => { const m = text(cell(r)); return m && +(m[1] as string) > 12 && +(m[2] as string) <= 12; })) return 0;
  const iso = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const swapOf = (s: string): string | null => {
    const [y, m, d] = s.split('-') as [string, string, string];
    return +d <= 12 && m !== d ? `${y}-${d}-${m}` : null;
  };
  const sure: (string | null)[] = rows.map((r) => (iso(cell(r)) && swapOf(cell(r)) ? null : toDate(cell(r))));
  const around = (i: number, step: number): string | null => {
    for (let j = i + step; j >= 0 && j < rows.length; j += step) if (sure[j]) return sure[j] as string;
    return null;
  };
  let changed = 0;
  let prev: string | null = null;
  rows.forEach((r, i) => {
    const s = cell(r);
    if (sure[i] || !iso(s) || !swapOf(s)) { prev = sure[i] || toDate(s) || prev; return; }
    const alt = swapOf(s) as string;
    const next = around(i, 1);
    const lo = prev || around(i, -1);
    const fits = [s, alt].filter((c) => c <= now && (!lo || c >= lo) && (!next || c <= next));
    const ref = new Date((lo || next) as string).getTime();
    const pick = fits.length === 1 ? (fits[0] as string)
      : fits.length > 1 ? [...fits].sort((a, b) => Math.abs(new Date(a).getTime() - ref) - Math.abs(new Date(b).getTime() - ref))[0] as string
        : (s > now ? alt : s);
    if (pick !== s) { r[key] = pick; changed++; }
    prev = pick;
  });
  return changed;
}
