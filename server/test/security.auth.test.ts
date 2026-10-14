import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hotp, unbase32 } from '../src/security/totp';
import { createDemo, type Demo } from './demo';
import { PASSWORD as PW } from './helpers';
import { makeLogin, makeRaw, newIp } from './raw';

let d: Demo;
let raw: ReturnType<typeof makeRaw>;
let login: ReturnType<typeof makeLogin>;
const db = () => d.app.ctx.db;
beforeAll(async () => {
  d = await createDemo({ TRUST_PROXY: '1' });
  raw = makeRaw(d.app);
  login = makeLogin(d.app);
});
afterAll(() => d.app.close());

describe('Authentication', () => {
  it('gives the same answer for an unknown email and a wrong password (no account enumeration)', async () => {
    const wrong = await login('aarav@demo.test', 'not-the-password-1');
    const unknown = await login('nobody@demo.test', 'not-the-password-1');
    expect(wrong.s).toBe(401);
    expect(unknown.s).toBe(401);
    expect(wrong.j.error).toBe(unknown.j.error);
    expect(wrong.cookie === '' || wrong.cookie === 'crm_session=').toBe(true);
  });
  it('takes about as long for an unknown email as for a wrong password (timing)', async () => {
    const time = async (email: string): Promise<number> => {
      const t: number[] = [];
      for (let i = 0; i < 7; i++) {
        const s = process.hrtime.bigint();
        await login(email, 'not-the-password-1');
        t.push(Number(process.hrtime.bigint() - s) / 1e6);
      }
      return t.sort((a, b) => a - b)[3] as number; // the median: other test files hash passwords in parallel and add noise
    };
    const known = await time('aarav@demo.test');
    const unknown = await time('ghost@demo.test');
    expect(unknown).toBeGreaterThan(known * 0.3);
  });
  it('sets an HttpOnly, SameSite=Lax session cookie, Secure only behind https', async () => {
    const c = d.F as unknown as { status: number };
    expect(c.status).toBe(200);
    const plain = await login('aarav@demo.test');
    expect(plain.h['set-cookie']).toMatch(/HttpOnly/);
    expect(plain.h['set-cookie']).toMatch(/SameSite=Lax/);
    expect(plain.h['set-cookie']).toMatch(/Path=\//);
    expect(plain.h['set-cookie']).not.toMatch(/Secure/);
    const https = await raw('POST', '/auth/login', { body: { email: 'meera@demo.test', password: PW }, ip: newIp(), headers: { 'X-Forwarded-Proto': 'https' } });
    expect(https.h['set-cookie']).toMatch(/; Secure/);
    expect(https.h['strict-transport-security']).toMatch(/max-age/i);
  });
  it('uses a 256-bit random token and stores only its hash', async () => {
    const f = await login('aarav@demo.test');
    const token = f.cookie.split('=')[1] as string;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(db().prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(token)).toBeUndefined();
  });
  it('rejects forged, malformed and missing cookies', async () => {
    expect((await raw('GET', '/me', { cookie: `crm_session=${'a'.repeat(64)}` })).s).toBe(401);
    expect((await raw('GET', '/me', { cookie: 'crm_session=%E0%A4%A' })).s).toBe(401);
    expect((await raw('GET', '/me')).s).toBe(401);
  });
  it('closes the setup endpoint once a founder exists', async () => {
    expect((await raw('POST', '/auth/setup', { body: { name: 'x', email: 'x@x.test', password: 'Abcdefghij12' } })).s).toBe(400);
  });
  it('really ends a session on logout and on expiry', async () => {
    const l = await login('rohan@demo.test');
    await l.call('POST', '/auth/logout');
    expect((await l.call('GET', '/me')).s).toBe(401);
    const e = await login('isha@demo.test');
    db().prepare('UPDATE sessions SET expires_at=1 WHERE user_id=(SELECT id FROM users WHERE email=?)').run('isha@demo.test');
    expect((await e.call('GET', '/me')).s).toBe(401);
  });
  it('stores passwords as salted scrypt hashes and nothing readable in the database file', () => {
    const hash = (db().prepare("SELECT password_hash FROM users WHERE email='aarav@demo.test'").get() as { password_hash: string }).password_hash;
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain(PW);
    db().pragma('wal_checkpoint(TRUNCATE)');
    const bytes = fs.readFileSync(path.join(d.app.dir, 'crm.db'));
    expect(bytes.includes(Buffer.from(PW))).toBe(false);
    expect(bytes.includes(Buffer.from('Demo!cPanel#2026'))).toBe(false);
  });
});

describe('Brute-force protection', () => {
  it('blocks the 9th try on one account for 15 minutes, even with the right password', async () => {
    const ip = newIp();
    for (let i = 0; i < 8; i++) await login('meera@demo.test', `guess-number-${i}`, { ip });
    expect((await login('meera@demo.test', PW, { ip })).s).toBe(429);
    expect((await login('meera@demo.test', PW)).s).toBe(200); // the real user from another network
  });
  it('blocks password spraying across many emails from one IP', async () => {
    const ip = newIp();
    let blocked = false;
    for (let i = 0; i < 32 && !blocked; i++) blocked = (await login(`spray${i}@demo.test`, 'Password123', { ip })).s === 429;
    expect(blocked).toBe(true);
  });
});

describe('Password rules & sessions', () => {
  it('enforces strength, difference and the current password; signs out other devices', async () => {
    const P1 = await login('rohan@demo.test');
    const P2 = await login('rohan@demo.test');
    expect((await P1.call('POST', '/password', { current: PW, next: 'short1' })).s).toBe(400);
    expect((await P1.call('POST', '/password', { current: PW, next: PW })).s).toBe(400);
    expect((await P1.call('POST', '/password', { current: 'wrong', next: 'Brand-new-pass-77' })).s).toBe(400);
    expect((await P1.call('POST', '/password', { current: PW, next: 'Brand-new-pass-77' })).s).toBe(200);
    expect((await P2.call('GET', '/me')).s).toBe(401);
    expect((await P1.call('GET', '/me')).s).toBe(200);
  });
  it('refuses everything except the profile until a temporary password is replaced (server side)', async () => {
    const made = await d.F.post('/users', { name: 'Temp Intern', email: 'temp@demo.test', password: 'Temp-pass-123', role: 'intern' });
    const TI = await login('temp@demo.test', 'Temp-pass-123');
    const blocked = await TI.call('GET', '/tasks');
    expect(blocked.s).toBe(403);
    expect(blocked.j.code).toBe('password_change_required');
    expect((await TI.call('GET', '/me')).s).toBe(200);
    await TI.call('POST', '/password', { current: 'Temp-pass-123', next: 'My-own-pass-456' });
    expect((await TI.call('GET', '/tasks')).s).toBe(200);
    expect((await d.F.put(`/users/${made.j.id}`, { modules: 'leads' })).s).toBe(200); // malformed modules do not crash
  });
});

describe('Two-step login (TOTP)', () => {
  it('sets up, enforces and resets two-step login without replay', async () => {
    const M = await login('meera@demo.test');
    expect((await M.call('POST', '/2fa/setup', { password: 'wrong' })).s).toBe(400);
    const setup = await M.call('POST', '/2fa/setup', { password: PW });
    expect(setup.s).toBe(200);
    expect(setup.j.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.j.uri.startsWith('otpauth://totp/')).toBe(true);
    const stored = (db().prepare("SELECT totp_secret FROM users WHERE email='meera@demo.test'").get() as { totp_secret: string }).totp_secret;
    expect(stored.includes(setup.j.secret)).toBe(false);
    expect((await M.call('POST', '/2fa/enable', { code: '000000' })).s).toBe(400);
    const codeNow = (): string => hotp(unbase32(setup.j.secret), Math.floor(Date.now() / 30000));
    const M2 = await login('meera@demo.test');
    const enableCode = codeNow(); // one value: a 30 s step can roll over mid-test
    expect((await M.call('POST', '/2fa/enable', { code: enableCode })).s).toBe(200);
    expect((await M2.call('GET', '/me')).s).toBe(401);
    expect((await M.call('GET', '/me')).s).toBe(200);
    const noCode = await login('meera@demo.test');
    expect(noCode.s).toBe(401);
    expect(noCode.j.need_code).toBe(true);
    expect(noCode.cookie.includes('crm_session=')).toBe(false);
    expect((await login('meera@demo.test', PW, { code: '123456' })).s).toBe(401);
    expect((await login('meera@demo.test', 'bad-password-9', { code: codeNow() })).s).toBe(401);
    expect((await login('meera@demo.test', PW, { code: enableCode })).s).toBe(401); // the enabling code cannot be replayed
    db().prepare("UPDATE users SET totp_last=0 WHERE email='meera@demo.test'").run();
    const one = codeNow();
    expect((await login('meera@demo.test', PW, { code: one })).s).toBe(200);
    expect((await login('meera@demo.test', PW, { code: one })).s).toBe(401);
    const meeraId = (db().prepare("SELECT id FROM users WHERE email='meera@demo.test'").get() as { id: number }).id;
    expect((await d.K.put(`/users/${meeraId}`, { reset_2fa: true })).s).toBe(403);
    expect((await d.F.put(`/users/${meeraId}`, { reset_2fa: true })).s).toBe(200);
    expect((await login('meera@demo.test')).s).toBe(200);
    expect((db().prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('2fa_on','2fa_reset')").get() as { n: number }).n).toBe(2);
  });
});

describe('CSRF', () => {
  it('refuses state-changing requests without the custom header, or with a wrong one', async () => {
    const f = await login('aarav@demo.test');
    expect((await raw('POST', '/tasks', { body: { title: 'csrf' }, cookie: f.cookie, noCsrf: true })).s).toBe(403);
    expect((await raw('POST', '/credentials', { cookie: f.cookie, noCsrf: true, rawBody: true, body: 'label=x&client_id=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).s).toBe(403);
    expect((await raw('DELETE', '/tasks/1', { cookie: f.cookie, noCsrf: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })).s).toBe(403);
    expect(db().prepare("SELECT 1 FROM tasks WHERE title='csrf'").get()).toBeUndefined();
  });
});
