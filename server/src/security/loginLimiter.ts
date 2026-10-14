const WINDOW = 15 * 60 * 1000;
const LIMITS = { account: 8, ip: 30 } as const;

export interface LoginLimiter {
  tooMany(ip: string, email: string): boolean;
  record(ip: string, email: string, ok: boolean): void;
  sweep(): void;
}

/** 8 failures per IP + email, and 30 per IP across all emails, within 15 minutes. */
export function createLoginLimiter(now: () => number = Date.now): LoginLimiter {
  const attempts = new Map<string, { count: number; first: number }>();
  const blocked = (key: string, max: number): boolean => {
    const a = attempts.get(key);
    return !!a && a.count >= max && now() - a.first < WINDOW;
  };
  const bump = (key: string): void => {
    const a = attempts.get(key);
    if (!a || now() - a.first > WINDOW) attempts.set(key, { count: 1, first: now() });
    else a.count++;
  };
  return {
    tooMany: (ip, email) => blocked(`ip|${ip}`, LIMITS.ip) || blocked(`acct|${ip}|${email}`, LIMITS.account),
    record(ip, email, ok) {
      if (ok) {
        attempts.delete(`acct|${ip}|${email}`);
        return;
      }
      bump(`ip|${ip}`);
      bump(`acct|${ip}|${email}`);
    },
    sweep() {
      for (const [k, a] of attempts) if (now() - a.first > WINDOW) attempts.delete(k);
    },
  };
}
