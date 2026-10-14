// Prints every contrast / a11y problem axe finds on the given paths. Usage: node e2e/axe-report.mjs <base> <email> <password> <path...>
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const [base, email, password, ...paths] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(base);
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await page.click('button.primary');
await page.waitForSelector('.side');
for (const p of paths) {
  await page.goto(base + p);
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  console.log('==', p);
  for (const v of r.violations) {
    console.log(`${v.impact} ${v.id}: ${v.nodes.length}`);
    for (const n of v.nodes.slice(0, 6)) console.log('   ', n.target.join(' '), '|', (n.any[0]?.data && JSON.stringify(n.any[0].data)) || '', '|', n.html.slice(0, 90));
  }
}
await browser.close();
