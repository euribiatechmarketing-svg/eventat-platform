// Job kind -> handler. Each group of modules registers its handlers in its
// own file (handlers-lifecycle / -aftercare / -catalogue); this file only
// merges them. Kinds are SPEC §3's "Job kind" names. A handler receives the
// payload it was scheduled with and must be idempotent.
import { aftercareHandlers } from './handlers-aftercare';
import { catalogueHandlers } from './handlers-catalogue';
import { lifecycleHandlers } from './handlers-lifecycle';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const groups: Record<string, Record<string, JobHandler>> = {
  core: {
    /** Keeps the registry non-empty; does nothing. */
    noop: async (_payload: Record<string, unknown>) => {},
  },
  lifecycle: lifecycleHandlers,
  aftercare: aftercareHandlers,
  catalogue: catalogueHandlers,
};

function merge(gs: Record<string, Record<string, JobHandler>>): Record<string, JobHandler> {
  const out: Record<string, JobHandler> = {};
  const owner: Record<string, string> = {};
  for (const [g, handlers] of Object.entries(gs)) {
    for (const [kind, h] of Object.entries(handlers)) {
      if (kind in out) throw new Error(`Job kind "${kind}" is registered by both ${owner[kind]} and ${g}`);
      out[kind] = h;
      owner[kind] = g;
    }
  }
  return out;
}

export const JOB_HANDLERS: Record<string, JobHandler> = merge(groups);
