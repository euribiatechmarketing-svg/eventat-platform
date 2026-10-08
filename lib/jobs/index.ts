import 'server-only';
// Deadlines and reminders are rows in `job`. The cron tick (every minute in
// production; `npm run tick` or Админ → Настройки → часовник in demo) runs
// every due job exactly once: rows are claimed with FOR UPDATE SKIP LOCKED.
// Handlers must be idempotent and must re-check the entity's state, because a
// deadline job can outlive the situation that created it.
import { and, eq, like, sql as dsql } from 'drizzle-orm';
import { db, sql, type Tx } from '@/db';
import { job } from '@/db/schema';
import { now } from '@/lib/clock';
import { JOB_HANDLERS } from './handlers';

export type JobKind = keyof typeof JOB_HANDLERS;

/** Schedule a job. Same dedupeKey = scheduled once (re-scheduling updates run_at). */
export async function scheduleJob(kind: JobKind, runAt: Date, payload: Record<string, unknown>, dedupeKey: string, tx?: Tx) {
  const q = tx ?? db;
  await q.insert(job).values({ kind, runAt, payload, dedupeKey })
    .onConflictDoUpdate({ target: job.dedupeKey, set: { runAt, payload, status: 'pending', attempts: 0, lastError: null } });
}

/** Cancel pending jobs whose dedupeKey starts with a prefix, e.g. `request:<id>:`. */
export async function cancelJobs(dedupePrefix: string, tx?: Tx) {
  const q = tx ?? db;
  await q.update(job).set({ status: 'cancelled' }).where(and(eq(job.status, 'pending'), like(job.dedupeKey, `${dedupePrefix}%`)));
}

/** Run every job due at the platform clock's "now". Returns how many ran. */
export async function runDueJobs(limit = 100): Promise<{ ran: number; failed: number }> {
  const at = await now();
  let ran = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const claimed = await sql.begin(async t => {
      const rows = await t<{ id: string; kind: string; payload: Record<string, unknown>; attempts: number }[]>`
        select id, kind, payload, attempts from job
        where status = 'pending' and run_at <= ${at.toISOString()}::timestamptz
        order by run_at limit 1 for update skip locked`;
      if (!rows.length) return null;
      const r = rows[0];
      try {
        const handler = (JOB_HANDLERS as Record<string, (p: Record<string, unknown>) => Promise<void>>)[r.kind];
        if (!handler) throw new Error(`No handler for job kind ${r.kind}`);
        await handler(r.payload);
        await t`update job set status = 'done', done_at = now(), attempts = ${r.attempts + 1} where id = ${r.id}`;
        return { ok: true };
      } catch (e) {
        const attempts = r.attempts + 1;
        await t`update job set attempts = ${attempts}, last_error = ${String(e)}, status = ${attempts >= 5 ? 'failed' : 'pending'},
                run_at = ${new Date(at.getTime() + attempts * 60_000).toISOString()}::timestamptz where id = ${r.id}`;
        return { ok: false };
      }
    });
    if (!claimed) break;
    if (claimed.ok) ran++; else failed++;
  }
  return { ran, failed };
}

export { dsql };
