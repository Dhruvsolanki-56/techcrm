import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { refOf } from '../src/crud/refs';
import { hashPassword, passwordProblem, verifyPassword } from '../src/security/password';
import { base32, checkTotp, hotp, unbase32 } from '../src/security/totp';
import { createLoginLimiter } from '../src/security/loginLimiter';
import { normalizeItems } from '../src/domain/billing';
import { matchUser } from '../src/domain/people';
import { fixSwappedDates, toDate, toMoney, table } from '../src/seed/parse';
import { tidyLeads } from '../src/seed/tidy';

describe('configuration', () => {
  it('reads defaults and rejects invalid values with a readable message', () => {
    const c = loadConfig({ NODE_ENV: 'production', CRM_DATA_DIR: '/tmp/x' } as NodeJS.ProcessEnv);
    expect(c.port).toBe(3000);
    expect(c.jobs).toBe(true);
    expect(c.logLevel).toBe('info');
    expect(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).jobs).toBe(false);
    expect(() => loadConfig({ PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ CRM_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/at least 16/);
    expect(loadConfig({ SESSION_HOURS: '2' } as NodeJS.ProcessEnv).sessionMs).toBe(7_200_000);
  });
});

describe('passwords', () => {
  it('hashes with a fresh salt and verifies', () => {
    const h = hashPassword('Correct-horse-9');
    expect(h).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(hashPassword('Correct-horse-9')).not.toBe(h);
    expect(verifyPassword('Correct-horse-9', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
  it('explains what is wrong with a weak password', () => {
    expect(passwordProblem('short1')).toMatch(/at least 10/);
    expect(passwordProblem('onlyletterspassword')).toMatch(/letters and numbers/);
    expect(passwordProblem('1234567890123')).toMatch(/letters and numbers/);
    expect(passwordProblem('x'.repeat(201) + '1')).toMatch(/too long/);
    expect(passwordProblem('Good-password-1')).toBeNull();
  });
});

describe('two-step login codes (RFC 6238)', () => {
  it('matches the published SHA-1 test vector', () => {
    const key = Buffer.from('12345678901234567890');
    expect(hotp(key, 1)).toBe('287082'); // RFC 4226 appendix D
    expect(hotp(key, 9)).toBe('520489');
  });
  it('round-trips base32 and refuses replays and far-away codes', () => {
    const raw = Buffer.from('hello world 1234');
    expect(unbase32(base32(raw)).toString()).toBe('hello world 1234');
    const secret = base32(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    const code = hotp(unbase32(secret), step);
    expect(checkTotp(secret, code, 0, now)).toBe(step);
    expect(checkTotp(secret, code, step, now)).toBeNull(); // already used
    expect(checkTotp(secret, code, 0, now + 5 * 60_000)).toBeNull(); // too old
    expect(checkTotp(secret, '12ab56', 0, now)).toBeNull();
  });
});

describe('login limiter', () => {
  it('blocks after 8 failures for one account and 30 for one address, and recovers after the window', () => {
    let t = 0;
    const l = createLoginLimiter(() => t);
    for (let i = 0; i < 8; i++) l.record('1.1.1.1', 'a@x', false);
    expect(l.tooMany('1.1.1.1', 'a@x')).toBe(true);
    expect(l.tooMany('2.2.2.2', 'a@x')).toBe(false);
    t += 16 * 60_000;
    expect(l.tooMany('1.1.1.1', 'a@x')).toBe(false);
    for (let i = 0; i < 30; i++) l.record('3.3.3.3', `u${i}@x`, false);
    expect(l.tooMany('3.3.3.3', 'new@x')).toBe(true);
    l.sweep();
  });
});

describe('system IDs', () => {
  it('are built from the table and the record number', () => {
    expect(refOf('leads', { id: 12 })).toBe('LD-0012');
    expect(refOf('expenses', { id: 4 })).toBe('EXP-0004');
    expect(refOf('projects', { id: 3, code: 'P-26-003' })).toBe('P-26-003');
    expect(refOf('invoices', { id: 3, number: 'INV/2026-27/0001' })).toBe('INV/2026-27/0001');
    expect(refOf('change_requests', { id: 7 })).toBe('CR-0007');
    expect(refOf('settings', { id: 1 })).toBeNull();
  });
});

describe('quote / invoice lines', () => {
  it('accepts clean lines and explains each mistake', () => {
    expect(normalizeItems([{ description: 'Work', qty: 2, rate: 100 }])).toEqual([{ description: 'Work', hsn: '', qty: 2, rate: 100 }]);
    expect(normalizeItems('[{"description":"A","qty":1,"rate":5}]')).toHaveLength(1);
    expect(normalizeItems('not json')).toEqual([]);
    expect(() => normalizeItems([{ description: 'Work', qty: 0, rate: 1 }])).toThrow(/quantity/);
    expect(() => normalizeItems([{ description: 'Work', qty: 1, rate: -1 }])).toThrow(/negative/);
    expect(() => normalizeItems([{ description: '', qty: 1, rate: 1 }])).toThrow(/description/);
  });
});

describe('matching people by name', () => {
  const users = [{ id: 1, name: 'Ashwin Solanki' }, { id: 2, name: 'Vansh Balyan' }, { id: 3, name: 'Dhruv Solanki' }];
  it('matches a full name, or a first name only one person has', () => {
    expect(matchUser(users, 'Vansh Balyan')?.id).toBe(2);
    expect(matchUser(users, 'vansh')?.id).toBe(2);
    expect(matchUser(users, 'Solanki')).toBeNull();
    expect(matchUser([...users, { id: 4, name: 'Vansh Other' }], 'Vansh')).toBeNull(); // two Vanshes: ambiguous
  });
});

describe('reading the workbook values', () => {
  it('reads dates written the Indian way and money with lakh grouping', () => {
    expect(toDate('18/02/2026')).toBe('2026-02-18');
    expect(toDate('2026-08-30')).toBe('2026-08-30');
    expect(toDate('30-Aug-2026')).toBe('2026-08-30');
    expect(toDate('03/08.2026')).toBe('2026-08-03');
    expect(toDate('46264')).toBe('2026-08-30');
    expect(toDate('31/02/2026')).toBeNull();
    expect(toDate('call me')).toBeNull();
    expect(toMoney('1,50,000.00')).toBe(150000);
    expect(toMoney('₹ 2,399')).toBe(2399);
  });
  it('puts back dates a month-first spreadsheet swapped, using the rows around them', () => {
    const rows = [{ d: '27/03/2026' }, { d: '2026-07-04' }, { d: '13/05/2026' }, { d: '2026-02-07' }, { d: '31/07/2026' }];
    const n = fixSwappedDates(rows, 'd', '2026-10-14');
    expect(rows.map((r) => r.d)).toEqual(['27/03/2026', '2026-04-07', '13/05/2026', '2026-07-02', '31/07/2026']);
    expect(n).toBe(2);
    const plain = [{ d: '2026-07-04' }, { d: '2026-08-02' }]; // no day-first text dates: nothing is guessed
    expect(fixSwappedDates(plain, 'd', '2026-10-14')).toBe(0);
  });
  it('finds a table by its headings and refuses a changed layout', () => {
    const sheet = { name: 'T', rows: [['Title'], ['Lead ID', 'Company / Person'], ['1', 'A'], ['', '']] };
    expect(table(sheet, 'Lead ID', 'Company / Person')).toEqual([{ _row: '3', leadid: '1', companyperson: 'A' }]);
    expect(() => table(sheet, 'Nope')).toThrow(/expected headings/);
  });
});

describe('tidying lead text', () => {
  it('fixes capitals, phones, emails and country slips', () => {
    const rows = [{ leadid: '34', companyperson: 'SINGH ENTERPRISES', contactperson: 'Ekyot Singh', phonewhatsapp: '9619134047; 9820070228', email: 'A@x.com; b@x.com', city: 'Mumbai', country: 'India', market: 'India', notes: '' }];
    const log: Record<string, number> = {};
    tidyLeads(rows, log);
    expect(rows[0]).toMatchObject({ companyperson: 'Singh Enterprises', phonewhatsapp: '+91 96191 34047', email: 'a@x.com' });
    expect(rows[0]?.notes).toBe('Alternate phone number: +91 98200 70228\nAlternate email: b@x.com');
    const kenya = [{ leadid: '98', companyperson: 'SCOPE KENYA', contactperson: 'Dr. Maina', phonewhatsapp: '', email: '', city: 'Kenya', country: 'India', market: 'India', notes: '' }];
    tidyLeads(kenya, log);
    expect(kenya[0]).toMatchObject({ companyperson: 'SCOPE Kenya', city: '', country: 'Kenya', market: 'Foreign' });
  });
});
