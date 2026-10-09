// Security: ending sign-ins.
//  - cookie-cache-revocation (S4): with Better Auth's 5-minute cookie cache, a session whose row was
//    deleted (‹Излез навсякъде›, a password reset, blocking) kept working on the other devices
//    until the cached copy expired, so a stolen cookie survived the owner's ‹Излез навсякъде›.
//  - trusted-device-not-revoked (S5): a device that once passed the SMS step skipped it for 30 days,
//    even after a password reset or ‹Излез навсякъде›.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { smsOutbox, user } from '@/db/schema';
import { afterPasswordChanged, block, signOutEverywhere } from '@/lib/domain/clients';
import { createAdmin } from '../helpers/factories';
import { auth, cookieHeader, passwordUser, sessionOf, signIn } from '../helpers/auth';

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.cookies.set(name, value); },
    delete: (name: string) => { jar.cookies.delete(name); },
  }),
}));

beforeEach(() => { jar.cookies = new Map(); });

const actorOf = (id: string) => ({ userId: id, role: 'client' as const });

/** ‹Влез› with the SMS step and ‹trust this device›, as /vhod and /vhod/kod do it: the browser's cookies afterwards. */
async function signInWithSms(id: string, email: string) {
  const first = await signIn(email);
  expect(first.body.twoFactorRedirect).toBe(true);
  const challenge = cookieHeader(first.headers);
  await auth.api.sendTwoFactorOTP({ headers: new Headers({ cookie: challenge }), body: {} });
  const [sms] = await db.select().from(smsOutbox).where(eq(smsOutbox.toUserId, id)).orderBy(desc(smsOutbox.createdAt)).limit(1);
  const done = await auth.api.verifyTwoFactorOTP({ body: { code: sms.body, trustDevice: true }, headers: new Headers({ cookie: challenge }), returnHeaders: true });
  return cookieHeader(first.headers, done.headers);
}

/** Only the remembered-device cookie of a browser (the sessions are gone). */
const trustOnly = (cookie: string) => cookie.split('; ').filter(c => c.includes('trust_device')).join('; ');

describe('ending sign-ins', () => {
  it('‹Излез навсякъде› ends a stolen session at once (S4)', async () => {
    const { id, email } = await passwordUser();
    const stolen = cookieHeader((await signIn(email)).headers);
    expect((await sessionOf(stolen))?.user.id).toBe(id);
    await signOutEverywhere(actorOf(id));
    expect(await sessionOf(stolen)).toBeNull();
  });

  it('a password reset and a block end every session at once (S4)', async () => {
    const a = await passwordUser();
    const cookieA = cookieHeader((await signIn(a.email)).headers);
    await sessionOf(cookieA);
    await afterPasswordChanged({ userId: a.id });
    expect(await sessionOf(cookieA)).toBeNull();

    const b = await passwordUser();
    const cookieB = cookieHeader((await signIn(b.email)).headers);
    await sessionOf(cookieB);
    const { actor: admin } = await createAdmin();
    await block(admin, { clientId: b.id });
    expect(await sessionOf(cookieB)).toBeNull();
  });

  it('a profile change is read fresh, not from a cached copy', async () => {
    const { id, email } = await passwordUser();
    const cookie = cookieHeader((await signIn(email)).headers);
    await sessionOf(cookie);
    await db.update(user).set({ name: 'Ново Име' }).where(eq(user.id, id));
    expect((await sessionOf(cookie))?.user.name).toBe('Ново Име');
  });

  it('‹Излез навсякъде› and a password reset make every device pass the SMS step again (S5)', async () => {
    for (const end of [
      (id: string) => signOutEverywhere(actorOf(id)),
      (id: string) => afterPasswordChanged({ userId: id }),
    ]) {
      const { id, email } = await passwordUser({ twoFactor: true });
      const laptop = await signInWithSms(id, email);
      // Trusted: the next sign-in on this device skips the SMS step…
      const trusted = await signIn(email, trustOnly(laptop));
      expect(trusted.body.twoFactorRedirect).toBeUndefined();
      const rotated = trustOnly(cookieHeader(trusted.headers)) || trustOnly(laptop);
      // …until the owner ends every sign-in.
      await end(id);
      expect((await signIn(email, rotated)).body.twoFactorRedirect).toBe(true);
    }
  });

  it('signing a browser out also forgets that it was trusted (S5)', async () => {
    const { clearAuthCookies } = await import('@/app/(site)/(auth)/_ui/server');
    for (const name of ['session_token', 'session_data', 'dont_remember', 'two_factor', 'trust_device']) {
      jar.cookies.set(`better-auth.${name}`, 'x');
      jar.cookies.set(`__Secure-better-auth.${name}`, 'x');
    }
    jar.cookies.set('flash', 'kept');
    await clearAuthCookies();
    expect([...jar.cookies.keys()]).toEqual(['flash']);
  });
});
