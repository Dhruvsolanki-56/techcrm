import { addDays, parseDate, today } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime, fmtMonth, initials, pct, plural, relDay } from '../src/lib/format';

describe('formatting helpers', () => {
  it('reads what people type as a date', () => {
    for (const t of ['21 Jan 2026', '21-01-2026', '21/1/2026', '21012026', '21 january 2026', '2026-01-21', '21-Jan-26']) expect(parseDate(t), t).toBe('2026-01-21');
    expect(parseDate('21 Jan 20', true)).toBeNull();
    for (const t of ['31 Feb 2026', '32-01-2026', 'abc', '21 Foo 2026', '']) expect(parseDate(t), t).toBeNull();
  });
  it('writes every date as 21 Jan 2026 and every moment as 21 Jan 2026, 01:30 PM', () => {
    expect(fmtDate('2026-08-30')).toBe('30 Aug 2026');
    expect(fmtDate('2026-01-05 10:00:00')).toBe('05 Jan 2026');
    expect(fmtDateTime(new Date(2026, 0, 21, 13, 30).toISOString())).toBe('21 Jan 2026, 01:30 PM');
    expect(fmtDateTime(new Date(2026, 0, 21, 0, 5).toISOString())).toBe('21 Jan 2026, 12:05 AM');
    expect(fmtDateTime('2026-01-21 00:05:00+05:30').endsWith('AM') || fmtDateTime('2026-01-21 00:05:00+05:30').endsWith('PM')).toBe(true);
    expect(fmtDateTime('2026-01-21')).toBe('21 Jan 2026');
    expect(fmtDate(null)).toBe('—');
    expect(fmtMonth('2026-03')).toBe('Mar 26');
  });
  it('says how far away a day is', () => {
    expect(relDay(today())).toBe('today');
    expect(relDay(addDays(today(), 1))).toBe('tomorrow');
    expect(relDay(addDays(today(), -1))).toBe('yesterday');
    expect(relDay(addDays(today(), 5))).toBe('in 5 days');
    expect(relDay(addDays(today(), -4))).toBe('4 days ago');
    expect(relDay('')).toBe('');
  });
  it('makes initials, percentages and plurals', () => {
    expect(initials('Ashwin Solanki')).toBe('AS');
    expect(initials('  prince ')).toBe('P');
    expect(initials(null)).toBe('?');
    expect(pct(1, 3)).toBe(33);
    expect(pct(1, 0)).toBe(0);
    expect(plural(1, 'lead')).toBe('1 lead');
    expect(plural(3, 'lead')).toBe('3 leads');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });
});
