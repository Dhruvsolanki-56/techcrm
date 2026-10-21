/** Local-calendar date helpers (YYYY-MM-DD strings), used by server jobs, analytics and the screens. */

const pad = (n: number): string => String(n).padStart(2, '0');

export const toISO = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const asDate = (s: string): Date => new Date(`${String(s).slice(0, 10)}T00:00:00`);

export const today = (): string => toISO(new Date());

export function addDays(s: string, n: number): string {
  const d = asDate(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Same day of the month N months on (the 31st becomes the last day of a shorter month). */
export function addMonths(s: string, n: number, day?: number): string {
  const d = asDate(s);
  const want = day ?? d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toISO(d);
}

export const daysUntil = (s: string, from: string = today()): number => Math.round((asDate(s).getTime() - asDate(from).getTime()) / 86_400_000);

/** The first day of the month N months from `from` ("2026-10"). */
export function monthKey(offset: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The last N month keys ending with the current month, oldest first. */
export const lastMonths = (n: number, from: Date = new Date()): string[] => Array.from({ length: n }, (_, i) => monthKey(i - (n - 1), from));

/** Months a billing cycle spans (null for one-time). */
export const CYCLE_MONTHS: Record<string, number | null> = {
  monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12, biennial: 24, triennial: 36, 'one-time': null,
};

/** Indian financial year (1 April – 31 March) of a date, e.g. 2026-10-14 → "2026-27". */
export function fyOf(date: string): string {
  const d = asDate(date);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
/** First and last day of a financial year given as "2026-27". */
export function fyRange(fy: string): { from: string; to: string } {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}
/** Assessment year in which a financial year's income and TDS are declared: "2026-27" → "2027-28". */
export function assessmentYear(fy: string): string {
  const y = Number(fy.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
export const TDS_STATUSES: [string, string][] = [
  ['deducted', 'Deducted — certificate awaited'],
  ['certificate', 'Certificate (Form 16A) received'],
  ['claimed', 'Claimed in ITR'],
];

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-01-21 → 21 Jan 2026: the one way dates are written for people, everywhere. Anything that is not a date is returned as it came. */
export const dmy = (s: unknown): string => {
  const str = String(s ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return String(s ?? '');
  const m = MONTH_ABBR[Number(str.slice(5, 7)) - 1];
  return m ? `${str.slice(8, 10)} ${m} ${str.slice(0, 4)}` : str;
};

/** 13:30 → 01:30 PM */
export const clock12 = (h: number, m: number): string => `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;

/** A moment as people read it: 21 Jan 2026, 01:30 PM. Database stamps (no zone) are UTC; they are shown in the viewer's own time. */
export function dmyTime(s: unknown): string {
  if (!s) return '';
  const raw = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return dmy(raw); // a plain date has no time of day
  const d = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return `${dmy(toISO(d))}, ${clock12(d.getHours(), d.getMinutes())}`;
}

const MONTH_BY_NAME: Record<string, number> = Object.fromEntries(MONTH_ABBR.map((m, i) => [m.toLowerCase(), i + 1]));
/**
 * What a person types for a date → 2026-01-21, or null. Accepts "21 Jan 2026", "21-01-2026", "21/1/26", "21012026", "21 january 2026".
 * `strict` (while typing) wants a four-digit year so "21 Jan 20" is not taken as 2020 half-way through "2026".
 */
export function parseDate(text: string, strict = false): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let d: number; let mo: number; let y: number;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; } else if ((m = /^(\d{1,2})[\s\-/.]*([a-z]{3,9})[\s\-/.]*(\d{2}|\d{4})$/.exec(t))) {
    const mon = MONTH_BY_NAME[m[2]!.slice(0, 3)];
    if (!mon) return null;
    d = +m[1]!; mo = mon; y = +m[3]!;
    if (m[3]!.length === 2) { if (strict) return null; y += 2000; }
  } else if ((m = /^(\d{1,2})[\s\-/.](\d{1,2})[\s\-/.](\d{2}|\d{4})$/.exec(t)) || (m = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) {
    d = +m[1]!; mo = +m[2]!; y = +m[3]!;
    if (m[3]!.length === 2) { if (strict) return null; y += 2000; }
  } else return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const chk = new Date(Date.UTC(y, mo - 1, d));
  return chk.getUTCFullYear() === y && chk.getUTCMonth() === mo - 1 && chk.getUTCDate() === d && y >= 1990 && y <= 2100 ? iso : null;
}
