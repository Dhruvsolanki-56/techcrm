import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, qs, setUnauthorizedHandler } from '../src/lib/api';

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(() => {}); });

describe('api client', () => {
  it('always sends the CSRF header and JSON bodies', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await api.post('/leads', { company: 'Acme' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/leads');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('crm');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"company":"Acme"}');
    expect(init.credentials).toBe('same-origin');
  });
  it('reads rows and the total count of a page', async () => {
    fetchMock.mockResolvedValue(json([{ id: 1 }, { id: 2 }], { headers: { 'Content-Type': 'application/json', 'X-Total-Count': '57' } }));
    const r = await api.page('/leads?limit=2');
    expect(r.rows).toHaveLength(2);
    expect(r.total).toBe(57);
  });
  it('turns server errors into readable messages', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Company / Person is required.' }, { status: 400 }));
    await expect(api.post('/leads', {})).rejects.toMatchObject({ message: 'Company / Person is required.', status: 400 });
  });
  it('explains a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(api.get('/leads')).rejects.toThrow(/Cannot reach the server/);
  });
  it('signs the person out of the screen on 401, but not for the sign-in call itself', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json({ error: 'Sign in required' }, { status: 401 }));
    await expect(api.get('/leads')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: null, e: 'x y' })).toBe('?a=1&e=x+y');
    expect(qs({})).toBe('');
  });
});
