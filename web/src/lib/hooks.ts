import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, qs, type Row } from './api';
import { useToast } from '../ui/Toasts';

/** GET any API path as a cached query. */
export function useGet<T = unknown>(path: string | null, params?: Record<string, unknown>, opts: { refetchInterval?: number } = {}) {
  const url = path ? `${path}${params ? qs(params) : ''}` : '';
  return useQuery({ queryKey: ['get', url], queryFn: () => api.get<T>(url), enabled: !!path, ...opts });
}

/** A resource list (no paging UI): the first `limit` rows matching the filters. */
export function useRows<T extends Row = Row>(resource: string | null, params: Record<string, unknown> = {}, enabled = true) {
  const p = { limit: 200, ...params };
  return useQuery({ queryKey: ['rows', resource, p], queryFn: () => api.page<T>(`/${resource}${qs(p)}`), enabled: !!resource && enabled });
}

/** One record by id. */
export function useRecord<T extends Row = Row>(resource: string, id: string | number | undefined) {
  return useQuery({ queryKey: ['record', resource, id], queryFn: () => api.get<T>(`/${resource}/${id}`), enabled: !!id });
}

/** POST/PUT/DELETE with a success toast, error toast and a refresh of every cached query. */
export function useAct<A = void, R = unknown>(fn: (a: A) => Promise<R>, ok?: string | ((r: R) => string), after?: (r: R) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      const msg = typeof ok === 'function' ? ok(r) : ok;
      if (msg) toast.ok(msg);
      after?.(r);
    },
    onError: (e) => toast.fail(e),
  });
}

export function useRefresh() {
  const qc = useQueryClient();
  return (key?: QueryKey) => qc.invalidateQueries(key ? { queryKey: key } : undefined);
}

/** A string query-string parameter that survives reloads and the back button. */
export function useParam(name: string, fallback = ''): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  const v = sp.get(name) ?? fallback;
  return [v, (next: string) => setSp((p) => { const n = new URLSearchParams(p); if (next && next !== fallback) n.set(name, next); else n.delete(name); return n; }, { replace: true })];
}
