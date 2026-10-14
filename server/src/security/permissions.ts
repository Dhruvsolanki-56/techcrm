import { INTERN_FLAGS, type InternFlag } from '@crm/shared';

/** The signed-in person (a row of the users table). */
export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'founder' | 'intern';
  modules: string;
  title: string | null;
  phone: string | null;
  active: number;
  must_change_password: number;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last: number;
  last_login: string | null;
  created_at: string;
}

export const isFounder = (u: Pick<User, 'role'>): boolean => u.role === 'founder';

export function flagsOf(u: Pick<User, 'modules'>): string[] {
  try {
    const v = JSON.parse(u.modules || '[]') as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Founders have every flag; an intern only the (known) ones a founder switched on for them. */
export const hasFlag = (u: Pick<User, 'role' | 'modules'>, flag: InternFlag): boolean =>
  isFounder(u) || ((INTERN_FLAGS as readonly string[]).includes(flag) && flagsOf(u).includes(flag));

/** What the browser may know about a user — never the password hash or the two-step secret. */
export function publicUser(u: User) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, phone: u.phone,
    modules: flagsOf(u).filter((f) => (INTERN_FLAGS as readonly string[]).includes(f)),
    must_change_password: !!u.must_change_password, two_factor: !!u.totp_enabled,
    active: !!u.active, last_login: u.last_login, created_at: u.created_at,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;
