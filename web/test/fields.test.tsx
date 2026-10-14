import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Field, validate } from '../src/forms/Fields';
import { FORMS } from '../src/forms/schema';
import type { Lookups } from '../src/lib/session';

const lookups: Lookups = {
  users: [{ id: 1, name: 'Esha', role: 'founder', title: null }], clients: [], projects: [], accounts: [], leads: [], grants: [],
  settings: { lead_sources: 'Referral\nWebsite', lead_categories: 'NGO', lead_services: 'Website', lead_products: '' },
};
vi.mock('../src/lib/session', async (orig) => ({ ...(await orig<typeof import('../src/lib/session')>()), useSession: () => ({ lookups, isFounder: true, user: { id: 1 }, can: () => true }) }));

const leadForm = () => (FORMS.leads as NonNullable<(typeof FORMS)['leads']>)({ lookups, isFounder: true, rec: null });

describe('form validation (same rules as the server)', () => {
  it('asks for what is required', () => {
    const e = validate('leads', leadForm(), { company: '', stage: 'new', followup_round: 'not_started' });
    expect(e.name).toBe('Enter a company, a contact person, or pick an existing client.');
    expect(validate('leads', leadForm(), { client_id: 3, stage: 'new', followup_round: 'not_started' }).name).toBeUndefined(); // an existing client is enough
    expect(validate('leads', leadForm(), { name: 'Asha', stage: 'new', followup_round: 'not_started' }).name).toBeUndefined(); // so is just a person
  });
  it('checks phone, email, URL and dates', () => {
    const e = validate('leads', leadForm(), { company: 'Acme', stage: 'new', followup_round: 'not_started', phone: '12', email: 'nope', website: 'not a site', next_followup: '2026-02-30' });
    expect(e.phone).toMatch(/phone number/);
    expect(e.email).toMatch(/valid email/);
    expect(e.website).toMatch(/web address/);
    expect(e.next_followup).toMatch(/real date/);
  });
  it('accepts a clean record', () => {
    expect(validate('leads', leadForm(), { company: 'Acme', stage: 'new', followup_round: 'not_started', phone: '+91 98765 43210', email: 'a@b.co', value: 5000 })).toEqual({});
  });
  it('catches a deadline before the start date', () => {
    const items = (FORMS.projects as NonNullable<(typeof FORMS)['projects']>)({ lookups, isFounder: true, rec: null });
    expect(validate('projects', items, { name: 'X', client_id: '1', status: 'active', priority: 'medium', start_date: '2026-05-10', deadline: '2026-05-01' })._form).toMatch(/Deadline cannot be before/);
  });
  it('has a form for every resource that has a create button', () => {
    for (const r of ['leads', 'clients', 'contacts', 'projects', 'tasks', 'change_requests', 'documents', 'payments', 'expenses', 'accounts', 'transfers', 'renewals', 'maintenance_logs', 'grants', 'assets', 'bank_transactions', 'events']) {
      expect(FORMS[r], r).toBeTypeOf('function');
      expect((FORMS[r] as NonNullable<(typeof FORMS)[string]>)({ lookups, isFounder: true, rec: null }).length, r).toBeGreaterThan(2);
    }
  });
});

function Harness({ name, resource, label }: { name: string; resource: string; label: string }) {
  const [v, setV] = useState<unknown>('');
  return <Field f={{ name, label }} resource={resource} value={v} onChange={setV} />;
}

describe('field input', () => {
  it('drops characters a name can never hold while typing', async () => {
    render(<Harness name="name" resource="contacts" label="Name" />);
    const input = screen.getByLabelText('Name');
    await userEvent.type(input, 'Ravi 123 Kumar');
    expect(input).toHaveValue('Ravi  Kumar');
  });
  it('keeps what was typed for tax numbers (capitals are applied on save)', async () => {
    render(<Harness name="gstin" resource="clients" label="GSTIN" />);
    await userEvent.type(screen.getByLabelText('GSTIN'), '27abcde1234f1z5');
    expect(screen.getByLabelText('GSTIN')).toHaveValue('27abcde1234f1z5');
  });
});
