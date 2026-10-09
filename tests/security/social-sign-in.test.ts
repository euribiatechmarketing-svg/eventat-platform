// Security (F1, social-unverified-email-takeover): ‹Продължи с Facebook› with someone else's address
// on the Facebook profile. Better Auth never reads a verified flag from Facebook, yet it created the
// user and a session, and /vhod/prodalzhi?nov=1 then marked the address confirmed. When the real
// owner later chose ‹Продължи с Google›, Better Auth linked their Google login to that account.
// Now a social identity counts only with an address the provider vouches for, nobody gets a
// session on an unconfirmed address, and the landing route never confirms one.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { serializeSignedCookie } from 'better-call';
import { db } from '@/db';
import { account, clientProfile, emailOutbox, session, user } from '@/db/schema';
import { signUpUser } from '../helpers/catalogue';
import { auth, socialSignIn } from '../helpers/auth';

// The landing route runs as in Next: request cookies in, cookies set on the response.
const jar = vi.hoisted(() => ({ request: new Map<string, string>(), set: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: [...jar.request].map(([k, v]) => `${k}=${v}`).join('; ') }),
  cookies: async () => ({
    get: (name: string) => (jar.request.has(name) ? { name, value: jar.request.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set.set(name, value); },
    delete: (name: string) => { jar.request.delete(name); jar.set.set(name, ''); },
  }),
}));
const { GET: land } = await import('@/app/(site)/(auth)/vhod/prodalzhi/route');

/** The browser comes back to /vhod/prodalzhi with these cookies. */
async function landing(query: string, cookie: string) {
  jar.request = new Map(cookie.split('; ').filter(Boolean).map(c => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
  jar.set = new Map();
  const { NextRequest } = await import('next/server');
  const res = await land(new NextRequest(`http://localhost:3000/vhod/prodalzhi${query}`));
  return { location: res.headers.get('location') ?? '', flash: jar.set.get('flash') ?? null };
}

const userByEmail = async (email: string) => (await db.select().from(user).where(eq(user.email, email)))[0];
const welcomes = (userId: string) => db.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, `welcome:${userId}`));

beforeEach(() => { jar.request = new Map(); jar.set = new Map(); });

describe('social sign-in and unconfirmed addresses', () => {
  it('Facebook with someone else\'s address gets no profile and no session; the owner\'s Google sign-in stays theirs', async () => {
    const VICTIM = 'victim.social@example.com';
    const fb = await socialSignIn('facebook', { id: 'fb-attacker-1', email: VICTIM, name: 'Нападател', emailVerified: false });
    expect(fb.status).toBe(302);
    expect(fb.location).toMatch(/^\/vhod\?error=email_not_verified/);
    expect(fb.cookie).not.toContain('session_token');
    expect(await userByEmail(VICTIM)).toBeUndefined();
    expect(await db.select().from(account).where(eq(account.accountId, 'fb-attacker-1'))).toHaveLength(0);

    // Had the old flow run, the attacker would now open /vhod/prodalzhi?nov=1; with no session it is a guest.
    expect((await landing('?nov=1', fb.cookie)).location).toBe('http://localhost:3000/vhod');

    // The owner signs in with Google, which vouches for the address: their own new profile.
    const google = await socialSignIn('google', { id: 'google-owner-1', email: VICTIM, name: 'Собственик', emailVerified: true });
    expect(google.location).toBe('/vhod/prodalzhi?nov=1');
    const owner = await userByEmail(VICTIM);
    expect(owner.emailVerified).toBe(true);
    expect((await db.select().from(account).where(eq(account.userId, owner.id))).map(a => a.accountId)).toEqual(['google-owner-1']);
    // First landing: client_profile, client-welcome and the toast, whatever the query says; then /tarsene.
    const first = await landing('', google.cookie);
    expect(first.location).toBe('http://localhost:3000/tarsene');
    expect(first.flash).toContain('Профилът е създаден');
    expect(await welcomes(owner.id)).toHaveLength(1);
    expect(await db.select().from(clientProfile).where(eq(clientProfile.userId, owner.id))).toHaveLength(1);
    const again = await landing('?nov=1', google.cookie);
    expect(again.flash).toBeNull();
    expect(await welcomes(owner.id)).toHaveLength(1);
  });

  it('a session on an unconfirmed address (e.g. from before this fix) is ended, never confirmed, at /vhod/prodalzhi?nov=1', async () => {
    const u = await signUpUser({ email: 'squatted@example.com' });
    await db.insert(account).values({ id: 'acc-fb-old', accountId: 'fb-old', providerId: 'facebook', userId: u.id, createdAt: new Date(), updatedAt: new Date() });
    const ctx = await auth.$context;
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, u.id));
    const s = (await ctx.internalAdapter.createSession(u.id))!;
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, u.id));
    const cookie = (await serializeSignedCookie('better-auth.session_token', s.token, ctx.secret)).split(';')[0];

    const r = await landing('?nov=1', cookie);
    expect(r.location).toBe(`http://localhost:3000/potvarzhdenie?email=${encodeURIComponent(u.email)}`);
    expect(r.flash).toBeNull();
    expect((await userByEmail(u.email)).emailVerified).toBe(false);
    expect(await welcomes(u.id)).toHaveLength(0);
    expect(await db.select().from(clientProfile).where(eq(clientProfile.userId, u.id))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
    // The email code goes to the address, so only its owner can confirm it.
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.toUserId, u.id))).map(m => m.templateKey)).toEqual(['client-verify-code']);
  });

  it('nobody gets a session on an unconfirmed address, whatever creates it', async () => {
    const u = await signUpUser();
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.createSession(u.id)).toBeNull();
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
  });

  it('a social identity is admitted only when the provider vouches for the address', async () => {
    const validate = auth.options.user!.validateUserInfo!;
    for (const action of ['create-user', 'link-account', 'sign-in'] as const) {
      for (const providerId of ['facebook', 'google']) {
        const source = { method: 'oauth' as const, action, oauth: { providerId } };
        expect(await validate({ user: { email: 'a@example.com', emailVerified: false }, source })).toEqual({ error: 'email_not_verified' });
        expect(await validate({ user: { email: 'a@example.com', emailVerified: true }, source })).toBeUndefined();
      }
    }
    // Email + password sign-up starts unconfirmed (the code confirms it).
    expect(await validate({ user: { email: 'a@example.com', emailVerified: false }, source: { method: 'email-password', action: 'create-user' } })).toBeUndefined();
    const providers = auth.options.socialProviders as Record<string, { requireEmailVerification?: boolean }>;
    expect(providers.google.requireEmailVerification).toBe(true);
    expect(providers.facebook.requireEmailVerification).toBe(true);
    // Facebook is configured here (tests/helpers/auth) but never vouches for an address: no button for it.
    const { socialProviders } = await import('@/app/(site)/(auth)/_ui/server');
    expect(socialProviders()).toEqual(['google']);
  });
});
