import type { z } from 'zod';
import { HttpError } from '../shared/errors';

/** Parses `data` with a zod schema; a failure becomes a 400 whose message names the field in plain English. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue?.path.join('.');
  const msg = issue?.message && !/^Invalid input/i.test(issue.message) ? issue.message : field ? `${field.replace(/_/g, ' ')} is missing or not valid.` : 'The request is not valid.';
  throw new HttpError(400, msg);
}

/** A whole number, or null: "12abc" and "1 OR 1=1" are not numbers. */
export const intOrNull = (v: unknown): number | null => (/^-?\d{1,15}$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null);

/** Trimmed string capped at `max` characters, or null when empty. */
export const str = (v: unknown, max = 500): string | null => (v == null ? null : String(v).trim().slice(0, max) || null);
