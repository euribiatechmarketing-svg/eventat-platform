// Job handlers registered by the catalogue modules.
// Keys are the SPEC §3 "Job kind" names (e.g. `request.expire`). A handler receives
// the payload it was scheduled with, must re-check state and be idempotent.
// Only this module's code edits this file; lib/jobs/handlers.ts merges it.
export const catalogueHandlers: Record<string, (p: Record<string, unknown>) => Promise<void>> = {};
