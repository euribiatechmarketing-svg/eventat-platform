// Security: the sign-in, reset and code server actions call auth.api directly, so Better Auth's
// HTTP rate limiter never saw them (auth-rate-limit-bypassed-by-server-actions). They now count
// attempts in auth_throttle (lib/domain/throttle), shared by every server instance.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authThrottle } from '@/db/schema';
import { LIMITS, clearHits, hit, hitAll, pruneThrottle } from '@/lib/domain/throttle';

afterEach(() => vi.unstubAllEnvs());

describe('auth throttle', () => {
  it('stops password guessing on one address after the limit; another address is unaffected', async () => {
    const victim = 'owner.admin@eventat.bg';
    const max = LIMITS.signInEmail.max;
    for (let i = 0; i < max; i++) expect(await hit('signInEmail', victim)).toBe(true);
    expect(await hit('signInEmail', victim)).toBe(false);
    expect(await hit('signInEmail', 'Owner.Admin@eventat.bg')).toBe(false); // case does not matter
    expect(await hit('signInEmail', 'someone.else@eventat.bg')).toBe(true);
    await clearHits('signInEmail', victim); // a successful sign-in
    expect(await hit('signInEmail', victim)).toBe(true);
  });

  it('parallel requests cannot slip past the limit', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => hit('resetEmail', 'flood@example.com')));
    expect(results.filter(Boolean)).toHaveLength(LIMITS.resetEmail.max);
  });

  it('every limit of a request is counted; the window resets', async () => {
    expect(await hitAll([['codeKey', 'a@example.com'], ['codeIp', '203.0.113.7']])).toBe(true);
    for (let i = 1; i < LIMITS.codeKey.max; i++) await hit('codeKey', 'a@example.com');
    expect(await hitAll([['codeKey', 'a@example.com'], ['codeIp', '203.0.113.7']])).toBe(false);
    const [ip] = await db.select().from(authThrottle).where(eq(authThrottle.key, 'codeIp:203.0.113.7'));
    expect(ip.hits).toBe(2);
    await db.update(authThrottle).set({ windowStart: sql`now() - interval '2 hours'` }).where(eq(authThrottle.key, 'codeKey:a@example.com'));
    expect(await hit('codeKey', 'a@example.com')).toBe(true);
    await db.update(authThrottle).set({ windowStart: sql`now() - interval '2 days'` });
    expect(await pruneThrottle()).toBeGreaterThan(0);
  });

  it('AUTH_RATE_LIMIT=off (local end-to-end runs) turns it off', async () => {
    vi.stubEnv('AUTH_RATE_LIMIT', 'off');
    for (let i = 0; i < LIMITS.registerIp.max + 5; i++) expect(await hit('registerIp', '198.51.100.1')).toBe(true);
  });
});
