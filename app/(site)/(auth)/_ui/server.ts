import 'server-only';
// Small helpers shared by the auth server actions.
import { isIP } from 'node:net';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { SIGNUP_COOKIE, homeFor, signupProof } from '@/lib/domain/views-auth-account';

/** The caller's IP for the consent rows (null when unknown). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || '';
  return isIP(ip) ? ip : null;
}

/**
 * Social sign-in buttons render only for providers that can sign someone in (no dead controls).
 * Facebook never vouches for the address (Better Auth reads no verified flag from it), so lib/auth.ts
 * admits no Facebook identity (SPEC §4.1 A4) and its button stays hidden even when it is configured.
 */
export function socialProviders(): ('google' | 'facebook')[] {
  const out: ('google' | 'facebook')[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) out.push('google');
  return out;
}

/** Guard "guest" (SCREENS §0): a signed-in user goes to their home. */
export async function guestOnly() {
  const u = await currentUser();
  if (u) redirect(await homeFor(u));
}

/** Better Auth's error code from a thrown APIError (or ''). */
export function authErrorCode(e: unknown): string {
  const x = e as { body?: { code?: string }; status?: string | number; statusCode?: number };
  return x?.body?.code ?? '';
}

/** One query-string value. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Sign this browser out completely: the session rows may already be gone (deleted / revoked), so the
 * cookies go too, including `trust_device` (the next sign-in here passes the SMS step again).
 */
export async function clearAuthCookies() {
  const jar = await cookies();
  for (const name of ['session_token', 'session_data', 'dont_remember', 'two_factor', 'trust_device']) {
    for (const prefix of ['better-auth.', '__Secure-better-auth.']) if (jar.get(prefix + name)) jar.delete(prefix + name);
  }
}

/** This browser started the sign-up of `email` (SIGNUP_COOKIE): ‹Сменете имейла› may then end its code. */
export async function rememberSignup(email: string) {
  (await cookies()).set(SIGNUP_COOKIE, signupProof(email), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 24 * 3600,
  });
}

/** The SIGNUP_COOKIE of this browser (or null). */
export async function signupCookie(): Promise<string | null> {
  return (await cookies()).get(SIGNUP_COOKIE)?.value ?? null;
}
