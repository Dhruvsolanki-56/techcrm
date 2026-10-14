import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const EMAIL = 'founder@e2e.test';
const PASSWORD = 'E2e-Password-2026';

test.describe.configure({ mode: 'serial' });

// one browser session for the whole story: sign up once, then work as that person
let page: Page;
test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });
test.afterAll(async () => { await page.context().close(); });

async function api(method: 'POST' | 'PUT' | 'DELETE' | 'GET', url: string, data?: unknown) {
  const res = await page.request.fetch(`/api${url}`, { method, data, headers: { 'X-Requested-With': 'crm' } });
  expect(res.status(), `${method} ${url}`).toBeLessThan(400);
  return res.json().catch(() => ({}));
}

test('first-time setup creates the founder account and opens Home', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await page.getByLabel('Company name').fill('E2E Works LLP');
  await page.getByLabel('Your name').fill('Esha Founder');
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Esha/ })).toBeVisible();
  await expect(page.locator('.side')).toContainText('E2E Works LLP');
});

test('sign out, wrong password is refused, then sign in again', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: /Esha Founder/ }).click();
  await page.getByText('Sign out').click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
});

test('lead → contact log → convert to client with a project', async () => {
  await page.goto('/leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  await page.getByLabel('Company / Person').fill('Sunrise Dental Clinic');
  await page.getByLabel('Contact Person').fill('Dr Meera Shah');
  await page.getByLabel('Phone / WhatsApp').fill('+91 98765 43210');
  await page.getByLabel('Deal Value (INR)').fill('120000');
  await page.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.locator('.toast', { hasText: 'Lead created' }).first()).toBeVisible();

  await page.getByText('Sunrise Dental Clinic').first().click();
  await expect(page).toHaveURL(/\/leads\/\d+/);
  await expect(page.locator('.ref-chip')).toContainText('LD-');
  await page.getByRole('button', { name: 'Log contact' }).click();
  await page.getByLabel('Outcome').fill('Spoke to the doctor — wants a booking website');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast', { hasText: 'next follow-up' }).first()).toBeVisible();
  await page.getByText('Spoke to the doctor').first().waitFor();

  await page.getByRole('button', { name: 'Convert to client' }).click();
  await page.getByPlaceholder(/Sunrise Dental Clinic/).fill('Sunrise Dental Website');
  await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
  await expect(page).toHaveURL(/\/projects\/\d+/);
  await expect(page.getByRole('heading', { name: /Sunrise Dental Website/ })).toBeVisible();
  await expect(page.locator('.ref-chip')).toContainText('P-');
});

test('change request → quotation → accepted → invoice → payment, all linked', async () => {
  await page.goto('/projects');
  await page.getByText('Sunrise Dental Website').first().click();
  await page.getByRole('button', { name: 'Change request' }).first().click();
  await page.getByLabel('What the client wants').fill('Add online appointment booking');
  await page.getByLabel('Estimated hours').fill('20');
  await page.getByLabel('Estimated price').fill('35000');
  await page.getByRole('button', { name: 'Create change request' }).click();
  await expect(page.locator('.toast', { hasText: 'created' }).first()).toBeVisible();

  await page.getByRole('tab', { name: /Change requests/ }).click();
  await page.getByText('Add online appointment booking').first().click();
  await page.getByRole('button', { name: 'Create quotation' }).click();
  await expect(page).toHaveURL(/\/quotes\/\d+/);
  await expect(page.locator('.sheet')).toContainText('Add online appointment booking');
  await page.getByRole('button', { name: 'Mark as sent' }).click();
  await page.getByRole('button', { name: 'Accepted', exact: true }).click();
  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await expect(page).toHaveURL(/\/invoices\/\d+/);
  await expect(page.locator('.sheet')).toContainText('Add online appointment booking');
  await page.getByRole('button', { name: 'Mark as sent' }).click();
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create payment' }).click();
  await expect(page.locator('.toast', { hasText: 'Payment created' }).first()).toBeVisible();
  await expect(page.locator('.stamp')).toContainText('PAID');

  // the change request now shows the whole chain
  await page.goto('/change-requests?view=list');
  await page.getByText('Add online appointment booking').first().click();
  await expect(page.getByRole('dialog')).toContainText('Paid');
  await page.keyboard.press('Escape');

  // project value includes the change request
  await page.goto('/projects');
  await expect(page.locator('tbody')).toContainText('₹35,000');
});

test('edit and delete records, with system IDs', async () => {
  await page.goto('/finance?tab=expenses');
  await page.getByRole('button', { name: 'Record expense' }).click();
  await page.getByLabel('Amount').first().fill('1250');
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Vendor').fill('Namecheap');
  await page.getByRole('button', { name: 'Create expense' }).click();
  await expect(page.locator('.toast', { hasText: 'Expense created' }).first()).toBeVisible();
  const row = page.locator('tbody tr', { hasText: 'Namecheap' });
  await expect(row).toContainText('EXP-');
  await row.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Vendor').fill('Namecheap Inc');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('tbody tr', { hasText: 'Namecheap Inc' })).toBeVisible();
  await page.locator('tbody tr', { hasText: 'Namecheap Inc' }).getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Are you sure?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('tbody tr', { hasText: 'Namecheap Inc' })).toHaveCount(0);
});

test('lists are paged by the server and searchable', async () => {
  const tag = (i: number) => `${String.fromCharCode(65 + Math.floor(i / 6))}${String.fromCharCode(65 + (i % 6))}`; // letters only: names cannot hold digits
  for (let i = 1; i <= 30; i++) await api('POST', '/leads', { company: `Bulk Lead ${tag(i)}`, name: `Person ${tag(i)}`, stage: 'new' });
  await page.goto('/leads?view=list');
  await expect(page.locator('.tbl-foot')).toContainText('1–25 of');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.tbl-foot')).toContainText('Page 2');
  await page.getByRole('searchbox', { name: 'Search leads' }).fill('Bulk Lead BB');
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('command palette finds records and jumps to them', async () => {
  await page.goto('/dashboard');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search clients/).fill('Sunrise');
  await expect(page.locator('.pal-i').filter({ hasText: 'Sunrise Dental' }).first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/(clients|leads|projects)\/\d+/);
});

test('dashboard analytics tabs render with numbers', async () => {
  await page.goto('/dashboard?tab=finance');
  await expect(page.getByText('Income, 12 months')).toBeVisible();
  await page.goto('/dashboard?tab=delivery');
  await expect(page.getByText('Open change requests').first()).toBeVisible();
  await page.goto('/dashboard?tab=sales');
  await expect(page.getByText('Open pipeline').first()).toBeVisible();
});

test('mobile layout: menu opens, no sideways scrolling', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/dashboard', '/leads?view=list', '/projects', '/finance', '/invoices']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${url} overflows`).toBeLessThanOrEqual(2);
  }
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.side a', { hasText: 'Clients' }).click();
  await expect(page).toHaveURL(/\/clients/);
});

test('accessibility: no serious or critical violations on key screens', async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const url of ['/dashboard', '/leads?view=list', '/projects', '/invoices', '/finance']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} on ${url}`), JSON.stringify(bad.map((v) => v.nodes[0]?.html))).toEqual([]);
  }
});
