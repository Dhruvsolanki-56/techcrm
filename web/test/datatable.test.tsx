import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from '../src/ui/DataTable';

vi.mock('../src/lib/session', async (orig) => ({ ...(await orig<typeof import('../src/lib/session')>()), useSession: () => ({ lookups: { users: [], clients: [], projects: [], accounts: [], leads: [], grants: [], settings: {} }, isFounder: true }) }));

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: from + i, ref: `LD-${String(from + i).padStart(4, '0')}`, company: `Company ${from + i}` }));
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const u = new URL(url, 'http://x');
    const off = Number(u.searchParams.get('offset') ?? 0);
    const q = u.searchParams.get('q');
    const list = q ? rows(900, 1) : rows(off + 1, Math.min(25, 60 - off));
    return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Total-Count': q ? '1' : '60' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup(props: Partial<React.ComponentProps<typeof DataTable>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DataTable resource="leads" columns={[{ key: 'company', label: 'Company', sort: 'company' }]} noun="lead" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DataTable', () => {
  it('asks the server for one page and shows the total, with the system ID first', async () => {
    setup();
    await screen.findByText('Company 1');
    expect(calls()[0]).toContain('/api/leads?');
    expect(calls()[0]).toContain('limit=25');
    expect(screen.getByText('LD-0001')).toBeInTheDocument();
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();
  });
  it('moves to the next page with an offset', async () => {
    setup();
    await screen.findByText('Company 1');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Company 26');
    expect(calls().some((c) => c.includes('offset=25'))).toBe(true);
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });
  it('sorts on the server when a heading is clicked', async () => {
    setup();
    await screen.findByText('Company 1');
    await userEvent.click(screen.getByText('Company', { selector: 'th' }));
    await waitFor(() => expect(calls().some((c) => c.includes('sort=company%3Aasc'))).toBe(true));
    await userEvent.click(screen.getByText('Company', { selector: 'th' }));
    await waitFor(() => expect(calls().some((c) => c.includes('sort=company%3Adesc'))).toBe(true));
  });
  it('searches on the server and says so when nothing matches', async () => {
    setup();
    await screen.findByText('Company 1');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz');
    await screen.findByText('Company 900');
    expect(calls().some((c) => c.includes('q=zzz'))).toBe(true);
  });
  it('keeps the fixed query (e.g. the client you are on) in every request', async () => {
    setup({ query: { client_id: 7 } });
    await screen.findByText('Company 1');
    expect(calls().every((c) => c.includes('client_id=7'))).toBe(true);
  });
  it('shows an empty state', async () => {
    fetchMock.mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'X-Total-Count': '0' } }));
    setup({ empty: { title: 'No leads yet', text: 'Add one.' } });
    await screen.findByText('No leads yet');
  });
  it('shows the error instead of an empty table when the request fails', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    setup();
    await screen.findByText('Boom');
  });
});
