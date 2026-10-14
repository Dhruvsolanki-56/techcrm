import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

/** scrypt$salt$hash — a fresh random salt per password. */
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return false;
    const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, SCRYPT);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

/** Compared against when the email is unknown, so a wrong email takes as long as a wrong password. */
export const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

/** A readable reason the password is not acceptable, or null when it is fine. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long (max 200 characters).';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}
