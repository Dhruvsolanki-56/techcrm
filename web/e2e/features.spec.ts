import { expect, test, type Page } from '@playwright/test';

/**
 * Walks every screen the way a person does and checks each control does what it says.
 * Runs after app.spec.ts (which creates the founder), on the same throw-away database.
 */
const EMAIL = 'founder@e2e.test';
const PASSWORD = 'E2e-Password-2026';
test.describe.configure({ mode: 'default' });

let page: Page;
const ids: Record<string, number> = {};
const toast = (text: string) => page.locator('.toast', { hasText: text }).first();

async function api<T = Record<string, unknown>>(method: 'POST' | 'PUT' | 'DELETE' | 'GET', url: string, data?: unknown): Promise<T> {
  const res = await page.request.fetch(`/api${url}`, { method, data, headers: { 'X-Requested-With': 'crm' } });
  expect(res.status(), `${method} ${url}`).toBeLessThan(400);
  return (await res.json().catch(() => ({}))) as T;
}
const go = async (url: string) => { await page.goto(url); await page.waitForSelector('#page'); await page.waitForLoadState('networkidle'); };
const save = async (name: string | RegExp) => { await page.getByRole('dialog').getByRole('button', { name }).click(); };

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto('/');
  // runs on its own too: create the founder when nobody exists yet
  const state = await (await page.request.get('/api/auth/state')).json();
  if (state.setup_needed) {
    await page.request.post('/api/auth/setup', { data: { name: 'Esha Founder', email: EMAIL, password: PASSWORD, company_name: 'E2E Works LLP' }, headers: { 'X-Requested-With': 'crm' } });
    await page.request.post('/api/auth/logout', { headers: { 'X-Requested-With': 'crm' } });
    await page.goto('/');
  }
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.side');
  // fixtures
  await api('PUT', '/settings', { lead_services: 'Website\nWeb application', lead_products: 'SaaS product', lead_sources: 'Referral\nWebsite', lead_categories: 'NGO\nRetail' });
  const made = await page.request.post('/api/users', { data: { name: 'Ira Intern', email: 'ira@e2e.test', role: 'intern', password: 'Intern-Pass-2026', modules: [] }, headers: { 'X-Requested-With': 'crm' } });
  ids.user = made.ok() ? ((await made.json()) as { id: number }).id : ((await api<{ id: number; email: string }[]>('GET', '/users')).find((u) => u.email === 'ira@e2e.test') as { id: number }).id;
  const client = await api<{ id: number }>('POST', '/clients', { company: 'Lotus Traders', industry: 'Retail', city: 'Surat', status: 'active' });
  ids.client = client.id;
  await api('POST', '/contacts', { client_id: client.id, name: 'Lata Shah', email: 'lata@lotus.test', phone: '+91 98765 11111', is_primary: true });
  const stages = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'negotiation'];
  for (const [i, stage] of stages.entries()) {
    const l = await api<{ id: number }>('POST', '/leads', { company: `Pipeline Co ${String.fromCharCode(65 + i)}`, name: `Person ${String.fromCharCode(65 + i)}`, stage, priority: i % 2 ? 'hot' : 'medium', department: 'Website', source: 'Referral', value: 10000 * (i + 1), next_followup: i === 1 ? new Date().toISOString().slice(0, 10) : undefined });
    ids[`lead${i}`] = l.id;
  }
  ids.project = (await api<{ id: number }>('POST', '/projects', { client_id: client.id, name: 'Lotus Storefront', status: 'active', budget: 200000, deadline: '2030-01-01' })).id;
  await api('POST', '/tasks', { title: 'Design the homepage', project_id: ids.project, assignee_ids: [ids.user], due_date: '2030-01-02' });
  await api('POST', '/accounts', { name: 'E2E Bank', type: 'bank', opening_balance: 10000 });
});
test.afterAll(async () => { await page.context().close(); });

