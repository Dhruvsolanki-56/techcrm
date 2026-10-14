import type { User } from '../security/permissions';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireUser for every signed-in request. */
      user?: User;
      /** The session token of the current request (to keep it when other sessions are signed out). */
      sessionToken?: string;
    }
  }
}

export {};
