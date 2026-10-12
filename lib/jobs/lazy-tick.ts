import 'server-only';
// "Tick on request" (TICK_ON_REQUEST=true): for hosting where the cron can't run every minute
// (Vercel Hobby runs crons once a day), due jobs and queued emails are processed after a page
// response, at most once a minute per server instance, and never twice at the same time across
// instances (a PostgreSQL advisory lock). Production on Vercel Pro uses the per-minute cron instead.
import { sql } from '@/db';
import { runDueJobs } from './index';
import { deliverQueued } from '@/lib/email/send';

const LOCK_KEY = 7_141_201; // arbitrary, unique to this lock
const MIN_INTERVAL_MS = 60_000;
let lastRun = 0;

export function tickOnRequestEnabled(env: Record<string, string | undefined> = process.env) {
  return env.TICK_ON_REQUEST === 'true';
}

/** Run due jobs if the last run on this instance was over a minute ago. Safe to call on every request. */
export async function maybeTick(): Promise<void> {
  if (!tickOnRequestEnabled()) return;
  const t = Date.now(); // wall-clock throttle only; business time stays in lib/clock
  if (t - lastRun < MIN_INTERVAL_MS) return;
  lastRun = t;
  try {
    const [{ locked }] = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!locked) return;
    try {
      await runDueJobs(50);
      await deliverQueued(25);
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'tick on request failed', error: String(e) }));
  }
}
