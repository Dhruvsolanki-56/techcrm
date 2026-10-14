import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';

const dirs: string[] = [];
const tmp = (): Database.Database => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-mig-'));
  dirs.push(dir);
  const db = new Database(path.join(dir, 'crm.db'));
  db.pragma('foreign_keys = ON');
  return db;
};
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const tableNames = (db: Database.Database): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
const cols = (db: Database.Database, t: string): string[] => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

describe('database migrations', () => {
  it('build a complete schema on an empty database and record every migration', () => {
    const db = tmp();
    const applied = migrate(db);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.id));
    for (const t of ['users', 'leads', 'clients', 'projects', 'tasks', 'quotes', 'invoices', 'payments', 'expenses', 'renewals', 'change_requests', 'schema_migrations', 'task_checklist', 'bank_transactions', 'assets']) expect(tableNames(db)).toContain(t);
    expect(cols(db, 'renewals')).toEqual(expect.arrayContaining(['auto_debit', 'pay_account_id', 'last_debited', 'amount_varies']));
    expect(cols(db, 'expenses')).toEqual(expect.arrayContaining(['renewal_id', 'is_estimate']));
    expect(cols(db, 'quotes')).toContain('change_request_id');
    expect(db.pragma('foreign_key_check')).toHaveLength(0);
    db.close();
  });
  it('are safe to run again (nothing happens the second time)', () => {
    const db = tmp();
    migrate(db);
    expect(migrate(db)).toEqual([]);
    db.close();
  });
  it('upgrade a database created by the previous version of the app without losing a single row', () => {
    const db = tmp();
    db.exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-schema.sql'), 'utf8'));
    expect(tableNames(db)).not.toContain('change_requests');
    const before = ['users', 'clients', 'projects', 'leads', 'renewals'].map((t) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n);
    expect(before).toEqual([1, 1, 1, 1, 1]);
    const applied = migrate(db);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.id));
    const after = ['users', 'clients', 'projects', 'leads', 'renewals'].map((t) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n);
    expect(after).toEqual(before);
    expect(db.prepare("SELECT name, auto_debit, amount_varies FROM renewals").get()).toEqual({ name: 'Legacy sub', auto_debit: 1, amount_varies: 0 });
    expect(tableNames(db)).toContain('change_requests');
    expect(db.pragma('foreign_key_check')).toHaveLength(0);
    // the new features work on the upgraded data
    db.prepare("INSERT INTO change_requests(project_id, client_id, title) VALUES(1, 1, 'First CR')").run();
    expect((db.prepare('SELECT COUNT(*) n FROM change_requests').get() as { n: number }).n).toBe(1);
    db.close();
  });
  it('have strictly increasing, unique ids', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});
