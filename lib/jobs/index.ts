import 'server-only';
// Deadlines and reminders are rows in `job`. The cron tick (every minute in
// production; `npm run tick` or Админ → Настройки → часовник in demo) runs
// every due job: a runner claims a row (FOR UPDATE SKIP LOCKED) by leasing it
// and commits before the handler runs, so no job row stays locked while a
// handler works. A run that crashes is retried when its lease ends.
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

/** How long a claimed job belongs to its runner. A run that dies is picked up again after this. */
export const JOB_LEASE_MS = 5 * 60_000;

/**
 * Run every job due at the platform clock's "now". Returns how many ran.
 *
 * The claim moves `run_at` to the end of a lease and commits at once; the
 * handler then runs with the job row unlocked. Holding the row lock across the
 * handler deadlocks invisibly: a handler waits for a business row (T8 locks the
 * booking) that another transaction holds while it cancels or moves this very
 * job (a payment arriving at the deadline cancels T8; ‹Удължи срока› moves it),
 * and that transaction then waits for the job row held by this idle runner —
 * a cycle PostgreSQL cannot see. The run is recorded only if nobody cancelled
 * or re-scheduled the job meanwhile; such a change wins.
 */
export async function runDueJobs(limit = 100): Promise<{ ran: number; failed: number }> {
  const at = await now();
  let ran = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const lease = new Date(at.getTime() + JOB_LEASE_MS).toISOString();
    const rows = await sql<{ id: string; kind: string; payload: Record<string, unknown>; attempts: number }[]>`
      update job set run_at = ${lease}::timestamptz, attempts = attempts + 1
      where id = (select id from job where status = 'pending' and run_at <= ${at.toISOString()}::timestamptz
                  order by run_at limit 1 for update skip locked)
      returning id, kind, payload, attempts`;
    if (!rows.length) break;
    const r = rows[0];
    try {
      const handler = (JOB_HANDLERS as Record<string, (p: Record<string, unknown>) => Promise<void>>)[r.kind];
      if (!handler) throw new Error(`No handler for job kind ${r.kind}`);
      await handler(r.payload);
      await sql`update job set status = 'done', done_at = now()
                where id = ${r.id} and status = 'pending' and run_at = ${lease}::timestamptz`;
      ran++;
    } catch (e) {
      await sql`update job set last_error = ${String(e)}, status = ${r.attempts >= 5 ? 'failed' : 'pending'},
                run_at = ${new Date(at.getTime() + r.attempts * 60_000).toISOString()}::timestamptz
                where id = ${r.id} and status = 'pending' and run_at = ${lease}::timestamptz`;
      failed++;
    }
  }
  return { ran, failed };
}

export { dsql };