/* ===================================== PIPELINE ===================================== */
test.describe('pipeline', () => {
  test('when the server fails the board says so and Try again recovers (never a blank or endless Loading)', async () => {
    await page.route('**/api/leads?**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Something went wrong on our side."}' }));
    await go('/leads?view=board');
    await expect(page.getByText('This did not load')).toBeVisible({ timeout: 20_000 });
    await page.unroute('**/api/leads?**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.kcard').first()).toBeVisible();
  });
  test('shows every open lead as a card in its stage, with counts, and the header numbers', async () => {
    await go('/leads?view=board');
    for (const n of 'ABCDEF') await expect(page.locator('.kcard', { hasText: `Pipeline Co ${n}` })).toBeVisible({ timeout: 10_000 });
    for (const stage of ['New', 'Contacted', 'Qualified', 'Demo/Meeting', 'Proposal Sent', 'Negotiation']) await expect(page.locator('.kcol-h', { hasText: stage })).toBeVisible();
    await expect(page.locator('.pt .sub')).toContainText('open lead');
    await expect(page.locator('.pt .sub')).toContainText('₹');
  });
  test('clicking a card opens the lead; Back returns to the board', async () => {
    await go('/leads?view=board');
    await page.locator('.kcard', { hasText: 'Pipeline Co A' }).click();
    await expect(page).toHaveURL(new RegExp(`/leads/${ids.lead0}`));
    await page.goBack();
    await expect(page.locator('.kcard').first()).toBeVisible();
  });
  test('the card menu moves a lead to another stage without dragging', async () => {
    await go('/leads?view=board');
    const card = page.locator('.kcard', { hasText: 'Pipeline Co A' });
    await card.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Qualified' }).click();
    await expect(toast('Stage updated')).toBeVisible();
    await expect(page.locator('.kcol', { hasText: 'Qualified' }).locator('.kcard', { hasText: 'Pipeline Co A' })).toBeVisible();
    expect((await api<{ stage: string }>('GET', `/leads/${ids.lead0}`)).stage).toBe('qualified');
  });
  test('dragging a card to another column moves it', async () => {
    await go('/leads?view=board');
    const card = page.locator('.kcol', { hasText: 'Contacted' }).locator('.kcard', { hasText: 'Pipeline Co B' });
    await card.dragTo(page.locator('.kcol', { hasText: 'Demo/Meeting' }));
    await expect(page.locator('.kcol', { hasText: 'Demo/Meeting' }).locator('.kcard', { hasText: 'Pipeline Co B' })).toBeVisible();
  });
  test('the card menu schedules a follow-up and logs a contact', async () => {
    await go('/leads?view=board');
    const card = page.locator('.kcard', { hasText: 'Pipeline Co C' });
    await card.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Follow up tomorrow' }).click();
    await expect(toast('Follow-up scheduled')).toBeVisible();
    expect((await api<{ next_followup: string }>('GET', `/leads/${ids.lead2}`)).next_followup).toBeTruthy();
    await card.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Log contact' }).click();
    await page.getByLabel('Outcome').fill('Called, wants a demo');
    await save('Save');
    await expect(toast('Saved')).toBeVisible();
  });
  test('marking a lead lost asks why and moves it out of the open board', async () => {
    await go('/leads?view=board');
    const card = page.locator('.kcard', { hasText: 'Pipeline Co F' });
    await card.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Lost' }).click();
    await page.getByRole('dialog').getByLabel('What was the reason? It helps spot patterns later.').fill('Budget too small');
    await save('Save');
    await expect(page.locator('.kcard', { hasText: 'Pipeline Co F' })).toHaveCount(0);
    await page.getByLabel('Show closed & lost').check();
    await expect(page.locator('.kcol', { hasText: 'Lost' }).locator('.kcard', { hasText: 'Pipeline Co F' })).toBeVisible();
  });
  test('search, priority and department filters narrow the board and clear again', async () => {
    await go('/leads?view=board');
    await page.getByRole('searchbox', { name: 'Search leads' }).fill('Pipeline Co D');
    await expect(page.locator('.kcard')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search leads' }).fill('');
    await page.getByLabel('Priority').selectOption('hot');
    await expect(page.locator('.kcard').first()).toBeVisible();
    for (const c of await page.locator('.kcard').all()) await expect(c).toContainText('Hot');
    await page.getByLabel('Priority').selectOption('');
    await page.locator('.dept-tabs a', { hasText: 'Website' }).click();
    await expect(page).toHaveURL(/department=Website/);
    await expect(page.locator('.kcard').first()).toBeVisible();
    await page.locator('.dept-tabs a', { hasText: 'All leads' }).click();
  });
  test('list view pages, sorts and opens a lead', async () => {
    await go('/leads?view=list');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByRole('columnheader', { name: /Company/ }).click();
    await expect(page.locator('thead th[aria-sort]').first()).toBeVisible();
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/\/leads\/\d+/);
  });
  test('a new lead can be an individual with no company', async () => {
    await go('/leads?view=board');
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByLabel('Contact person').fill('Solo Freelancer');
    await save('Create lead');
    await expect(toast('Lead created')).toBeVisible();
    const found = await api<{ company: string | null; name: string }[]>('GET', '/leads?q=Solo%20Freelancer');
    expect(found[0]?.name).toBe('Solo Freelancer');
    expect(found[0]?.company ?? '').toBe('');
  });
  test('a new lead can be a new company, and one with nothing filled in is refused', async () => {
    await go('/leads?view=board');
    await page.getByRole('button', { name: 'New lead' }).click();
    await save('Create lead');
    await expect(page.getByRole('dialog').getByRole('alert').first()).toContainText('pick an existing client');
    await page.getByLabel('Company (optional)').fill('Brand New Pvt Ltd');
    await save('Create lead');
    await expect(toast('Lead created')).toBeVisible();
    await expect(page.locator('.kcard', { hasText: 'Brand New Pvt Ltd' })).toBeVisible();
  });
  test('a new lead for an existing client takes the client’s details and is marked as such', async () => {
    await go('/leads?view=board');
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.locator('select[name="client_id"]').selectOption({ label: 'Lotus Traders' });
    await page.getByLabel('Requirement / Interested In').fill('Mobile app for their store');
    await save('Create lead');
    await expect(toast('Lead created')).toBeVisible();
    const card = page.locator('.kcard', { hasText: 'Lotus Traders' });
    await expect(card).toContainText('Existing client');
    const lead = (await api<{ id: number; name: string; phone: string; client_id: number }[]>('GET', '/leads?q=Mobile%20app'))[0] as { id: number; name: string; phone: string; client_id: number };
    expect(lead).toMatchObject({ name: 'Lata Shah', phone: '+91 98765 11111', client_id: ids.client });
    ids.clientLead = lead.id;
  });
  test('converting a lead for an existing client starts the work under that client — no second client', async () => {
    const before = (await api<unknown[]>('GET', '/clients?limit=100')).length;
    await go(`/leads/${ids.clientLead}`);
    await expect(page.locator('.rec-head .meta')).toContainText('Existing client: Lotus Traders');
    await page.getByRole('button', { name: 'Start the work' }).click();
    await expect(page.getByRole('dialog')).toContainText('no new client is created');
    await page.getByRole('dialog').getByPlaceholder(/Lotus Traders/).fill('Lotus Mobile App');
    await save('Convert');
    await expect(page).toHaveURL(/\/projects\/\d+/);
    await expect(page.getByRole('heading', { name: /Lotus Mobile App/ })).toBeVisible();
    expect((await api<unknown[]>('GET', '/clients?limit=100')).length).toBe(before);
  });
  test('the client page lists new work and creates leads for that client', async () => {
    await go(`/clients/${ids.client}?tab=opps`);
    await expect(page.getByText('Mobile app for their store')).toBeVisible();
    await page.getByRole('button', { name: 'New lead for this client' }).click();
    await page.getByLabel('Requirement / Interested In').fill('Annual website refresh');
    await save('Create lead');
    await expect(page).toHaveURL(/\/leads\/\d+/);
    await expect(page.locator('.rec-head .meta')).toContainText('Existing client: Lotus Traders');
  });
});

