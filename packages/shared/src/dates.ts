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
