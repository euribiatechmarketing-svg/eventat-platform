import 'server-only';
// The platform's clock. Production: real time. Demo and test environments
// (ALLOW_TIME_TRAVEL=true) can shift it, so the seeded demo data — which
// follows the prototype's "today", Sunday 31 August 2025 — stays coherent
// and timers (24 h deadlines, payouts on the 1st/15th) can be shown working.
import { sql } from '@/db';

let cached: { offsetMs: number; at: number } | null = null;

export async function clockOffsetMs(): Promise<number> {
  if (process.env.ALLOW_TIME_TRAVEL !== 'true') return 0;
  if (cached && Date.now() - cached.at < 5_000) return cached.offsetMs;
  const rows = await sql<{ value: string }[]>`select value::text as value from platform_settings where key = 'clock_offset_ms' limit 1`.catch(() => []);
  const offsetMs = rows.length ? Number(JSON.parse(rows[0].value)) || 0 : 0;
  cached = { offsetMs, at: Date.now() };
  return offsetMs;
}

/** Current instant for all business logic. Never call new Date() for business time. */
export async function now(): Promise<Date> {
  return new Date(Date.now() + (await clockOffsetMs()));
}

export function invalidateClock() { cached = null; }
