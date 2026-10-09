// Job handlers of the open requests (lib/domain/briefs.ts, SPEC §3 T3).
// Wrapped in arrow functions: lib/jobs imports this file and the domain module
// imports lib/jobs, so the binding is read only when a job runs.
import * as briefs from '@/lib/domain/briefs';

type Handler = (p: Record<string, unknown>) => Promise<void>;

export const briefHandlers: Record<string, Handler> = {
  'brief.invitation_expire': p => briefs.invitationExpireJob(p),   // T3
};