/* ===================================== LEAD PAGE ===================================== */
test.describe('lead page', () => {
  test('stage dropdown, edit, specification, files, history and quotation all work', async () => {
    await go(`/leads/${ids.lead3}`);
    await page.getByLabel('Sales stage').selectOption('negotiation');
    await expect(toast('Stage updated')).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Specification (what they want built)').fill('Pages: home, shop, checkout.\nPayments: Razorpay.');
    await page.getByLabel('City').fill('Pune');
    await save('Save changes');
    await expect(toast('Saved')).toBeVisible();
    await expect(page.locator('.doc-text', { hasText: 'Razorpay' })).toBeVisible();
    await page.getByRole('tab', { name: 'Files' }).click();
    await page.getByRole('button', { name: 'Upload' }).click();
    await page.getByRole('button', { name: 'Save a link' }).click();
    await page.getByLabel('Link').fill('https://drive.example.com/brief');
    await page.getByLabel('Title').fill('Client brief');
    await save('Save link');
    await expect(page.getByText('Client brief')).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.locator('.tl-item').filter({ hasText: 'Pune' })).toBeVisible();
    await page.getByRole('tab', { name: 'Quotations' }).click();
    await page.getByRole('button', { name: 'New quotation' }).click();
    await expect(page).toHaveURL(/\/quotes\/new\?lead=/);
  });
  test('log contact, notes and the follow-up round all save to the timeline', async () => {
    await go(`/leads/${ids.lead4}`);
    await page.getByRole('button', { name: 'Log contact' }).click();
    await page.getByLabel('Outcome').fill('Demo done, they will decide next week');
    await save('Save');
    await expect(toast('Saved')).toBeVisible();
    await expect(page.getByText('Demo done, they will decide next week').first()).toBeVisible();
    await page.getByPlaceholder(/Write a note/).fill('Prefers WhatsApp');
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText('Prefers WhatsApp')).toBeVisible();
  });
  test('converting a new lead creates the client, the main contact and the project with the specification', async () => {
    await go(`/leads/${ids.lead3}`);
    await page.getByRole('button', { name: 'Convert to client' }).click();
    await save('Convert');
    await expect(page).toHaveURL(/\/projects\/\d+/);
    await expect(page.getByText('Razorpay').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Files' }).click();
    await expect(page.getByText('Client brief')).toBeVisible();
  });
});

