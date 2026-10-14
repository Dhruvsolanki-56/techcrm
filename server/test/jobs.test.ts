import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyBackup, runReminders, startJobs } from '../src/jobs/scheduler';
import { createDemo, type Demo } from './demo';
import { ago, inn } from './helpers';

let d: Demo;
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());
const notifications = (email: string): { text: string; link: string }[] => {
  const id = (d.app.ctx.db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: number }).id;
  return d.app.ctx.db.prepare('SELECT text, link FROM notifications WHERE user_id=?').all(id) as { text: string; link: string }[];
};

describe('daily reminders', () => {
  it('tell people about overdue tasks, renewals, invoices, follow-ups and waiting change requests — once a day', async () => {
    await d.F.post('/change_requests', { project_id: d.proj.acme, title: 'Old unanswered request', requested_on: ago(5) });
    runReminders(d.app.ctx);
    const kabir = notifications('kabir@demo.test');
    expect(kabir.some((n) => /Overdue task: Write UAT checklist/.test(n.text))).toBe(true);
    const aarav = notifications('aarav@demo.test');
    expect(aarav.some((n) => /Renewal .*BrightPath shared hosting/.test(n.text))).toBe(true);
    expect(aarav.some((n) => /Invoice overdue: INV\//.test(n.text))).toBe(true);
    expect(aarav.some((n) => /Change request waiting for an estimate: Old unanswered request/.test(n.text))).toBe(true);
    expect(notifications('isha@demo.test').some((n) => /Follow up with lead: Rajesh Kumar/.test(n.text))).toBe(true);
    const count = notifications('kabir@demo.test').length;
    runReminders(d.app.ctx);
    expect(notifications('kabir@demo.test').length).toBe(count); // no duplicates the same day
  });
  it('does not nag about renewals that debit themselves', async () => {
    await d.F.post('/renewals', { name: 'Self-paying tool', kind: 'subscription', renewal_date: inn(3), cycle: 'monthly', our_cost: 100, auto_debit: true });
    runReminders(d.app.ctx);
    expect(notifications('aarav@demo.test').some((n) => /Self-paying tool/.test(n.text))).toBe(false);
  });
});

describe('backups and background jobs', () => {
  it('saves one database copy a day and keeps only the newest ones', async () => {
    const ctx = d.app.ctx;
    ctx.config.backupKeep = 2;
    for (const day of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.writeFileSync(path.join(ctx.config.backupDir, `auto-${day}.db`), 'old');
    await dailyBackup(ctx);
    await dailyBackup(ctx); // the second call the same day does nothing
    const files = fs.readdirSync(ctx.config.backupDir).filter((f) => f.startsWith('auto-')).sort();
    expect(files).toHaveLength(2);
    expect(files[1]).toBe(`auto-${new Date().toISOString().slice(0, 10)}.db`);
  });
  it('start and stop cleanly', async () => {
    const stop = startJobs(d.app.ctx);
    await new Promise((r) => setTimeout(r, 200));
    stop();
    expect(typeof stop).toBe('function');
  });
});
