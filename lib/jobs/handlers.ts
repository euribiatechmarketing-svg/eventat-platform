// Job kind -> handler. Each feature module adds its handlers here.
// A handler receives the payload it was scheduled with and must be idempotent.
export const JOB_HANDLERS = {
  /** Keeps the registry non-empty; does nothing. */
  noop: async (_payload: Record<string, unknown>) => {},
} satisfies Record<string, (payload: Record<string, unknown>) => Promise<void>>;
