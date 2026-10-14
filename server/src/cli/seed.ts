import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig } from '../config';
import { createContext } from '../core/context';
import { createLogger } from '../logger';
import { runSeed } from '../seed/load';

/**
 * Loads TechSentinals LLP's own data from the two workbooks in current_xls/ (see docs/seeding.md).
 *   npm run seed -- [--xls <folder>] [--dry-run] [--reset]
 * Environment: CRM_FOUNDER_EMAIL (Ashwin's login), CRM_SEED_PASSWORD (password for NEW team accounts).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (n: string): boolean => args.includes(n);
  const xi = args.indexOf('--xls');
  const config = loadConfig();
  const log = createLogger({ env: 'production', logLevel: 'warn' });
  const ctx = createContext(config, log);
  const xlsDir = xi >= 0 ? path.resolve(args[xi + 1] ?? '') : path.join(ROOT, 'current_xls');
  const dry = flag('--dry-run');
  const hadData = (ctx.db.prepare('SELECT (SELECT COUNT(*) FROM users)+(SELECT COUNT(*) FROM leads)+(SELECT COUNT(*) FROM payments) n').get() as { n: number }).n;
  if (hadData && !dry) {
    const file = path.join(config.backupDir, `before-seed-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
    fs.mkdirSync(config.backupDir, { recursive: true });
    await ctx.db.backup(file);
    console.log(`Backup saved: ${file}`);
  }
  console.log(`Reading workbooks from ${xlsDir}`);
  const r = runSeed(ctx, { xlsDir, dryRun: dry, reset: flag('--reset'), password: process.env.CRM_SEED_PASSWORD, founderEmail: process.env.CRM_FOUNDER_EMAIL });

  if (r.removed) console.log(`\nRemoved the earlier seed: ${Object.entries(r.removed).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(`\nLoaded${dry ? ' (preview — nothing saved)' : ''}:`);
  for (const [k, v] of Object.entries(r.sections)) console.log(`  ${k.replace(/_/g, ' ').padEnd(22)} ${String(v).padStart(4)}`);
  for (const w of r.warnings) console.log(`  note: ${w}`);
  if (r.corrections.length) { console.log('\nAgreed corrections applied:'); for (const c of new Set(r.corrections)) console.log(`  - ${c}`); }
  const tl = Object.entries(r.tidy);
  if (tl.length) console.log(`\nWording / data tidy-ups: ${tl.map(([k, v]) => `${v} × ${k}`).join('; ')}`);
  if (r.created.length) {
    console.log('\nLogins created:');
    for (const m of r.created) console.log(`  ${m.name.padEnd(18)} ${m.email.padEnd(34)} password: ${m.password}`);
    console.log('  The @techsentinals.local addresses are placeholders: change them under Team before these people sign in.');
  }
  if (dry) { console.log('\nDry run finished: nothing was saved.'); ctx.db.close(); return; }
  const bad = r.checks.filter((c) => !c.ok);
  console.log('\nChecks against the numbers the sheets show:');
  for (const c of r.checks) if (!c.ok || process.env.VERBOSE) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.what}: sheet ${c.sheet}  CRM ${c.app}${c.note ? `  (${c.note})` : ''}`);
  console.log(`  ${r.checks.length - bad.length} of ${r.checks.length} checks match${bad.length ? ` — ${bad.length} DIFFER (listed above)` : ''}.`);
  console.log(`\nIn the CRM now: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  ctx.db.close();
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e: Error) => { console.error(`\nSeed failed: ${e.message}`); process.exit(1); });