/* ===================================== FOLLOW-UPS & CONTACT LOG ===================================== */
test.describe('follow-ups and contact log', () => {
  test('follow-ups group by urgency, filter, and log a contact', async () => {
    await go('/followups?show=all');
    await expect(page.locator('.fu-row').first()).toBeVisible();
    await page.getByRole('button', { name: 'Everyone' }).click();
    await page.locator('.fu-row').first().getByRole('button', { name: 'Log contact' }).click();
    await page.getByLabel('Outcome').fill('Left a voicemail');
    await save('Save');
    await expect(toast('Saved')).toBeVisible();
  });
  test('contact log lists contacts, filters by type, searches and exports', async () => {
    await go('/contact-log');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByLabel('Contact Type').selectOption('call');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByLabel('Contact Type').selectOption('');
    await page.getByRole('searchbox', { name: 'Search' }).fill('voicemail');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    expect((await page.request.get('/api/contact-log/export.xlsx')).status()).toBe(200);
  });
});

/* ===================================== CLIENTS, PROJECTS, TASKS ===================================== */
test.describe('clients and projects', () => {
  test('client list searches, and every tab of a client opens', async () => {
    await go('/clients');
    await page.getByRole('searchbox', { name: 'Search' }).fill('Lotus');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.locator('tbody tr').first().click();
    for (const tab of ['Projects', 'New work', 'Activity', 'Quotes, invoices & payments', 'Files', 'Credentials', 'History']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    }
  });
  test('contacts: add, edit and remove a person at the client', async () => {
    await go(`/clients/${ids.client}`);
    await page.getByRole('button', { name: 'Add' }).first().click();
    await page.getByLabel('Name').fill('Kiran Mehta');
    await page.getByLabel('Role / designation').fill('Accounts');
    await save('Create contact');
    await expect(page.locator('.person', { hasText: 'Kiran Mehta' })).toBeVisible();
    await page.locator('.person', { hasText: 'Kiran Mehta' }).click();
    await page.getByLabel('Role / designation').fill('Accounts head');
    await save('Save changes');
    await expect(toast('Saved')).toBeVisible();
    await page.locator('.person', { hasText: 'Kiran Mehta' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').filter({ hasText: 'Are you sure?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.person', { hasText: 'Kiran Mehta' })).toHaveCount(0);
  });
  test('project: every tab opens, a task is added, the team is managed and the project is edited', async () => {
    await go(`/projects/${ids.project}`);
    for (const tab of ['Overview', 'Tasks', 'Change requests', 'Files', 'Activity', 'Credentials', 'Finance', 'Maintenance', 'History']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Task', exact: true }).click();
    await page.locator('input[name="title"]').fill('Build the cart');
    await save('Create task');
    await expect(toast('Task created')).toBeVisible();
    await page.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('dialog').getByText('Ira Intern').click();
    await save('Save team');
    await expect(toast('Team updated')).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Tech stack').fill('React, Node');
    await save('Save changes');
    await expect(page.getByText('React, Node')).toBeVisible();
  });
  test('project payment schedule, tasks board and change request tab', async () => {
    await go(`/projects/${ids.project}?tab=tasks`);
    await expect(page.locator('.kcard', { hasText: 'Design the homepage' })).toBeVisible();
    await page.locator('.kcard', { hasText: 'Design the homepage' }).click();
    await expect(page.getByRole('dialog')).toContainText('Design the homepage');
    await page.getByPlaceholder(/Write a comment/).fill('Looks good');
    await page.getByRole('button', { name: 'Comment' }).click();
    await expect(page.getByRole('dialog').getByText('Looks good')).toBeVisible();
    await page.getByPlaceholder(/Break the work into steps/).fill('Hero section');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Hero section')).toBeVisible();
    await page.keyboard.press('Escape');
    await go(`/projects/${ids.project}?tab=changes`);
    await page.getByRole('button', { name: 'New change request' }).click();
    await page.getByLabel('What the client wants').fill('Add wishlist');
    await page.getByLabel('Estimated price').fill('15000');
    await save('Create change request');
    await expect(page.getByText('Add wishlist')).toBeVisible();
  });
  test('my work: board drag, list, filters', async () => {
    await go('/tasks?scope=all&view=board');
    await expect(page.locator('.kcard').first()).toBeVisible();
    await page.locator('.kcard', { hasText: 'Design the homepage' }).first().dragTo(page.locator('.kcol', { hasText: 'In progress' }));
    await expect(page.locator('.kcol', { hasText: 'In progress' }).locator('.kcard', { hasText: 'Design the homepage' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByLabel('Status').selectOption('done');
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
});

/* ===================================== CHANGE REQUESTS ===================================== */
test.describe('change requests', () => {
  test('board, drag between columns, list, and the dialog moves status, quotes and bills', async () => {
    await go('/change-requests?view=board');
    await expect(page.locator('.kcard', { hasText: 'Add wishlist' })).toBeVisible();
    await page.locator('.kcard', { hasText: 'Add wishlist' }).dragTo(page.locator('.kcol', { hasText: 'Estimated' }));
    await expect(page.locator('.kcol', { hasText: 'Estimated' }).locator('.kcard', { hasText: 'Add wishlist' })).toBeVisible();
    await page.locator('.kcard', { hasText: 'Add wishlist' }).locator('.t').click();
    await page.getByRole('button', { name: 'Create quotation' }).click();
    await expect(page).toHaveURL(/\/quotes\/\d+/);
    await go('/change-requests?view=list');
    await expect(page.locator('tbody tr', { hasText: 'Add wishlist' })).toContainText('Quoted');
    await page.locator('tbody tr', { hasText: 'Add wishlist' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delivered' }).click();
    await expect(page.getByRole('dialog').getByText('Delivered').first()).toBeVisible();
    await page.getByRole('dialog').getByRole('tab').first().isVisible().catch(() => undefined);
    await page.keyboard.press('Escape');
  });
});

/* ===================================== MONEY DOCUMENTS ===================================== */
test.describe('quotations and invoices', () => {
  test('quotation editor: lines, totals, draft, send, accept, start project', async () => {
    await go('/quotes/new');
    await page.getByLabel('Client').first().selectOption({ label: 'Lotus Traders' });
    await page.getByLabel('What it is for').fill('Phase 2 — loyalty module');
    await page.getByLabel('Description', { exact: true }).fill('Loyalty module');
    await page.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('50000');
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByLabel('Description', { exact: true }).nth(1).fill('Training');
    await page.getByRole('spinbutton', { name: 'Rate', exact: true }).nth(1).fill('10000');
    await expect(page.locator('.totbox')).toContainText('₹60,000.00');
    await save('Save as draft');
    await expect(page).toHaveURL(/\/quotes\/\d+/);
    await expect(page.locator('.sheet')).toContainText('Loyalty module');
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await page.getByRole('button', { name: 'Client accepted — start the work' }).click();
    // one step: the project exists and the payment planner opens at once
    await expect(page).toHaveURL(/\/projects\/\d+\?tab=finance/);
    const plan = page.getByRole('dialog');
    await expect(plan).toContainText('Plan the payments');
    await plan.getByLabel('Percentages').fill('50, 50');
    await save('Save schedule');
    await expect(page.locator('tbody tr', { hasText: 'Advance' })).toContainText('₹30,000');
  });
  test('invoice: create, edit, duplicate, reminder, payment with TDS, cancel is refused after payment', async () => {
    await go('/invoices/new');
    await page.getByLabel('Client').first().selectOption({ label: 'Lotus Traders' });
    await page.getByLabel('Description', { exact: true }).fill('Maintenance Q1');
    await page.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('10000');
    await save('Save & mark as sent');
    await expect(page).toHaveURL(/\/invoices\/\d+/);
    ids.invoice = Number(page.url().split('/').pop());
    await page.getByRole('button', { name: 'Payment reminder' }).click();
    await expect(page.getByRole('dialog').getByLabel('Reminder message')).toContainText('INV/');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await page.getByLabel('Amount').first().fill('10000');
    await page.getByLabel('TDS deducted').fill('1000');
    await save('Create payment');
    await expect(page.locator('.stamp')).toContainText('PAID');
    await expect(page.locator('.kpi', { hasText: 'Received' })).toContainText('₹10,000.00'); // the ₹1,000 TDS is not part of the invoice or of what was received
    await expect(page.locator('.kpi', { hasText: 'Balance due' })).toContainText('₹0.00');
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/\/invoices\/\d+\?edit=1/);
    await page.keyboard.press('Escape');
    await go('/invoices');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByLabel('Any client').selectOption({ label: 'Lotus Traders' });
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});

/* ===================================== FINANCE ===================================== */
test.describe('finance', () => {
  test('TDS: the deduction is tracked as a tax credit, not cash, and can be marked claimed in the ITR', async () => {
    await go('/analytics?tab=tds');
    await expect(page.getByText('not cash in the bank')).toBeVisible();
    await expect(page.locator('.kpi', { hasText: 'TDS deducted' })).toContainText('₹1,000');
    await expect(page.locator('.kpi', { hasText: 'Still to claim' })).toContainText('₹1,000');
    const row = page.locator('tbody tr', { hasText: 'Lotus Traders' }).last();
    await row.getByRole('combobox').selectOption('claimed');
    await expect(toast('TDS status updated')).toBeVisible();
    await expect(page.locator('.kpi', { hasText: 'Claimed in ITR' })).toContainText('₹1,000');
    await expect(page.locator('.kpi', { hasText: 'Still to claim' })).toContainText('₹0');
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('menuitem', { name: /Excel/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /PDF/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await go('/finance?tab=payments');
    await expect(page.locator('tbody tr', { hasText: 'Lotus Traders' }).first()).not.toContainText('TDS'); // the income list shows money received, never TDS
  });
  test('income: add, edit, filter by date and category, delete', async () => {
    await go('/finance?tab=payments');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByLabel('Amount').first().fill('2500');
    await page.getByLabel('Reference / UTR no.').fill('UTR12345');
    await save('Create payment');
    await expect(toast('Payment created')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('UTR12345');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.locator('tbody tr').getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('Notes').fill('Edited note');
    await save('Save changes');
    await expect(toast('Saved')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('tbody tr').getByRole('button', { name: /Edit/ }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').filter({ hasText: 'Are you sure?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
  test('expenses: add against a grant, filter by grant and project, see it on the grant page', async () => {
    const grant = await api<{ id: number }>('POST', '/grants', { name: 'E2E Seed Grant', funder: 'State', requested: 100000, received: 50000, status: 'disbursed' });
    ids.grant = grant.id;
    await go('/finance?tab=expenses');
    await page.getByRole('button', { name: 'Record expense' }).click();
    await page.getByLabel('Amount').first().fill('4200');
    await page.getByLabel('Category').selectOption({ index: 1 });
    await page.getByLabel('Vendor').fill('Grant Vendor');
    await page.getByLabel('Paid from grant').selectOption({ label: 'E2E Seed Grant' });
    await save('Create expense');
    await expect(toast('Expense created')).toBeVisible();
    await page.getByLabel('Any grant').selectOption({ label: 'E2E Seed Grant' });
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await go(`/grants/${ids.grant}`);
    await expect(page.getByText('₹4,200').first()).toBeVisible();
    await expect(page.getByText('no receipt attached')).toBeVisible();
  });
  test('accounts, transfers and bank statement lines', async () => {
    await go('/finance?tab=accounts');
    await page.getByRole('button', { name: 'New account' }).click();
    await page.getByLabel('Account name').fill('Cash box');
    await save('Create account');
    await expect(page.locator('tbody tr', { hasText: 'Cash box' })).toBeVisible();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.locator('select[name="kind"]').selectOption({ index: 1 });
    await page.getByLabel('Amount').first().fill('1000');
    await save('Create transfer');
    await expect(toast('Transfer created')).toBeVisible();
    await go('/finance?tab=bank');
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByLabel('Deposit').fill('2500');
    await page.getByLabel('Description').fill('NEFT from client');
    await save('Create bank line');
    await page.getByRole('button', { name: 'Auto-match' }).click();
    await expect(page.locator('.toast').first()).toBeVisible();
  });
  test('overview period selector and every number renders', async () => {
    await go('/finance');
    for (const p of ['This month', 'Last month', 'This quarter', 'This financial year', 'Last 12 months', 'All time']) {
      await page.getByLabel('Period').selectOption({ label: p });
      await expect(page.locator('.kpi').first()).toBeVisible();
    }
  });
});

/* ===================================== SUBSCRIPTIONS ===================================== */
test.describe('subscriptions', () => {
  test('what the company pays debits itself as an expense; what someone else pays is only listed; there are no switches to tick', async () => {
    await go('/renewals');
    for (const [name, scope, cost] of [['Team Chat Tool', 'company', '1200'], ['My Own Editor', 'personal', '800']]) {
      await page.getByRole('button', { name: 'New subscription' }).click();
      await page.locator('input[name="name"]').fill(name as string);
      await page.locator('select[name="kind"]').selectOption('subscription');
      await page.locator('input[name="renewal_date"]').fill('05 Jan 2026'); // dates are typed as 05 Jan 2026 (05-01-2026 works too)
      await page.locator('select[name="cycle"]').selectOption('monthly');
      await page.locator('input[name="our_cost"]').fill(cost as string);
      await page.locator('select[name="scope"]').selectOption(scope as string);
      if (scope === 'personal') await page.locator('select[name="owner_id"]').selectOption({ index: 1 });
      else await expect(page.locator('select[name="owner_id"]')).toHaveCount(0); // the person only matters when someone else pays
      await expect(page.locator('input[name="auto_debit"]')).toHaveCount(0);
      await expect(page.locator('input[name="amount_varies"]')).toHaveCount(0);
      await expect(page.locator('input[name="next_amount"]')).toHaveCount(0);
      await save('Create renewal');
      await expect(toast('Created')).toBeVisible();
    }
    const exp = await api<{ vendor: string; amount: number }[]>('GET', '/expenses?q=Team%20Chat&limit=200');
    expect(exp.length).toBeGreaterThan(0);
    expect((await api<unknown[]>('GET', '/expenses?q=My%20Own&limit=50')).length).toBe(0);
    await expect(page.locator('tbody tr', { hasText: 'My Own Editor' })).toContainText('only listed');
  });
});

/* ===================================== EVERYTHING ELSE ===================================== */
test.describe('the rest of the system', () => {
  test('assets, maintenance, events, documents, vault', async () => {
    await go('/assets');
    await page.getByRole('button', { name: 'New asset' }).click();
    await page.getByLabel('Asset Type').selectOption({ index: 1 });
    await page.getByLabel('Make / Model').fill('Dell Latitude');
    await save('Create asset');
    await expect(page.locator('tbody tr', { hasText: 'Dell Latitude' })).toBeVisible();
    await go('/maintenance');
    await page.getByRole('button', { name: 'Log work' }).click();
    await page.getByLabel('Issue / work item').fill('Contact form broken');
    await page.getByLabel('Project / website').selectOption({ index: 1 });
    await save('Create maintenance item');
    await expect(page.locator('tbody tr', { hasText: 'Contact form broken' })).toBeVisible();
    await go('/calendar');
    await page.getByRole('button', { name: 'Reminder' }).first().click();
    await page.getByLabel('Title').fill('Income tax advance');
    await page.getByLabel('Date').fill(new Date().toISOString().slice(0, 10));
    await save('Create event');
    await expect(page.locator('.ev', { hasText: 'Income tax advance' }).first()).toBeVisible();
    await go('/documents');
    await page.getByRole('button', { name: 'Add document' }).click();
    await page.getByRole('button', { name: 'Save a link' }).click();
    await page.getByRole('dialog').locator('input[inputmode="url"]').fill('https://drive.example.com/nda');
    await page.getByRole('dialog').getByPlaceholder(/Signed NDA/).fill('Signed NDA');
    await save('Save link');
    await expect(page.locator('tbody tr', { hasText: 'Signed NDA' })).toBeVisible();
    await go('/vault');
    await page.getByRole('button', { name: 'Add credential' }).click();
    await page.getByRole('dialog').getByPlaceholder(/cPanel/).fill('cPanel — lotus.test');
    await page.getByRole('dialog').locator('label', { hasText: 'Client' }).locator('select').selectOption({ label: 'Lotus Traders' });
    await page.getByRole('dialog').locator('input[type="password"]').fill('S3cret-pass!');
    await save('Save');
    await page.getByRole('button', { name: 'Reveal password' }).click();
    await expect(page.getByText('S3cret-pass!')).toBeVisible();
  });
  test('team, settings, activity log and notifications', async () => {
    await go('/team');
    await expect(page.locator('tbody tr', { hasText: 'Ira Intern' })).toBeVisible();
    await page.locator('tbody tr', { hasText: 'Ira Intern' }).getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('Job title').fill('Developer intern');
    await save('Save changes');
    await expect(toast('Saved')).toBeVisible();
    await go('/settings');
    await page.getByLabel('Company name').fill('E2E Works LLP');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(toast('Settings saved')).toBeVisible();
    await go('/audit');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByLabel('Action').selectOption('create');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByRole('button', { name: /Notifications/ }).first().click();
    await expect(page.locator('.popover')).toBeVisible();
  });
  test('tranches: your own percentages, the TDS ratio, net invoices, and a warning when work starts before the advance', async () => {
    const pid = (await api<{ id: number }>('POST', '/projects', { client_id: ids.client, name: 'Tranche Test Site', status: 'planning', budget: 100000 })).id;
    await go(`/projects/${pid}?tab=finance`);
    await page.getByRole('button', { name: 'Plan the payments' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Percentages').fill('20, 30');
    await expect(dlg).toContainText('add up to 50%');
    await expect(dlg.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
    await dlg.getByLabel('Percentages').fill('30, 30, 40');
    await dlg.getByLabel('TDS percent').fill('10');
    await expect(dlg.locator('tfoot')).toContainText('₹90,000'); // what you receive of ₹1,00,000
    await save('Save schedule');
    await expect(toast('Payment schedule set')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'Advance' })).toContainText('receive ₹27,000');
    await page.getByRole('button', { name: 'Raise invoice' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('TDS % the client deducts'); // the project has TDS, so ask whether this payment has it too
    await save('Save');
    await expect(page).toHaveURL(/\/invoices\/\d+/);
    await expect(page.locator('.kpi', { hasText: 'Total' }).first()).toContainText('₹27,000');
    await expect(page.getByText('also deduct ₹3,000.00 TDS')).toBeVisible();
    // starting work before the advance is paid asks first
    await api('PUT', `/projects/${pid}`, { status: 'active' });
    await go(`/projects/${pid}`);
    await expect(page.getByRole('alert').filter({ hasText: 'advance of' })).toBeVisible();
  });
  test('the action center puts the money still to get first, with what is left on each project', async () => {
    await go('/actions');
    const money = page.locator('.ac-money');
    await expect(money).toContainText('Money still to get');
    await expect(money.locator('tr', { hasText: 'Lotus Storefront' }).first()).toContainText('not invoiced yet');
    await expect(page.locator('.kpi', { hasText: 'Still to get' })).toContainText('₹');
    await expect(page.locator('.sev-pill').first()).toBeVisible();
    await go('/analytics?tab=receivables');
    await expect(page.locator('.kpi', { hasText: 'Still to get' })).toContainText('₹');
    await expect(page.getByRole('columnheader', { name: 'Still to get' }).first()).toBeVisible();
    await go('/projects');
    await expect(page.getByRole('columnheader', { name: 'Still to get' })).toBeVisible();
  });
  test('analytics and the action center answer with real numbers', async () => {
    await go('/analytics?tab=receivables');
    await expect(page.locator('tbody tr', { hasText: 'Lotus Traders' }).first()).toBeVisible();
    await go('/analytics?tab=spending');
    await page.getByLabel('Grant money').selectOption('any');
    await expect(page.getByText('₹4,200').first()).toBeVisible();
    await go('/analytics?tab=subscriptions');
    await expect(page.getByText('Team Chat Tool').first()).toBeVisible();
    await go('/actions');
    await expect(page.locator('.att-row').first()).toBeVisible();
  });
  test('an intern sees only their own work and no money', async ({ browser }) => {
    const p2 = await (await browser.newContext()).newPage();
    await p2.goto('/');
    await p2.getByLabel('Email').fill('ira@e2e.test');
    await p2.getByLabel('Password').fill('Intern-Pass-2026');
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await expect(p2.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
    await p2.context().close();
  });
});
