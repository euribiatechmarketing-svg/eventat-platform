import 'server-only';
// The platform's clock. Production: real time. Demo and test environments
// (ALLOW_TIME_TRAVEL=true) can shift it, so the seeded demo data — which
// follows the prototype's "today", Sunday 31 August 2025 — stays coherent
// and timers (24 h deadlines, payouts on the 1st/15th) can be shown working.
// Tests freeze it with setTestNow().
import { sql } from '@/db';

let cached: { offsetMs: number; at: number } | null = null;
let testNow: Date | null = null;

/** True under vitest (or NODE_ENV=test); only then does setTestNow() do anything. */
const isTestEnv = () => process.env.NODE_ENV === 'test' || !!process.env.VITEST;

export async function clockOffsetMs(): Promise<number> {
  if (process.env.ALLOW_TIME_TRAVEL !== 'true') return 0;
  if (cached && Date.now() - cached.at < 5_000) return cached.offsetMs;
  const rows = await sql<{ value: string }[]>`
    select value::text as value from platform_settings where key = 'clock_offset_ms'
    order by effective_from desc, created_at desc limit 1`.catch(() => []);
  const offsetMs = rows.length ? Number(JSON.parse(rows[0].value)) || 0 : 0;
  cached = { offsetMs, at: Date.now() };
  return offsetMs;
}

/** Current instant for all business logic. Never call new Date() for business time. */
export async function now(): Promise<Date> {
  if (testNow && isTestEnv()) return new Date(testNow.getTime());
  return new Date(Date.now() + (await clockOffsetMs()));
}

export function invalidateClock() { cached = null; }

/** Tests only: freeze now() at `d` (null = back to the real clock). Ignored outside tests. */
export function setTestNow(d: Date | null) {
  if (!isTestEnv()) return;
  testNow = d ? new Date(d.getTime()) : null;
}

/** Tests only: move a frozen test clock forward by `ms`. */
export function advanceTestNow(ms: number) {
  if (!isTestEnv() || !testNow) return;
  testNow = new Date(testNow.getTime() + ms);
}
