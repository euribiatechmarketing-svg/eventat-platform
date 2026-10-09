// The app's own Better Auth instance (lib/auth.ts) for security tests: its HTTP handler as the
// browser reaches it (/api/auth/*), its server API as the server actions call it, and cookies.
// lib/auth reads the environment when it loads, so it is imported only after these are set.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';

process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-secret';
process.env.FACEBOOK_CLIENT_ID ??= 'test-facebook-id';
process.env.FACEBOOK_CLIENT_SECRET ??= 'test-facebook-secret';

export const { auth } = await import('@/lib/auth');

export const BASE = 'http://localhost:3000';
export const PASSWORD = 'correct-horse-battery';

/** A request straight from a script: no Origin, no cookies (what an attacker sends). */
export function post(path: string, body: unknown, cookie?: string) {
  return auth.handler(new Request(`${BASE}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));
}

export function get(path: string, cookie?: string) {
  return auth.handler(new Request(`${BASE}/api/auth${path}`, { headers: cookie ? { cookie } : {} }));
}

/** Set-Cookie headers → a Cookie request header (later cookies of the same name win; expired ones drop). */
export function cookieHeader(...sets: Headers[]): string {
  const jar = new Map<string, string>();
  for (const h of sets) {
    for (const c of h.getSetCookie()) {
      const pair = c.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(name.length + 1);
      if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
    }
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** A confirmed client with a password, created through Better Auth like a real sign-up (A1–A3). */
export async function passwordUser(o: { email?: string; phone?: string; twoFactor?: boolean; role?: 'client' | 'admin' } = {}) {
  const email = o.email ?? `pw.${Math.random().toString(36).slice(2, 10)}@example.com`;
  const r = await auth.api.signUpEmail({ body: { name: 'Тест Потребител', email, password: PASSWORD } });
  await db.update(user).set({
    emailVerified: true, phone: o.phone ?? '+359888123456', twoFactorEnabled: o.twoFactor ?? false, role: o.role ?? 'client',
  }).where(eq(user.id, r.user.id));
  return { id: r.user.id, email };
}

/** ‹Влез› as the server action does it: the response headers (Set-Cookie) and body. */
export async function signIn(email: string, cookie?: string) {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD, rememberMe: true }, headers: new Headers(cookie ? { cookie } : {}), returnHeaders: true,
  });
  return { headers: res.headers, body: res.response as { twoFactorRedirect?: boolean; token?: string } };
}

/** The session behind a Cookie header, as currentUser() reads it (null when it no longer counts). */
export function sessionOf(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ cookie }) });
}

type SocialProfile = { id: string; email: string; name: string; emailVerified: boolean };

/**
 * ‹Продължи с Google / Facebook› end to end, with the provider's answer faked: auth.api.signInSocial
 * as socialSignInAction calls it (plus the old new-user URL with ?nov=1, which must not matter),
 * then the provider sending the browser back to /api/auth/callback/<provider> with code and state.
 */
export async function socialSignIn(provider: 'google' | 'facebook', profile: SocialProfile, cookie = '') {
  const ctx = await auth.$context;
  const p = ctx.socialProviders.find(x => x.id === provider)!;
  Object.assign(p, {
    validateAuthorizationCode: async () => ({ accessToken: `token-${profile.id}`, tokenType: 'bearer' }),
    getUserInfo: async () => ({ user: { ...profile, image: null }, data: { id: profile.id, sub: profile.id, email: profile.email } }), // Facebook keys the account by id, Google by sub
  });
  const start = await auth.api.signInSocial({
    body: { provider, callbackURL: '/vhod/prodalzhi', newUserCallbackURL: '/vhod/prodalzhi?nov=1', errorCallbackURL: '/vhod' },
    headers: new Headers(cookie ? { cookie } : {}), returnHeaders: true,
  });
  const state = new URL((start.response as { url: string }).url).searchParams.get('state');
  const res = await get(`/callback/${provider}?code=from-${provider}&state=${state}`, cookieHeader(start.headers));
  return { status: res.status, location: res.headers.get('location') ?? '', cookie: cookieHeader(res.headers) };
}
