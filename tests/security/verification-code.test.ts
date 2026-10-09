// Security: ‹Сменете имейла› on the code screen ends the code only for the browser that started
// the sign-up (unauth-invalidate-verification-otp). The server action needs no session, so before
// the fix anyone could post a victim's address in a loop and delete every code the victim received.
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { verification } from '@/db/schema';
import { invalidateEmailCode, signupProof } from '@/lib/domain/views-auth-account';

const VICTIM = 'victim.signup@example.com';
const id = `email-verification-otp-${VICTIM}`;
const codeRow = async () => db.select().from(verification).where(eq(verification.identifier, id));

describe('invalidateEmailCode', () => {
  it('a stranger cannot delete the code; the browser that signed up can', async () => {
    await db.insert(verification).values({ id: 'v-signup-1', identifier: id, value: '482913:0', expiresAt: new Date(Date.now() + 600_000) });

    expect(await invalidateEmailCode(VICTIM, null)).toBe(false);
    expect(await invalidateEmailCode(VICTIM, signupProof('attacker@example.com'))).toBe(false);
    expect(await invalidateEmailCode(VICTIM, 'forged')).toBe(false);
    expect(await codeRow()).toHaveLength(1);

    expect(await invalidateEmailCode(VICTIM.toUpperCase(), signupProof(VICTIM))).toBe(true);
    expect(await codeRow()).toHaveLength(0);
  });
});
