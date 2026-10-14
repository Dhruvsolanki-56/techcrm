import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export interface User {
  id: number; name: string; email: string; role: 'founder' | 'intern'; title: string | null; phone: string | null;
  modules: string[]; must_change_password: boolean; two_factor: boolean; active: boolean; last_login: string | null; created_at: string;
}
export interface AuthState { setup_needed: boolean; user: User | null; company_name: string; logo: string | null; demo: boolean }

export interface Lookups {
  users: { id: number; name: string; role: string; title: string | null }[];
  clients: { id: number; company: string; status: string }[];
  projects: { id: number; name: string; client_id: number | null; status: string; code: string | null }[];
  accounts: { id: number; name: string; type: string }[];
  leads: { id: number; name: string; company: string | null; stage: string }[];
  grants: { id: number; name: string }[];
  settings: Record<string, string | number | null>;
}

interface SessionCtx {
  user: User;
  lookups: Lookups;
  isFounder: boolean;
  can(flag: string): boolean;
  refreshLookups(): Promise<void>;
  refreshUser(): Promise<void>;
  signOut(): Promise<void>;
}
const Ctx = createContext<SessionCtx | null>(null);
export const useSession = (): SessionCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
};

export const authKey = ['auth'] as const;
export const lookupKey = ['lookups'] as const;
export const useAuthState = () => useQuery({ queryKey: authKey, queryFn: () => api.get<AuthState>('/auth/state'), staleTime: 60_000, retry: false });

/** Mounted only while signed in: loads the dropdown lists once and shares the signed-in user. */
export function SessionProvider({ user, children }: { user: User; children: ReactNode }) {
  const qc = useQueryClient();
  const lookupsQ = useQuery({ queryKey: lookupKey, queryFn: () => api.get<Lookups>('/lookups'), staleTime: 5 * 60_000 });

  useEffect(() => {
    setUnauthorizedHandler(() => { void qc.invalidateQueries({ queryKey: authKey }); });
    return () => setUnauthorizedHandler(() => {});
  }, [qc]);

  const refreshLookups = useCallback(async () => { await qc.invalidateQueries({ queryKey: lookupKey }); }, [qc]);
  const refreshUser = useCallback(async () => { await qc.invalidateQueries({ queryKey: authKey }); }, [qc]);
  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    // forget everything this person could see, then show the sign-in screen
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== authKey[0] });
    qc.setQueryData<AuthState>(authKey, (prev) => (prev ? { ...prev, user: null } : prev));
    await qc.invalidateQueries({ queryKey: authKey });
  }, [qc]);

  const value = useMemo<SessionCtx | null>(() => {
    if (!lookupsQ.data) return null;
    const founder = user.role === 'founder';
    return { user, lookups: lookupsQ.data, isFounder: founder, can: (f) => founder || user.modules.includes(f), refreshLookups, refreshUser, signOut };
  }, [user, lookupsQ.data, refreshLookups, refreshUser, signOut]);

  if (lookupsQ.isError) return <div className="empty" style={{ marginTop: 120 }}><b>Could not load the workspace</b>{(lookupsQ.error as Error).message}</div>;
  if (!value) return <div className="empty" style={{ marginTop: 120 }}>Loading…</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Dropdown lists kept by founders in Settings (one value per line). */
export function settingList(lookups: Lookups, key: string): string[] {
  return String(lookups.settings[key] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
}
