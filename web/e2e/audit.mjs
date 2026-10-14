// Visits every screen as the signed-in founder and reports console errors, failed API calls and layout overflow. Usage: node e2e/audit.mjs <baseUrl> <email> <password> [outDir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [base, email, password, out] = process.argv.slice(2);
const routes = ['/dashboard', '/dashboard?tab=sales', '/dashboard?tab=delivery', '/dashboard?tab=finance', '/tasks', '/calendar', '/leads', '/leads?view=list', '/followups', '/contact-log', '/sales-report', '/clients', '/quotes', '/invoices', '/projects',
  '/change-requests', '/change-requests?view=list', '/maintenance', '/documents', '/renewals', '/grants', '/finance', '/finance?tab=payments', '/finance?tab=expenses', '/finance?tab=bank', '/finance?tab=accounts', '/assets', '/vault', '/team', '/settings', '/audit'];
const browser = await chromium.launch({ channel: 'msedge' });
const issues = [];
async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  let current = '';
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`[${tag}] ${current} console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => issues.push(`[${tag}] ${current} pageerror: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) issues.push(`[${tag}] ${current} HTTP ${r.status()} ${r.url().replace(base, '')}`); });
  await page.goto(base);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button.primary');
  await page.waitForSelector('.side', { timeout: 15000 });
  if (out) fs.mkdirSync(out, { recursive: true });
  const dyn = [];
  for (const r of routes) {
    current = r;
    await page.goto(base + r);
    await page.waitForSelector('#page', { timeout: 15000 }).catch(() => issues.push(`[${tag}] ${r} no #page`));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 2) issues.push(`[${tag}] ${r} horizontal overflow ${over}px`);
    const err = await page.locator('text=Something went wrong').count();
    if (err) issues.push(`[${tag}] ${r} error boundary shown`);
    if (out) await page.screenshot({ path: `${out}/${tag}${r.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
  }
  // detail pages: first row of lists
  for (const [list, sel] of [['/leads?view=list', 'tbody tr'], ['/clients', 'tbody tr'], ['/projects', 'tbody tr'], ['/invoices', 'tbody tr']]) {
    current = list;
    await page.goto(base + list);
    await page.waitForSelector(sel, { timeout: 10000 }).catch(() => {});
    const row = page.locator(sel).first();
    if (await row.count()) { await row.click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(300); dyn.push(page.url().replace(base, '')); }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 2) issues.push(`[${tag}] ${page.url().replace(base, '')} horizontal overflow ${over}px`);
    if (out) await page.screenshot({ path: `${out}/${tag}_detail${list.replace(/[^a-z0-9]+/gi, '_')}.png` });
  }
  console.log(tag, 'detail pages:', dyn.join(', '));
  await ctx.close();
}
await run({ width: 1440, height: 900 }, 'desktop');
await run({ width: 390, height: 844 }, 'mobile');
await browser.close();
console.log(issues.length ? issues.join('\n') : 'No issues found');
process.exit(issues.length ? 1 : 0);
