import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, check, checkDates, compact, computeTotals, inWords, CR_TRANSITIONS, CR_STATUSES, daysUntil, kindFor, labelOf, lastMonths, LEAD_STAGES, money, normalize, round2, validDate, values,
} from '../src';

describe('field rules (shared by the browser and the API)', () => {
  it('accepts real names, rejects digits and symbols', () => {
    expect(check('person', "Anne-Marie D'Souza")).toBe('');
    expect(check('person', 'राहुल शर्मा')).toBe('');
    expect(check('person', 'Ravi 123')).toMatch(/letters/);
    expect(check('words', 'Pune / Mumbai (HQ)')).toBe('');
    expect(check('words', 'Pune 411001')).toMatch(/numbers/);
  });
  it('checks phones, emails, URLs and Indian tax numbers', () => {
    expect(check('phone', '+91 98765-43210')).toBe('');
    expect(check('phone', '12345')).toMatch(/phone number/);
    expect(check('phone', 'call later')).toMatch(/phone number/);
    expect(check('email', 'a@b.co')).toBe('');
    expect(check('email', 'ravi@')).toMatch(/valid email/);
    expect(check('url', 'site.co.in/path')).toBe('');
    expect(check('url', 'not a site')).toMatch(/web address/);
    expect(check('gstin', '27abcde1234f1z5')).toBe('');
    expect(check('gstin', '27ABCDE1234F1Z')).toMatch(/15 characters/);
    expect(check('pan', 'ABCDE1234F')).toBe('');
    expect(check('ifsc', 'HDFC0001234')).toBe('');
    expect(check('upi', 'name@bank')).toBe('');
    expect(check('upi', 'nope')).toMatch(/name@bank/);
  });
  it('checks numbers, limits and empty values', () => {
    expect(check('money', 10)).toBe('');
    expect(check('money', -1)).toMatch(/zero or more/);
    expect(check('money', 'abc')).toMatch(/number/);
    expect(check('money', 1e12)).toMatch(/too large/);
    expect(check('percent', 101)).toMatch(/0 and 100/);
    expect(check('hours', 5000)).toMatch(/1000/);
    expect(check('money', '')).toBe('');
    expect(check('nothing', 'x')).toBe('');
    expect(check('person', 'x'.repeat(81))).toMatch(/too long/);
  });
  it('knows which rule each resource field follows and normalises capitals', () => {
    expect(kindFor('clients', 'gstin')).toBe('gstin');
    expect(kindFor('leads', 'name')).toBe('words');
    expect(kindFor('change_requests', 'estimate_amount')).toBe('money');
    expect(kindFor('leads', 'unknown')).toBe('');
    expect(normalize('gstin', ' 27abcde1234f1z5 ')).toBe('27ABCDE1234F1Z5');
    expect(normalize('person', ' x ')).toBe(' x ');
  });
  it('validates real calendar dates and date order', () => {
    expect(validDate('2026-02-28')).toBe(true);
    expect(validDate('2026-02-30')).toBe(false);
    expect(validDate('2026-13-01')).toBe(false);
    expect(validDate('1980-01-01')).toBe(false);
    expect(validDate('not')).toBe(false);
    expect(checkDates('projects', { start_date: '2026-05-10', deadline: '2026-05-01' })).toMatch(/Deadline cannot be before/);
    expect(checkDates('projects', { start_date: '2026-05-01', deadline: '2026-05-10' })).toBe('');
    expect(checkDates('leads', {})).toBe('');
  });
});

describe('dates', () => {
  it('adds days and months without drifting', () => {
    expect(addDays('2026-10-14', 3)).toBe('2026-10-17');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31'); // keeps the original day of the month
    expect(addMonths('2026-12-12', 1)).toBe('2027-01-12');
    expect(daysUntil('2026-10-17', '2026-10-14')).toBe(3);
    expect(daysUntil('2026-10-10', '2026-10-14')).toBe(-4);
  });
  it('lists the last N months oldest first', () => {
    expect(lastMonths(3, new Date(2026, 0, 15))).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(lastMonths(12, new Date(2026, 9, 14))).toHaveLength(12);
  });
});

describe('money', () => {
  it('rounds to 2 decimals and prints Indian grouping with the rupee sign', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2('2.345')).toBe(2.35);
    expect(money(100000)).toBe('₹1,00,000');
    expect(money(342686.66)).toBe('₹3,42,687');
    expect(money(null)).toBe('₹0');
  });
  it('shortens big numbers to k, L and Cr', () => {
    expect(compact(999)).toBe('999');
    expect(compact(45000)).toBe('45k');
    expect(compact(180000)).toBe('1.8 L');
    expect(compact(25000000)).toBe('2.5 Cr');
    expect(compact(-150000)).toBe('-1.5 L');
  });
  it('writes amounts in words the Indian way', () => {
    expect(inWords(0)).toBe('Rupees Zero Only');
    expect(inWords(118000)).toBe('Rupees One Lakh Eighteen Thousand Only');
    expect(inWords(25000)).toBe('Rupees Twenty Five Thousand Only');
    expect(inWords(12345678.5)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only');
    expect(inWords(99.99)).toBe('Rupees Ninety Nine and Ninety Nine Paise Only');
  });
  it('totals a quote with discount and GST', () => {
    const items = [{ description: 'A', qty: 1, rate: 280000 }, { description: 'B', qty: 1, rate: 45000 }];
    expect(computeTotals(items, 0, 18, 'cgst_sgst')).toEqual({ subtotal: 325000, discount: 0, tax_amount: 58500, total: 383500 });
    expect(computeTotals(items, 25000, 18, 'igst').total).toBe(354000);
    expect(computeTotals(items, 0, 18, 'none').total).toBe(325000);
    expect(computeTotals(items, 999999, 18, 'none').total).toBe(0); // discount cannot exceed the subtotal
  });
});

describe('options and the change-request lifecycle', () => {
  it('has labels for every value', () => {
    expect(labelOf(LEAD_STAGES, 'won')).toBe('Converted');
    expect(labelOf(LEAD_STAGES, 'custom_thing')).toBe('Custom thing');
    expect(labelOf(LEAD_STAGES, null)).toBe('');
    expect(values(LEAD_STAGES)).toContain('negotiation');
  });
  it('only ever moves a change request along allowed steps, and every status can be reached', () => {
    const statuses = values(CR_STATUSES);
    for (const [from, to] of Object.entries(CR_TRANSITIONS)) {
      expect(statuses).toContain(from);
      for (const t of to) expect(statuses).toContain(t);
    }
    const reachable = new Set<string>(['requested']);
    for (let i = 0; i < statuses.length; i++) for (const s of [...reachable]) for (const t of CR_TRANSITIONS[s] ?? []) reachable.add(t);
    expect([...reachable].sort()).toEqual([...statuses].sort());
    expect(CR_TRANSITIONS.requested).not.toContain('delivered'); // nothing is delivered without being approved
  });
});
