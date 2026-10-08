/* Fills a SEPARATE demo database with sample data so you can explore the CRM.
   Usage:  npm run demo        then start the demo with:  set CRM_DATA_DIR=demo-data && node server.js   (PowerShell: $env:CRM_DATA_DIR="demo-data"; node server.js)
   Never touches your real data folder. */
const path = require('path');
if (!process.env.CRM_DATA_DIR) process.env.CRM_DATA_DIR = path.join(__dirname, '..', 'demo-data');
const http = require('http');
const app = require('../server');
const { db } = require('../lib/db');

const DEMO_PASSWORD = 'Demo-Pass-2026';
async function run() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) { console.log('Database is not empty — refusing to add demo data.'); process.exit(1); }
  const server = http.createServer(app).listen(0); const port = server.address().port;
  let cookie = '';
  const call = async (method, url, body, ck = cookie) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc && url.startsWith('/auth')) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${url}: ${data.error}`); return data;
  };
  const ago = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const inn = (d) => ago(-d);

  await call('POST', '/auth/setup', { company_name: 'TechSentinals (demo)', name: 'Aarav Mehta', email: 'aarav@demo.test', password: DEMO_PASSWORD });
  const u = {};
  for (const [k, name, email, role, title, modules] of [['meera', 'Meera Kapoor', 'meera@demo.test', 'founder', 'Co-founder — Design'], ['rohan', 'Rohan Shah', 'rohan@demo.test', 'founder', 'Co-founder — Engineering'], ['isha', 'Isha Verma', 'isha@demo.test', 'founder', 'Co-founder — Sales'],
    ['kabir', 'Kabir Singh', 'kabir@demo.test', 'intern', 'Web developer intern', ['maintenance']], ['tara', 'Tara Nair', 'tara@demo.test', 'intern', 'Design intern', []]]) {
    u[k] = (await call('POST', '/users', { name, email, role, title, password: DEMO_PASSWORD, modules: modules || [] })).id;
  }
  u.aarav = 1;
  await call('PUT', '/settings', { company_name: 'TechSentinals (demo)', company_address: '12 Innovation Park, Baner, Pune 411045', company_email: 'hello@techsentinals.example', company_phone: '+91 98765 43210', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', state: 'Maharashtra',
    bank_account_name: 'TechSentinals', bank_name: 'HDFC Bank, Baner', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0000123', upi_id: 'techsentinals@hdfcbank' });
  const bank = (await call('POST', '/accounts', { name: 'HDFC Current A/c', type: 'bank', opening_balance: 250000 })).id;
  const upi = (await call('POST', '/accounts', { name: 'Founders UPI', type: 'upi', opening_balance: 12000 })).id;
  await call('POST', '/transfers', { date: ago(120), kind: 'capital_in', amount: 400000, account_id: bank, user_id: u.aarav, notes: 'Initial capital' });
  await call('POST', '/transfers', { date: ago(120), kind: 'capital_in', amount: 400000, account_id: bank, user_id: u.rohan, notes: 'Initial capital' });
  await call('POST', '/transfers', { date: ago(20), kind: 'withdrawal', amount: 50000, account_id: bank, user_id: u.meera, notes: 'Founder draw' });

  const clients = {};
  for (const [k, company, industry, city, state, gst, cn, ce, cp] of [['acme', 'Acme Logistics Pvt Ltd', 'Logistics', 'Mumbai', 'Maharashtra', '27AAACA1234A1Z9', 'Neha Joshi', 'neha@acmelogistics.example', '+91 99200 11122'],
    ['green', 'GreenLeaf Organics', 'Retail / D2C', 'Bengaluru', 'Karnataka', '29AAGCG5678B1Z2', 'Vikram Rao', 'vikram@greenleaf.example', '+91 98450 33445'], ['bright', 'BrightPath Academy', 'Education', 'Pune', 'Maharashtra', '', 'Sunita Desai', 'sunita@brightpath.example', '+91 90110 55667']]) {
    clients[k] = (await call('POST', '/clients', { company, industry, city, state, gstin: gst, status: 'active', account_manager_id: u.isha, website: company.split(' ')[0].toLowerCase() + '.example', address: `Plot ${Math.floor(Math.random() * 90 + 10)}, Business District` })).id;
    await call('POST', '/contacts', { client_id: clients[k], name: cn, email: ce, phone: cp, role: 'Owner / Decision maker', is_primary: true });
  }
  const proj = {};
  proj.acme = (await call('POST', '/projects', { client_id: clients.acme, name: 'Fleet Tracking Portal', type: 'Web application', status: 'active', priority: 'high', start_date: ago(45), deadline: inn(12), budget: 450000, manager_id: u.rohan, tech_stack: 'React, Node.js, PostgreSQL, Mapbox', staging_url: 'https://staging.acme.example', repo_url: 'https://git.example/acme/fleet',
    description: 'Live GPS tracking portal for Acme’s 120-vehicle fleet with driver app integration.', specs: 'Scope\n- Live map with vehicle status\n- Driver management + trip history\n- Role based access (admin / dispatcher)\n- Monthly PDF reports\n\nOut of scope\n- Native mobile app (phase 2)\n\nHosting: client AWS account (Mumbai region).' })).id;
  proj.green = (await call('POST', '/projects', { client_id: clients.green, name: 'GreenLeaf Online Store', type: 'E-commerce', status: 'review', priority: 'medium', start_date: ago(70), deadline: inn(4), budget: 220000, manager_id: u.meera, tech_stack: 'Shopify, Liquid', live_url: 'https://greenleaf.example', description: 'Shopify store redesign with subscription boxes.' })).id;
  proj.bright = (await call('POST', '/projects', { client_id: clients.bright, name: 'BrightPath Website', type: 'Website', status: 'maintenance', priority: 'low', start_date: ago(300), deadline: ago(200), budget: 90000, manager_id: u.meera, tech_stack: 'WordPress', live_url: 'https://brightpath.example', description: 'School website — now on monthly maintenance.' })).id;
  await call('PUT', `/projects/${proj.acme}/members`, { user_ids: [u.rohan, u.kabir, u.tara] });
  await call('PUT', `/projects/${proj.green}/members`, { user_ids: [u.meera, u.tara] });
  await call('PUT', `/projects/${proj.bright}/members`, { user_ids: [u.meera, u.kabir] });
  for (const [title, project_id, assignee_id, status, priority, due_date, description] of [
    ['Build vehicle live-map component', proj.acme, u.kabir, 'in_progress', 'high', inn(2), 'Use Mapbox GL. Markers must update every 5s via websocket. See spec tab for status colours.'],
    ['Driver trip-history API', proj.acme, u.rohan, 'review', 'medium', inn(1), ''], ['Design dispatcher dashboard screens', proj.acme, u.tara, 'todo', 'medium', inn(6), 'Figma link in project overview.'],
    ['Write UAT checklist', proj.acme, u.kabir, 'todo', 'low', ago(2), 'Overdue on purpose — shows red in the UI.'], ['Set up CI pipeline', proj.acme, u.rohan, 'done', 'medium', ago(10), ''],
    ['Product page QA on mobile', proj.green, u.tara, 'in_progress', 'high', inn(2), ''], ['Configure subscription app', proj.green, u.meera, 'todo', 'high', inn(3), ''], ['Monthly backup + plugin updates', proj.bright, u.kabir, 'todo', 'medium', inn(5), 'Take backup first. Update WP core + plugins on staging, then live.']])
    await call('POST', '/tasks', { title, project_id, assignee_id, status, priority, due_date, description });
  // one task shared by two interns and a co-founder, with a split checklist and a short discussion
  const shared = await call('POST', '/tasks', { title: 'Get Fleet portal ready for client handover', project_id: proj.acme, assignee_ids: [u.kabir, u.tara, u.rohan], status: 'in_progress', priority: 'high', due_date: inn(5),
    description: 'Everything that has to be ready before Acme gets the portal. Each step has an owner. Tick yours as you finish and ask questions in the discussion below.' });
  for (const [text, who, done] of [['Load test the live map with 200 vehicles', u.kabir, false], ['Fix marker flicker on Safari', u.kabir, true], ['Empty states and error screens', u.tara, false],
    ['Final colour pass on dispatcher dashboard', u.tara, true], ['Set up production database backups', u.rohan, false], ['Write the handover note for Neha', null, false]]) {
    const list = await call('POST', `/tasks/${shared.id}/checklist`, { text, assignee_id: who });
    if (done) { const id = list[list.length - 1].id; await call('PUT', `/tasks/${shared.id}/checklist/${id}`, { done: true }); db.prepare('UPDATE task_checklist SET done_by=? WHERE id=?').run(who, id); }
  }
  const say = (who, body, hoursAgo, mentions) => db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body,mentions,created_at) VALUES('task',?,?,'note',?,?,datetime('now',?))")
    .run(shared.id, who, body, mentions ? JSON.stringify(mentions) : null, `-${hoursAgo} hours`);
  say(u.aarav, '@Kabir Singh can you run the 200-vehicle load test by Thursday? @Tara Nair the empty states are the last design piece.', 26, [{ id: u.kabir, name: 'Kabir Singh' }, { id: u.tara, name: 'Tara Nair' }]);
  say(u.kabir, 'Yes. Safari flicker is fixed already. Starting the load test tomorrow morning.', 22);
  say(u.tara, 'Empty states are 70% done. @Rohan Shah should the "no GPS signal" state show the last known position?', 5, [{ id: u.rohan, name: 'Rohan Shah' }]);
  say(u.rohan, 'Yes, grey marker at the last position with the time it was seen.', 3);

  const leads = {};
  for (const [k, name, company, service, value, stage, source, follow] of [['l1', 'Rajesh Kumar', 'Kumar Textiles', 'E-commerce', 350000, 'proposal', 'Referral', ago(1)], ['l2', 'Priya Menon', 'Menon Dental Clinics', 'Website', 120000, 'meeting', 'Website', inn(2)],
    ['l3', 'Arjun Patel', 'Patel Foods', 'Web application', 600000, 'negotiation', 'LinkedIn', inn(1)], ['l4', 'Divya Iyer', 'Iyer & Co. CA', 'Website', 60000, 'new', 'Instagram', inn(5)], ['l5', 'Sameer Khan', 'Khan Auto Spares', 'CRM / ERP / Custom software', 280000, 'contacted', 'Cold call / email', inn(3)], ['l6', 'Lata Pillai', 'Pillai Events', 'Mobile app', 400000, 'lost', 'Event / Meetup', null]])
    leads[k] = (await call('POST', '/leads', { name, company, service, value, stage: 'new', source, owner_id: u.isha, next_followup: follow, email: name.split(' ')[0].toLowerCase() + '@example.test', phone: '+91 98' + Math.floor(10000000 + Math.random() * 89999999) })).id;
  for (const [k, stage] of [['l1', 'proposal'], ['l2', 'meeting'], ['l3', 'negotiation'], ['l5', 'contacted']]) await call('PUT', `/leads/${leads[k]}`, { stage });
  await call('PUT', `/leads/${leads.l6}`, { stage: 'lost', lost_reason: 'Budget too low for native app' });
  // the sheet-style details: department, heat, market, follow-up round, next step
  for (const [k, department, category, priority, market, city, followup_round, next_action, last] of [
    ['l1', 'Website', 'Retail', 'hot', 'India', 'Surat', 'second', 'Call to walk through the proposal', ago(4)], ['l2', 'Website', 'Doctors', 'medium', 'India', 'Kochi', 'first', 'Send two clinic website examples', ago(6)],
    ['l3', 'Web application', 'Manufacturing', 'hot', 'India', 'Ahmedabad', 'third', 'Revised timeline before Friday', ago(2)], ['l4', 'SaaS product', 'General Services', 'cold', 'India', 'Chennai', 'not_started', '', null],
    ['l5', 'Mobile app', 'Manufacturing', 'medium', 'Foreign', 'Dubai', 'initial', 'Share app demo video', ago(9)], ['l6', 'Mobile app', 'Event Management', 'cold', 'India', 'Pune', 'complete', '', ago(40)]])
    await call('PUT', `/leads/${leads[k]}`, { department, category, priority, market, city, country: market === 'India' ? 'India' : 'UAE', followup_round, next_action, last_contact: last });
  await call('POST', '/notes', { entity_type: 'lead', entity_id: leads.l3, kind: 'call', body: 'Call with Arjun: wants vendor portal + inventory sync. Budget approved up to ₹6L. Needs revised timeline by Friday.' });
  await call('POST', '/notes', { entity_type: 'lead', entity_id: leads.l1, kind: 'meeting', body: 'Demoed our Shopify work. Liked the subscription boxes idea. Sent proposal QUO draft.' });
  await call('POST', '/notes', { entity_type: 'project', entity_id: proj.acme, kind: 'note', body: 'Client confirmed: vehicle count will grow to 200 by year end — design the DB for it.' });

  const mkInv = async (client, project, title, items, issue, due, paid) => {
    const inv = await call('POST', '/invoices', { client_id: client, project_id: project, title, items, issue_date: issue, due_date: due, tax_type: 'cgst_sgst', tax_rate: 18, status: 'sent' });
    for (const [amount, date, tds] of paid || []) await call('POST', '/payments', { invoice_id: inv.id, date, amount, tds: tds || 0, account_id: bank, method: 'Bank transfer / NEFT / RTGS', reference: 'UTR' + Math.floor(Math.random() * 1e9) });
    return inv;
  };
  await mkInv(clients.acme, proj.acme, 'Fleet portal — advance 30%', [{ description: 'Advance payment (30%) — Fleet Tracking Portal', hsn: '998314', qty: 1, rate: 135000 }], ago(44), ago(29), [[159300, ago(40)]]);
  await mkInv(clients.acme, proj.acme, 'Fleet portal — milestone 1', [{ description: 'Design sign-off milestone', hsn: '998314', qty: 1, rate: 90000 }], ago(18), ago(3), [[50000, ago(10)]]);
  await mkInv(clients.green, proj.green, 'Online store — phase 1', [{ description: 'Store redesign & migration', hsn: '998314', qty: 1, rate: 140000 }], ago(30), ago(15), [[165200, ago(14), 0]]);
  await mkInv(clients.green, proj.green, 'Online store — final', [{ description: 'Launch milestone', hsn: '998314', qty: 1, rate: 80000 }], ago(1), inn(14), []);
  await mkInv(clients.bright, proj.bright, 'Website maintenance — last month', [{ description: 'Monthly maintenance plan', hsn: '998313', qty: 1, rate: 6000 }], ago(33), ago(18), [[6080, ago(15), 1000]]);
  const q = await call('POST', '/quotes', { lead_id: leads.l1, title: 'Proposal — Kumar Textiles online store', items: [{ description: 'E-commerce store design & build (up to 100 products)', hsn: '998314', qty: 1, rate: 280000 }, { description: 'Payment gateway + shipping integration', qty: 1, rate: 45000 }], status: 'sent' });
  for (const [category, vendor, amount, tax, d, paid_by_id, project_id] of [['Salaries / Stipends', 'Interns stipend', 24000, 0, ago(5), null, null], ['Software & SaaS', 'Figma + GitHub + Notion', 7800, 1190, ago(12), null, null], ['Hosting & Domains', 'AWS', 9200, 1404, ago(8), null, proj.acme],
    ['Office rent', 'WorkHub Coworking', 30000, 4576, ago(3), null, null], ['Marketing & Ads', 'Google Ads', 15000, 0, ago(22), u.isha, null], ['Freelancers / Contractors', 'Freelance illustrator', 18000, 0, ago(35), null, proj.green], ['Travel', 'Client visit — Mumbai', 6400, 0, ago(26), u.rohan, proj.acme]])
    await call('POST', '/expenses', { category, vendor, amount, tax_amount: tax, date: d, paid_by_id, project_id, account_id: paid_by_id ? null : bank, status: 'paid', description: category });
  // a startup grant, money received from it, and what was spent from it
  const grant = (await call('POST', '/grants', { name: 'State startup seed grant', funder: 'Demo Innovation Council', applied_on: ago(150), requested: 250000, received: 100000, status: 'disbursed', next_report_date: inn(20), notes: 'Second tranche after the progress report.' })).id;
  await call('POST', '/payments', { date: ago(90), amount: 100000, account_id: bank, method: 'Bank transfer / NEFT / RTGS', category: 'Grant', grant_id: grant, reference: 'GRANT-T1' });
  await call('POST', '/expenses', { category: 'Software & tools', vendor: 'Cloud hosting', amount: 18000, date: ago(60), account_id: bank, status: 'paid', description: 'Prototype hosting for a year', grant_id: grant, receipt_url: 'https://example.com/receipt/123' });
  await call('POST', '/documents/link', { title: 'Company registration (shared drive)', category: 'Legal', entity_type: 'general', url: 'https://example.com/docs/registration', expiry_date: inn(45) });
  for (const [client, project, kind, name, vendor, date, cycle, cost, price] of [[clients.bright, proj.bright, 'domain', 'brightpath.example', 'GoDaddy', inn(9), 'yearly', 900, 1500], [clients.green, proj.green, 'hosting', 'GreenLeaf Shopify plan', 'Shopify', inn(21), 'monthly', 2000, 2600], [clients.acme, proj.acme, 'ssl', 'acme staging wildcard SSL', 'Namecheap', inn(40), 'yearly', 3200, 4500], [clients.bright, proj.bright, 'hosting', 'BrightPath shared hosting', 'Hostinger', ago(2), 'yearly', 5400, 8000]])
    await call('POST', '/renewals', { client_id: client, project_id: project, kind, name, vendor, renewal_date: date, cycle, our_cost: cost, client_price: price, status: 'active' });
  await call('POST', '/renewals', { client_id: clients.bright, project_id: proj.bright, kind: 'amc', name: 'Silver AMC — BrightPath', renewal_date: inn(24), cycle: 'monthly', client_price: 6000, status: 'active', notes: 'Monthly backups, plugin updates, uptime monitoring, 5 hrs content changes.' });
  await call('POST', '/maintenance_logs', { project_id: proj.bright, title: 'Fix broken admissions form', type: 'Bug fix', status: 'resolved', hours: 1.5, assignee_id: u.kabir, priority: 'high' });
  await call('POST', '/maintenance_logs', { project_id: proj.bright, title: 'Update gallery with annual-day photos', type: 'Content update', status: 'open', assignee_id: u.kabir, priority: 'medium' });
  await call('POST', '/credentials', { client_id: clients.bright, project_id: proj.bright, label: 'cPanel — brightpath.example', kind: 'Hosting / cPanel', url: 'https://cpanel.hostinger.example:2083', username: 'brightpath_admin', password: 'Demo!cPanel#2026', secret: '2FA recovery codes: 1111-2222, 3333-4444', notes: 'Hostinger business plan' });
  await call('POST', '/credentials', { client_id: clients.acme, project_id: proj.acme, label: 'AWS EC2 — staging', kind: 'Server / SSH', url: 'ec2-13-232-0-1.ap-south-1.compute.amazonaws.com', username: 'ubuntu', password: 'Demo!ssh#key', notes: 'Port 22, key auth preferred' });
  await call('POST', '/events', { title: 'Acme go-live call', date: inn(11), kind: 'Launch / Go-live', project_id: proj.acme, client_id: clients.acme, notes: '11:00 AM, Google Meet' });
  await call('POST', '/events', { title: 'GST filing due', date: inn(8), kind: 'Reminder', notes: 'GSTR-3B' });
  // demo accounts skip the "choose your own password" step (real new accounts still get it)
  db.prepare('UPDATE users SET must_change_password=0').run();

  console.log(`\nDemo data created in: ${process.env.CRM_DATA_DIR}\nLogin (all demo users share a password): ${DEMO_PASSWORD}\n  Founders: aarav@demo.test, meera@demo.test, rohan@demo.test, isha@demo.test\n  Interns:  kabir@demo.test (+maintenance access), tara@demo.test\n`);
  server.close(); process.exit(0);
}
run().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
