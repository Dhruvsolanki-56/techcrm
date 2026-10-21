/** Money: always rounded to 2 decimals, always shown with ₹ and Indian digit grouping (1,00,000). */

export const round2 = (n: number | string | null | undefined): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: unknown): string => inr.format(Number(n) || 0);
export const money2 = (n: unknown): string => inr2.format(Number(n) || 0);

/** 1.8 L, 45k, 2.5 Cr — compact axis / tile labels. */
export function compact(n: unknown): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const trim = (x: number): string => x.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e7) return `${trim(v / 1e7)} Cr`;
  if (a >= 1e5) return `${trim(v / 1e5)} L`;
  if (a >= 1e3) return `${trim(v / 1e3)}k`;
  return String(Math.round(v));
}

export interface LineItem {
  description: string;
  qty: number;
  rate: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
}

/** An invoice or quotation total: the lines less the discount. (There is no GST in this company, so no tax is ever added.) */
export function computeTotals(items: LineItem[], discount: number): Totals {
  const subtotal = round2(items.reduce((s, it) => s + it.qty * it.rate, 0));
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  return { subtotal, discount: round2(disc), tax_amount: 0, total: round2(subtotal - disc) };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number): string => (n < 20 ? (ONES[n] as string) : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n: number): string => (n > 99 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : '') + (n % 100 ? two(n % 100) : '');
function words(n: number): string {
  if (n === 0) return 'Zero';
  const parts: [number, string][] = [[Math.floor(n / 1e7), 'Crore'], [Math.floor(n / 1e5) % 100, 'Lakh'], [Math.floor(n / 1e3) % 100, 'Thousand']];
  return parts.filter(([v]) => v).map(([v, w]) => `${two(v)} ${w}`).concat(n % 1000 ? [three(n % 1000)] : []).join(' ');
}
/** 118000.5 → "Rupees One Lakh Eighteen Thousand and Fifty Paise Only" (Indian numbering). */
export function inWords(amount: number): string {
  const total = Math.round((Number(amount) || 0) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  return `Rupees ${words(rupees)}${paise ? ` and ${words(paise)} Paise` : ''} Only`;
}

/** TDS a client will deduct from a billed amount at a given rate. */
export const tdsOf = (amount: number, percent: number): number => round2((Number(amount) * Number(percent || 0)) / 100);

/**
 * What to put on an invoice so it is only for money we will really receive: the amount less the TDS the client deducts.
 * Every line is scaled by the same ratio (the last line takes the rounding), so the lines still add up to the net total.
 */
export function netOfTds<T extends { qty: number; rate: number }>(items: T[], percent: number): { items: T[]; gross: number; tds: number; net: number } {
  const gross = round2(items.reduce((s, i) => s + i.qty * i.rate, 0));
  const tds = tdsOf(gross, percent);
  if (!(percent > 0) || !items.length) return { items, gross, tds: 0, net: gross };
  const net = round2(gross - tds);
  let left = net;
  const out = items.map((it, i) => {
    const last = i === items.length - 1;
    const line = last ? left : round2((it.qty * it.rate * (1 - percent / 100)));
    left = round2(left - line);
    return { ...it, rate: it.qty ? round2(line / it.qty) : line };
  });
  return { items: out, gross, tds, net };
}

/** Splits an agreed value by percentages; the last part takes the rounding so the parts always add up to the value. */
export function splitByPercent(value: number, percents: number[]): number[] {
  let left = round2(value);
  return percents.map((p, i) => {
    const amount = i === percents.length - 1 ? left : round2((value * p) / 100);
    left = round2(left - amount);
    return amount;
  });
}
