import crypto from 'node:crypto';

/** Two-step login: TOTP, RFC 6238 — works with Google Authenticator, Authy, 1Password … */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Uint8Array): string {
  let bits = 0;
  let val = 0;
  let out = '';
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function unbase32(s: string): Buffer {
  let bits = 0;
  let val = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = (h[h.length - 1] ?? 0) & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

export const newTotpSecret = (): string => base32(crypto.randomBytes(20));

/** Returns the matching 30 s time step (±1 step of clock drift) or null. Steps <= lastStep are refused, so a code cannot be replayed. */
export function checkTotp(secretB32: string, code: unknown, lastStep = 0, now = Date.now()): number | null {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = unbase32(secretB32);
  const current = Math.floor(now / 30000);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return null;
}
