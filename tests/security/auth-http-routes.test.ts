// Security: Better Auth mounted every plugin route at /api/auth/*, although the site only uses a few
// of them over HTTP (everything else goes through server actions calling auth.api).
//  - email-otp-verify-email-session (F2): /email-otp/verify-email gave a session for the emailed code
//    alone — no password, no SMS step — even on a confirmed account.
//  - unsent-otp-bruteforce (F3): /email-otp/send-verification-otp {type:'sign-in'} and
//    /email-otp/request-password-reset stored codes that are never emailed; guessing one at
//    /sign-in/email-otp or /email-otp/reset-password opened any account, admins included.
// Now only the routes the site needs answer; the rest are 404, and the server API still works.
import { describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { session, user, verification } from '@/db/schema';
import { BASE, PASSWORD, auth, get, passwordUser, post } from '../helpers/auth';

const sessionsOf = (userId: string) => db.select().from(session).where(eq(session.userId, userId));
const codesFor = (email: string) => db.select().from(verification).where(like(verification.identifier, `%-${email}`));
/** A code Better Auth stored for this address (plain storage: `<otp>:<attempts>`). */
const plantCode = (kind: string, email: string, otp: string) =>
  db.insert(verification).values({ id: `v_${kind}_${otp}_${Math.random().toString(36).slice(2, 8)}`, identifier: `${kind}-otp-${email}`, value: `${otp}:0`, expiresAt: new Date(Date.now() + 600_000) });

describe('Better Auth HTTP routes', () => {
  it('an unsent sign-in / reset code cannot be requested, guessed or redeemed (F3)', async () => {
    const admin = await passwordUser({ role: 'admin', twoFactor: true });

    for (const [path, body] of [
      ['/email-otp/send-verification-otp', { email: admin.email, type: 'sign-in' }],
      ['/email-otp/send-verification-otp', { email: admin.email, type: 'forget-password' }],
      ['/email-otp/request-password-reset', { email: admin.email }],
      ['/forget-password/email-otp', { email: admin.email }],
    ] as const) {
      expect((await post(path, body)).status, path).toBe(404);
    }
    expect(await codesFor(admin.email)).toHaveLength(0);

    // Even a correct code (planted as if Better Auth had stored it) opens nothing.
    await plantCode('sign-in', admin.email, '123456');
    await plantCode('forget-password', admin.email, '654321');
    expect((await post('/email-otp/check-verification-otp', { email: admin.email, type: 'sign-in', otp: '123456' })).status).toBe(404);
    const signIn = await post('/sign-in/email-otp', { email: admin.email, otp: '123456' });
    expect(signIn.status).toBe(404);
    expect(signIn.headers.getSetCookie()).toEqual([]);
    expect((await post('/email-otp/reset-password', { email: admin.email, otp: '654321', password: 'attacker-chosen-1' })).status).toBe(404);
    expect(await sessionsOf(admin.id)).toHaveLength(0);
    // The password is still the owner's.
    expect((await post('/sign-in/email', { email: admin.email, password: 'attacker-chosen-1' })).status).toBe(401);

    // A new address cannot get a profile from a guessed code either.
    await plantCode('sign-in', 'nobody.yet@example.com', '111222');
    expect((await post('/sign-in/email-otp', { email: 'nobody.yet@example.com', otp: '111222' })).status).toBe(404);
    expect(await db.select().from(user).where(eq(user.email, 'nobody.yet@example.com'))).toHaveLength(0);
  });

  it('the email-confirmation code gives no session over HTTP (F2)', async () => {
    const client = await passwordUser({ twoFactor: true });
    expect((await post('/email-otp/send-verification-otp', { email: client.email, type: 'email-verification' })).status).toBe(404);
    await plantCode('email-verification', client.email, '424242');
    const res = await post('/email-otp/verify-email', { email: client.email, otp: '424242' });
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await sessionsOf(client.id)).toHaveLength(0);
  });

  it('routes the site does not use over HTTP answer 404', async () => {
    const { email } = await passwordUser();
    for (const [path, body] of [
      ['/sign-up/email', { name: 'X', email: 'scripted.signup@example.com', password: 'whatever-123' }],
      ['/update-user', { phone: '+359877000000' }],
      ['/change-email', { newEmail: 'x@example.com' }],
      ['/two-factor/send-otp', {}],
      ['/two-factor/verify-otp', { code: '000000' }],
      ['/request-password-reset', { email }],
      ['/reset-password', { token: 'x', newPassword: 'whatever-123' }],
      ['/sign-in/social', { provider: 'google' }],
      ['/link-social', { provider: 'google' }],
      ['/sign-out', {}],
      ['/sign-in/email/', { email, password: PASSWORD }],
      ['/Sign-in/email', { email, password: PASSWORD }],
    ] as const) {
      expect((await post(path, body)).status, path).toBe(404);
    }
    for (const path of ['/get-session', '/list-sessions', '/verify-email?token=x', '/ok']) expect((await get(path)).status, path).toBe(404);
    expect(await db.select().from(user).where(eq(user.email, 'scripted.signup@example.com'))).toHaveLength(0);
  });

  it('the routes the site needs still work, and so does the server API', async () => {
    const { id, email } = await passwordUser();
    // tools/shoot.py and tests/e2e sign in over HTTP.
    const res = await auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email, password: PASSWORD }),
    }));
    expect(res.status).toBe(200);
    expect(await sessionsOf(id)).toHaveLength(1);
    // The reset link in client-password-link / vendor-password-reset.
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/vhod/nova-parola' } });
    const [reset] = await db.select().from(verification).where(and(like(verification.identifier, 'reset-password:%'), eq(verification.value, id)));
    const link = await get(`/reset-password/${reset.identifier.slice('reset-password:'.length)}?callbackURL=%2Fvhod%2Fnova-parola`);
    expect(link.status).toBe(302);
    expect(link.headers.get('location')).toContain('/vhod/nova-parola?token=');
    // Google / Facebook come back here (no state in this request, so Better Auth redirects to its error page).
    expect((await get('/callback/google?code=x&state=y')).status).toBe(302);

    // /potvarzhdenie: the code screen calls the server API, which the HTTP rule never touches.
    const fresh = await auth.api.signUpEmail({ body: { name: 'Нов клиент', email: 'new.client@example.com', password: PASSWORD } });
    await auth.api.sendVerificationOTP({ body: { email: 'new.client@example.com', type: 'email-verification' } });
    const [code] = await codesFor('new.client@example.com');
    const verified = await auth.api.verifyEmailOTP({ body: { email: 'new.client@example.com', otp: code.value.split(':')[0] } });
    expect(verified.status).toBe(true);
    expect((await db.select().from(user).where(eq(user.id, fresh.user.id)))[0].emailVerified).toBe(true);
    expect(await sessionsOf(fresh.user.id)).toHaveLength(1);
  });
});
