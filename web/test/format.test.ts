import { addDays, today } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { fmtDate, fmtMonth, initials, pct, plural, relDay } from '../src/lib/format';

describe('formatting helpers', () => {
  it('writes dates the way people say them', () => {
    expect(fmtDate('2026-08-30')).toBe('30 Aug 2026');
    expect(fmtDate('2026-08-30 10:00:00')).toBe('30 Aug 2026');
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
