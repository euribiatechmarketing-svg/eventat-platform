// Throttle for the auth server actions (sign-in, ‹Забравена парола?›, codes, sign-up, team invites).
// They call auth.api directly, and Better Auth applies its rate limiter only to requests through its
// own HTTP router, so without this a script could post the sign-in action without end (password
// guessing, credential stuffing) or send unlimited reset emails. Counted in auth_throttle, so every
// server instance shares the count. Rate limits run on the database clock (wall time), like the
// codes themselves — not on the business clock.
import { eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import { authThrottle } from '@/db/schema';

export type Limit = { max: number; windowSec: number };

const MIN = 60;
/** Attempts per key and window. A successful sign-in clears its address's count. */
export const LIMITS = {
  /** ‹Влез› and an existing account accepting a team invite: per address, and per IP. */
  signInEmail: { max: 10, windowSec: 15 * MIN },
  signInIp: { max: 100, windowSec: 15 * MIN },
  /** Reset links (‹Забравена парола?›, ‹Смени паролата›): per address, and per IP. */
  resetEmail: { max: 3, windowSec: 60 * MIN },
  resetIp: { max: 20, windowSec: 60 * MIN },
  /** New profiles per IP. */
  registerIp: { max: 10, windowSec: 60 * MIN },
  /** Code entries (email confirmation, the SMS step) per address / user, and per IP. */
  codeKey: { max: 20, windowSec: 60 * MIN },
  codeIp: { max: 100, windowSec: 60 * MIN },
  /** New codes sent on request (after the 60 s cooldown) per address / user. */
  codeSend: { max: 10, windowSec: 60 * MIN },
  /** Files one user may store (media.upload): per hour and per day. */
  uploadHour: { max: 60, windowSec: 60 * MIN },
  uploadDay: { max: 200, windowSec: 24 * 60 * MIN },
} satisfies Record<string, Limit>;

/** Limits that are business rules, not auth throttles: AUTH_RATE_LIMIT=off leaves them on. */
const ALWAYS_ON: LimitName[] = ['uploadHour', 'uploadDay'];

export type LimitName = keyof typeof LIMITS;

/** Off only where AUTH_RATE_LIMIT=off (local end-to-end runs, as for Better Auth's limiter). */
export const throttleEnabled = (name?: LimitName) => (name !== undefined && ALWAYS_ON.includes(name)) || process.env.AUTH_RATE_LIMIT !== 'off';

const keyOf = (name: LimitName, id: string) => `${name}:${id.trim().toLowerCase()}`;

/**
 * Count one attempt for `id` under a limit; false once the window's attempts exceed the limit.
 * Atomic (one upsert), so parallel requests cannot all slip under the limit.
 */
export async function hit(name: LimitName, id: string | null | undefined, q: Queryable = db): Promise<boolean> {
  if (!throttleEnabled(name) || !id) return true;
  const { max, windowSec } = LIMITS[name];
  const key = keyOf(name, id);
  const expired = sql`${authThrottle.windowStart} <= now() - make_interval(secs => ${windowSec}::int)`;
  const [r] = await q.insert(authThrottle).values({ key, hits: 1, windowStart: sql`now()` })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        hits: sql`case when ${expired} then 1 else ${authThrottle.hits} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${authThrottle.windowStart} end`,
      },
    })
    .returning({ hits: authThrottle.hits });
  return r.hits <= max;
}

/** Count one attempt under every limit given; false if any is exceeded (all are counted). */
export async function hitAll(checks: [LimitName, string | null | undefined][], q: Queryable = db): Promise<boolean> {
  let ok = true;
  for (const [name, id] of checks) if (!(await hit(name, id, q))) ok = false;
  return ok;
}

/** Forget the attempts for `id` (a successful sign-in). */
export async function clearHits(name: LimitName, id: string | null | undefined, q: Queryable = db): Promise<void> {
  if (!id) return;
  await q.delete(authThrottle).where(eq(authThrottle.key, keyOf(name, id)));
}

/** Rows whose window ended long ago (housekeeping from the cron tick). */
export async function pruneThrottle(q: Queryable = db): Promise<number> {
  const longest = Math.max(...Object.values(LIMITS).map(l => l.windowSec));
  const rows = await q.delete(authThrottle).where(sql`${authThrottle.windowStart} < now() - make_interval(secs => ${longest}::int)`).returning({ key: authThrottle.key });
  return rows.length;
}
