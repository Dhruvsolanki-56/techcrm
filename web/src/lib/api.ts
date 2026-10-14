/** One place that talks to the server: adds the CSRF header, parses errors, reads the total-count header. */

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

type Json = Record<string, unknown>;
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void): void => { onUnauthorized = fn; };

async function raw(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'crm' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let data: Json = {};
    try { data = (await res.json()) as Json; } catch { /* not JSON */ }
    if (res.status === 401 && !url.startsWith('/auth/') && !data.need_code) onUnauthorized();
    throw new ApiError(res.status, String(data.error ?? `Request failed (${res.status})`), data);
  }
  return res;
}

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await raw(method, url, body);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T = unknown>(url: string) => json<T>('GET', url),
  post: <T = unknown>(url: string, body?: unknown) => json<T>('POST', url, body ?? {}),
  put: <T = unknown>(url: string, body?: unknown) => json<T>('PUT', url, body ?? {}),
  del: <T = unknown>(url: string) => json<T>('DELETE', url),
  /** A page of a resource plus how many rows match in total. */
  async page<T = Json>(url: string): Promise<{ rows: T[]; total: number }> {
    const res = await raw('GET', url);
    const rows = (await res.json()) as T[];
    return { rows, total: Number(res.headers.get('X-Total-Count') ?? rows.length) };
  },
};

export type Row = Json & { id: number };

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
