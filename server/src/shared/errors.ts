/** An error whose message is safe and useful to show to the person using the app. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, code?: string): HttpError => new HttpError(400, msg, code);
export const forbidden = (msg = 'You do not have access to this.'): HttpError => new HttpError(403, msg);
export const notFound = (msg = 'Not found (or you do not have access).'): HttpError => new HttpError(404, msg);
export const conflict = (msg: string): HttpError => new HttpError(409, msg);

/** Throws a 400 with `msg` unless `cond` holds. */
export function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw badRequest(msg);
}
