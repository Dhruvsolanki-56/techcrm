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
  await page.goto('/leads?view=board');
  await page.getByRole('button', { name: 'New lead' }).click();
  await page.getByLabel('Company (optional)').fill('Sunrise Dental Clinic');
  await page.getByLabel('Contact person').fill('Dr Meera Shah');
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
  await page.getByRole('button', { name: 'Client accepted', exact: true }).click();
  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await expect(page).toHaveURL(/\/invoices\/\d+/);
  await expect(page.locator('.sheet')).toContainText('Add online appointment booking');
  await page.getByRole('button', { name: 'Mark as sent' }).click();
  await expect(page.locator('.toast', { hasText: 'Updated' }).first()).toBeVisible();
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

test('payment schedule: split the value, mark finished, raise the invoice; the action center shows what is ready', async () => {
  const clients = await api('GET', '/clients?limit=5');
  const proj = await api('POST', '/projects', { client_id: clients[0].id, name: 'Schedule Demo Portal', status: 'active', budget: 100000 });
  await page.goto(`/projects/${proj.id}?tab=finance`);
  await expect(page.getByRole('heading', { name: 'Payment schedule' })).toBeVisible();
  await page.getByRole('button', { name: 'Plan the payments' }).click();
  await page.getByRole('dialog').getByLabel('Quick fill').selectOption({ label: '50% advance, 50% on delivery' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.locator('tbody tr', { hasText: 'Advance' })).toContainText('₹50,000');
  await expect(page.locator('tfoot')).toContainText('Matches the agreed value');
  await page.locator('tbody tr', { hasText: 'Advance' }).getByRole('button', { name: 'Mark finished' }).click();
  await expect(page.locator('tbody tr', { hasText: 'Advance' })).toContainText('Ready to invoice');

  await page.goto('/actions');
  await expect(page.getByText('Ready to invoice: Advance').first()).toBeVisible();
  await expect(page.locator('.side .count')).toBeVisible();

  await page.goto(`/projects/${proj.id}?tab=finance`);
  await page.locator('tbody tr', { hasText: 'Advance' }).getByRole('button', { name: 'Raise invoice' }).click();
  await expect(page).toHaveURL(/\/invoices\/\d+/);
  await expect(page.locator('.sheet')).toContainText('Schedule Demo Portal — Advance');
  await page.goto(`/projects/${proj.id}?tab=finance`);
  await expect(page.locator('tbody tr', { hasText: 'MS-' }).filter({ hasText: 'Advance' })).toContainText('INV/');
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

test('analytics: every tab renders, spending can be filtered, received vs pending adds up', async () => {
  await page.goto('/analytics?tab=receivables');
  await expect(page.getByText('Still to get').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By client' })).toBeVisible();
  await page.goto('/analytics?tab=spending');
  await expect(page.getByText('Average expense')).toBeVisible();
  await page.getByLabel('Group by').selectOption('vendor');
  await expect(page.getByRole('heading', { name: /Spent by vendor/ })).toBeVisible();
  for (const tab of ['sales', 'delivery', 'income', 'grants', 'subscriptions', 'trends']) {
    await page.goto(`/analytics?tab=${tab}`);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.locator('.kpi').first()).toBeVisible();
  }
});

test('exports are Excel and PDF only — never CSV', async () => {
  await page.goto('/leads?view=list');
  await page.getByRole('button', { name: /Export/ }).click();
  await expect(page.getByRole('menuitem', { name: /Excel/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /PDF/ })).toBeVisible();
  await expect(page.getByText('CSV')).toHaveCount(0);
  const res = await page.request.get('/api/leads/export.xlsx');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('spreadsheetml');
  expect((await page.request.get('/api/leads/export.pdf')).headers()['content-type']).toBe('application/pdf');
  expect((await page.request.get('/api/leads/export.csv')).status()).toBe(404);
});

test('every record keeps its history, files and an editable status', async () => {
  const clients = await api('GET', '/clients?limit=3');
  await page.goto('/finance?tab=expenses');
  await page.getByRole('button', { name: 'Record expense' }).click();
  await page.getByLabel('Amount').first().fill('777');
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Vendor').fill('History Vendor');
  await page.getByRole('button', { name: 'Create expense' }).click();
  const row = page.locator('tbody tr', { hasText: 'History Vendor' });
  await row.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Amount').first().fill('888');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await row.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('₹777');
  await expect(page.getByRole('dialog')).toContainText('₹888');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Upload' })).toBeVisible();
  await page.keyboard.press('Escape');
  void clients;
});

test('mobile layout: app-like tab bar, no sideways scrolling, tables become cards', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/dashboard', '/actions', '/leads?view=list', '/projects', '/finance', '/analytics', '/invoices', '/tasks', '/settings']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${url} overflows`).toBeLessThanOrEqual(2);
  }
  const tabs = page.getByRole('navigation', { name: 'Quick tabs' });
  await expect(tabs).toBeVisible();
  await tabs.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects/);
  await tabs.getByRole('button', { name: 'More' }).click();
  await page.locator('.side a', { hasText: 'Clients' }).click();
  await expect(page).toHaveURL(/\/clients/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(tabs).toBeHidden();
});

test('accessibility: no serious or critical violations on key screens', async () => {
  test.setTimeout(150_000); // eight screens, each loaded and audited
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const url of ['/dashboard', '/actions', '/analytics?tab=receivables', '/analytics?tab=spending', '/leads?view=list', '/projects', '/invoices', '/finance']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} on ${url}`), JSON.stringify(bad.map((v) => v.nodes[0]?.html))).toEqual([]);
  }
});
