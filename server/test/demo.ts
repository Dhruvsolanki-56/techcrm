import { ago, createTestApp, inn, PASSWORD, type LoggedIn, type TestApp } from './helpers';

export interface Demo {
  app: TestApp;
  F: LoggedIn; // founder (Aarav)
  K: LoggedIn; // intern with maintenance access (Kabir)
  T: LoggedIn; // intern (Tara)
  u: Record<string, number>;
  clients: Record<string, number>;
  proj: Record<string, number>;
  leads: Record<string, number>;
  bank: number;
  grant: number;
}

/** A realistic small company: team, clients, projects, tasks, leads, quotes, invoices, payments, expenses, a grant, renewals, credentials. */
export async function createDemo(env: Record<string, string> = {}): Promise<Demo> {
  const app = createTestApp(env);
  const setup = await app.request.post('/api/auth/setup').set('X-Requested-With', 'crm').send({ company_name: 'TechSentinals (demo)', name: 'Aarav Mehta', email: 'aarav@demo.test', password: PASSWORD });
  if (setup.status !== 200) throw new Error(`setup failed: ${setup.text}`);
  const cookie = String((setup.headers['set-cookie'] as unknown as string[])[0]).split(';')[0] as string;
  const call = async (method: string, url: string, body?: unknown) => {
    let r = app.request[method.toLowerCase() as 'get'](`/api${url}`).set('X-Requested-With', 'crm').set('Cookie', cookie);
    if (body !== undefined) r = r.send(body as object);
    const res = await r;
    if (res.status >= 400) throw new Error(`${method} ${url}: ${res.body?.error ?? res.status}`);
    return res.body;
  };
  const u: Record<string, number> = { aarav: 1 };
  for (const [k, name, email, role, title, modules] of [
    ['meera', 'Meera Kapoor', 'meera@demo.test', 'founder', 'Co-founder — Design', []], ['rohan', 'Rohan Shah', 'rohan@demo.test', 'founder', 'Co-founder — Engineering', []],
    ['isha', 'Isha Verma', 'isha@demo.test', 'founder', 'Co-founder — Sales', []], ['kabir', 'Kabir Singh', 'kabir@demo.test', 'intern', 'Web developer intern', ['maintenance']],
    ['tara', 'Tara Nair', 'tara@demo.test', 'intern', 'Design intern', []],
  ] as const) {
    u[k] = (await call('POST', '/users', { name, email, role, title, password: PASSWORD, modules })).id;
  }
  await call('PUT', '/settings', {
    company_name: 'TechSentinals (demo)', company_address: '12 Innovation Park, Baner, Pune 411045', company_email: 'hello@techsentinals.example', company_phone: '+91 98765 43210',
    pan: 'ABCDE1234F', state: 'Maharashtra', bank_account_name: 'TechSentinals', bank_name: 'HDFC Bank, Baner', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0000123', upi_id: 'techsentinals@hdfcbank',
  });
  const bank = (await call('POST', '/accounts', { name: 'HDFC Current A/c', type: 'bank', opening_balance: 250000 })).id as number;
  await call('POST', '/accounts', { name: 'Founders UPI', type: 'upi', opening_balance: 12000 });
  await call('POST', '/transfers', { date: ago(120), kind: 'capital_in', amount: 400000, account_id: bank, user_id: u.aarav, notes: 'Initial capital' });
  await call('POST', '/transfers', { date: ago(120), kind: 'capital_in', amount: 400000, account_id: bank, user_id: u.rohan, notes: 'Initial capital' });
  await call('POST', '/transfers', { date: ago(20), kind: 'withdrawal', amount: 50000, account_id: bank, user_id: u.meera, notes: 'Founder draw' });

  const clients: Record<string, number> = {};
  for (const [k, company, industry, city, state, cn, ce, cp] of [
    ['acme', 'Acme Logistics Pvt Ltd', 'Logistics', 'Mumbai', 'Maharashtra', 'Neha Joshi', 'neha@acmelogistics.example', '+91 99200 11122'],
    ['green', 'GreenLeaf Organics', 'Retail / D2C', 'Bengaluru', 'Karnataka', 'Vikram Rao', 'vikram@greenleaf.example', '+91 98450 33445'],
    ['bright', 'BrightPath Academy', 'Education', 'Pune', 'Maharashtra', 'Sunita Desai', 'sunita@brightpath.example', '+91 90110 55667'],
  ] as const) {
    clients[k] = (await call('POST', '/clients', { company, industry, city, state, status: 'active', account_manager_id: u.isha, website: `${company.split(' ')[0]?.toLowerCase()}.example`, address: 'Plot 12, Business District' })).id;
    await call('POST', '/contacts', { client_id: clients[k], name: cn, email: ce, phone: cp, role: 'Owner / Decision maker', is_primary: true });
  }
  const proj: Record<string, number> = {};
  proj.acme = (await call('POST', '/projects', {
    client_id: clients.acme, name: 'Fleet Tracking Portal', type: 'Web application', status: 'active', priority: 'high', start_date: ago(45), deadline: inn(12), budget: 450000, manager_id: u.rohan,
    tech_stack: 'React, Node.js, PostgreSQL, Mapbox', staging_url: 'https://staging.acme.example', repo_url: 'https://git.example/acme/fleet',
    description: 'Live GPS tracking portal for Acme’s 120-vehicle fleet with driver app integration.', specs: 'Scope\n- Live map with vehicle status\n- Driver management + trip history',
  })).id;
  proj.green = (await call('POST', '/projects', { client_id: clients.green, name: 'GreenLeaf Online Store', type: 'E-commerce', status: 'review', priority: 'medium', start_date: ago(70), deadline: inn(4), budget: 220000, manager_id: u.meera, tech_stack: 'Shopify, Liquid', live_url: 'https://greenleaf.example', description: 'Shopify store redesign with subscription boxes.' })).id;
  proj.bright = (await call('POST', '/projects', { client_id: clients.bright, name: 'BrightPath Website', type: 'Website', status: 'maintenance', priority: 'low', start_date: ago(300), deadline: ago(200), budget: 90000, manager_id: u.meera, tech_stack: 'WordPress', live_url: 'https://brightpath.example', description: 'School website — now on monthly maintenance.' })).id;
  await call('PUT', `/projects/${proj.acme}/members`, { user_ids: [u.rohan, u.kabir, u.tara] });
  await call('PUT', `/projects/${proj.green}/members`, { user_ids: [u.meera, u.tara] });
  await call('PUT', `/projects/${proj.bright}/members`, { user_ids: [u.meera, u.kabir] });
  for (const [title, project_id, assignee_id, status, priority, due_date, description] of [
    ['Build vehicle live-map component', proj.acme, u.kabir, 'in_progress', 'high', inn(2), 'Use Mapbox GL.'], ['Driver trip-history API', proj.acme, u.rohan, 'review', 'medium', inn(1), ''],
    ['Design dispatcher dashboard screens', proj.acme, u.tara, 'todo', 'medium', inn(6), 'Figma link in project overview.'], ['Write UAT checklist', proj.acme, u.kabir, 'todo', 'low', ago(2), 'Overdue on purpose.'],
    ['Set up CI pipeline', proj.acme, u.rohan, 'done', 'medium', ago(10), ''], ['Product page QA on mobile', proj.green, u.tara, 'in_progress', 'high', inn(2), ''],
    ['Configure subscription app', proj.green, u.meera, 'todo', 'high', inn(3), ''], ['Monthly backup + plugin updates', proj.bright, u.kabir, 'todo', 'medium', inn(5), 'Take backup first.'],
  ] as const) await call('POST', '/tasks', { title, project_id, assignee_id, status, priority, due_date, description });
  const shared = await call('POST', '/tasks', { title: 'Get Fleet portal ready for client handover', project_id: proj.acme, assignee_ids: [u.kabir, u.tara, u.rohan], status: 'in_progress', priority: 'high', due_date: inn(5), description: 'Everything that has to be ready before Acme gets the portal.' });
  for (const [text, who, done] of [['Load test the live map with 200 vehicles', u.kabir, false], ['Fix marker flicker on Safari', u.kabir, true], ['Empty states and error screens', u.tara, false], ['Write the handover note for Neha', null, false]] as const) {
    const list = await call('POST', `/tasks/${shared.id}/checklist`, { text, assignee_id: who });
    if (done) await call('PUT', `/tasks/${shared.id}/checklist/${list[list.length - 1].id}`, { done: true });
  }

  const leads: Record<string, number> = {};
  for (const [k, name, company, service, value, , source, follow] of [
    ['l1', 'Rajesh Kumar', 'Kumar Textiles', 'E-commerce', 350000, 'proposal', 'Referral', ago(1)], ['l2', 'Priya Menon', 'Menon Dental Clinics', 'Website', 120000, 'meeting', 'Website', inn(2)],
    ['l3', 'Arjun Patel', 'Patel Foods', 'Web application', 600000, 'negotiation', 'LinkedIn', inn(1)], ['l4', 'Divya Iyer', 'Iyer & Co. CA', 'Website', 60000, 'new', 'Instagram', inn(5)],
    ['l5', 'Sameer Khan', 'Khan Auto Spares', 'CRM / ERP / Custom software', 280000, 'contacted', 'Cold call / email', inn(3)], ['l6', 'Lata Pillai', 'Pillai Events', 'Mobile app', 400000, 'lost', 'Event / Meetup', null],
  ] as const) {
    leads[k] = (await call('POST', '/leads', { name, company, service, value, stage: 'new', source, owner_id: u.isha, next_followup: follow, email: `${name.split(' ')[0]?.toLowerCase()}@example.test`, phone: `+91 98${Math.floor(10000000 + Math.random() * 89999999)}` })).id;
  }
  for (const [k, stage] of [['l1', 'proposal'], ['l2', 'meeting'], ['l3', 'negotiation'], ['l5', 'contacted']] as const) await call('PUT', `/leads/${leads[k]}`, { stage });
  await call('PUT', `/leads/${leads.l6}`, { stage: 'lost', lost_reason: 'Budget too low for native app' });
  for (const [k, department, category, priority, market, city, followup_round, next_action, last] of [
    ['l1', 'Website', 'Retail', 'hot', 'India', 'Surat', 'second', 'Call to walk through the proposal', ago(4)], ['l2', 'Website', 'Doctors', 'medium', 'India', 'Kochi', 'first', 'Send two clinic website examples', ago(6)],
    ['l3', 'Web application', 'Manufacturing', 'hot', 'India', 'Ahmedabad', 'third', 'Revised timeline before Friday', ago(2)], ['l4', 'SaaS product', 'General Services', 'cold', 'India', 'Chennai', 'not_started', '', null],
    ['l5', 'Mobile app', 'Manufacturing', 'medium', 'Foreign', 'Dubai', 'initial', 'Share app demo video', ago(9)], ['l6', 'Mobile app', 'Event Management', 'cold', 'India', 'Pune', 'complete', '', ago(40)],
  ] as const) await call('PUT', `/leads/${leads[k]}`, { department, category, priority, market, city, country: market === 'India' ? 'India' : 'UAE', followup_round, next_action, last_contact: last });
  await call('POST', '/notes', { entity_type: 'lead', entity_id: leads.l3, kind: 'call', body: 'Call with Arjun: wants vendor portal + inventory sync. Budget approved up to ₹6L.' });
  await call('POST', '/notes', { entity_type: 'lead', entity_id: leads.l1, kind: 'meeting', body: 'Demoed our Shopify work. Sent proposal.' });
  await call('POST', '/notes', { entity_type: 'project', entity_id: proj.acme, kind: 'note', body: 'Client confirmed: vehicle count will grow to 200 by year end.' });

  const mkInv = async (client: number, project: number, title: string, items: unknown[], issue: string, due: string, paid: [number, string, number?][]) => {
    const inv = await call('POST', '/invoices', { client_id: client, project_id: project, title, items, issue_date: issue, due_date: due, status: 'sent' });
    for (const [amount, date, tds] of paid) await call('POST', '/payments', { invoice_id: inv.id, date, amount, tds: tds ?? 0, account_id: bank, method: 'Bank Transfer', reference: `UTR${Math.floor(Math.random() * 1e9)}` });
    return inv;
  };
  await mkInv(clients.acme as number, proj.acme as number, 'Fleet portal — advance 30%', [{ description: 'Advance payment (30%) — Fleet Tracking Portal', qty: 1, rate: 135000 }], ago(44), ago(29), [[135000, ago(40)]]);
  await mkInv(clients.acme as number, proj.acme as number, 'Fleet portal — milestone 1', [{ description: 'Design sign-off milestone', qty: 1, rate: 90000 }], ago(18), ago(3), [[50000, ago(10)]]);
  await mkInv(clients.green as number, proj.green as number, 'Online store — phase 1', [{ description: 'Store redesign & migration', qty: 1, rate: 140000 }], ago(30), ago(15), [[140000, ago(14), 0]]);
  await mkInv(clients.green as number, proj.green as number, 'Online store — final', [{ description: 'Launch milestone', qty: 1, rate: 80000 }], ago(1), inn(14), []);
  await mkInv(clients.bright as number, proj.bright as number, 'Website maintenance — last month', [{ description: 'Monthly maintenance plan', qty: 1, rate: 6000 }], ago(33), ago(18), [[6000, ago(15), 600]]);
  await call('POST', '/quotes', { lead_id: leads.l1, title: 'Proposal — Kumar Textiles online store', items: [{ description: 'E-commerce store design & build (up to 100 products)', qty: 1, rate: 280000 }, { description: 'Payment gateway + shipping integration', qty: 1, rate: 45000 }], status: 'sent' });
  for (const [category, vendor, amount, _tax, d, paid_by_id, project_id] of [
    ['Salaries / Stipends', 'Interns stipend', 24000, 0, ago(5), null, null], ['Software & SaaS', 'Figma + GitHub + Notion', 7800, 1190, ago(12), null, null], ['Hosting & Domains', 'AWS', 9200, 1404, ago(8), null, proj.acme],
    ['Office rent', 'WorkHub Coworking', 30000, 4576, ago(3), null, null], ['Marketing & Ads', 'Google Ads', 15000, 0, ago(22), u.isha, null], ['Freelancers / Contractors', 'Freelance illustrator', 18000, 0, ago(35), null, proj.green],
    ['Travel', 'Client visit — Mumbai', 6400, 0, ago(26), u.rohan, proj.acme],
  ] as const) await call('POST', '/expenses', { category, vendor, amount, date: d, paid_by_id, project_id, account_id: paid_by_id ? null : bank, status: 'paid', description: category });
  const grant = (await call('POST', '/grants', { name: 'State startup seed grant', funder: 'Demo Innovation Council', applied_on: ago(150), requested: 250000, received: 100000, status: 'disbursed', next_report_date: inn(20) })).id as number;
  await call('POST', '/payments', { date: ago(90), amount: 100000, account_id: bank, method: 'Bank Transfer', category: 'Grant', grant_id: grant, reference: 'GRANT-T1' });
  await call('POST', '/expenses', { category: 'Software & tools', vendor: 'Cloud hosting', amount: 18000, date: ago(60), account_id: bank, status: 'paid', description: 'Prototype hosting for a year', grant_id: grant, receipt_url: 'https://example.com/receipt/123' });
  await call('POST', '/assets', { asset_type: 'Laptop', make_model: 'Demo Book 14', serial_number: 'DB14-0001', purchase_date: ago(200), purchase_value: 72000, current_value: 52000, assigned_to: u.kabir, status: 'Active' });
  await call('POST', '/assets', { asset_type: 'Phone', make_model: 'Demo Phone 8', purchase_date: ago(90), purchase_value: 18000, status: 'Active' });
  await call('POST', '/bank_transactions', { date: ago(59), description: 'CARD PURCHASE CLOUD HOSTING', reference: 'TXN-4471', withdrawal: 18000, type: 'Card', account_id: bank });
  await call('POST', '/bank_transactions', { date: ago(3), description: 'SMS ALERT CHARGES', withdrawal: 17.7, type: 'Charges', account_id: bank });
  await call('POST', '/bank-match', {});
  await call('POST', '/documents/link', { title: 'Company registration (shared drive)', category: 'Legal', entity_type: 'general', url: 'https://example.com/docs/registration', expiry_date: inn(45) });
  for (const [client, project, kind, name, vendor, date, cycle, cost, price] of [
    [clients.bright, proj.bright, 'domain', 'brightpath.example', 'GoDaddy', inn(9), 'yearly', 900, 1500], [clients.green, proj.green, 'hosting', 'GreenLeaf Shopify plan', 'Shopify', inn(21), 'monthly', 2000, 2600],
    [clients.acme, proj.acme, 'ssl', 'acme staging wildcard SSL', 'Namecheap', inn(40), 'yearly', 3200, 4500], [clients.bright, proj.bright, 'hosting', 'BrightPath shared hosting', 'Hostinger', ago(2), 'yearly', 5400, 8000],
  ] as const) await call('POST', '/renewals', { client_id: client, project_id: project, kind, name, vendor, renewal_date: date, cycle, our_cost: cost, client_price: price, status: 'active' });
  await call('POST', '/renewals', { client_id: clients.bright, project_id: proj.bright, kind: 'amc', name: 'Silver AMC — BrightPath', renewal_date: inn(24), cycle: 'monthly', client_price: 6000, status: 'active', notes: 'Monthly backups, plugin updates, uptime monitoring.' });
  await call('POST', '/maintenance_logs', { project_id: proj.bright, title: 'Fix broken admissions form', type: 'Bug fix', status: 'resolved', hours: 1.5, assignee_id: u.kabir, priority: 'high' });
  await call('POST', '/maintenance_logs', { project_id: proj.bright, title: 'Update gallery with annual-day photos', type: 'Content update', status: 'open', assignee_id: u.kabir, priority: 'medium' });
  await call('POST', '/credentials', { client_id: clients.bright, project_id: proj.bright, label: 'cPanel — brightpath.example', kind: 'Hosting / cPanel', url: 'https://cpanel.hostinger.example:2083', username: 'brightpath_admin', password: 'Demo!cPanel#2026', secret: '2FA recovery codes: 1111-2222', notes: 'Hosting login' });
  await call('POST', '/credentials', { client_id: clients.acme, project_id: proj.acme, label: 'AWS EC2 — staging', kind: 'Server / SSH', url: 'ec2-13-232-0-1.ap-south-1.compute.amazonaws.com', username: 'ubuntu', password: 'Demo!ssh#key', notes: 'Port 22' });
  await call('POST', '/events', { title: 'Acme go-live call', date: inn(11), kind: 'Launch / Go-live', project_id: proj.acme, client_id: clients.acme, notes: '11:00 AM, Google Meet' });
  await call('POST', '/events', { title: 'Income tax advance due', date: inn(8), kind: 'Reminder', notes: 'Advance tax instalment' });
  app.ctx.db.prepare('UPDATE users SET must_change_password=0').run(); // demo accounts skip "choose your own password"

  const F = await app.login('aarav@demo.test');
  const K = await app.login('kabir@demo.test');
  const T = await app.login('tara@demo.test');
  return { app, F, K, T, u, clients, proj, leads, bank, grant };
}
