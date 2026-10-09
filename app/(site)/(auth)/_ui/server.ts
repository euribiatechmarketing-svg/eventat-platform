import 'server-only';
// Small helpers shared by the auth server actions.
import { isIP } from 'node:net';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { homeFor } from '@/lib/domain/views-auth-account';

/** The caller's IP for the consent rows (null when unknown). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || '';
  return isIP(ip) ? ip : null;
}

/** Social sign-in buttons render only for configured providers (no dead controls). */
export function socialProviders(): ('google' | 'facebook')[] {
  const out: ('google' | 'facebook')[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) out.push('google');
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) out.push('facebook');
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

/** Sign this browser out completely: the session rows may already be gone (deleted / revoked), so the cookies go too. */
export async function clearAuthCookies() {
  const jar = await cookies();
  for (const name of ['session_token', 'session_data', 'dont_remember', 'two_factor']) {
    for (const prefix of ['better-auth.', '__Secure-better-auth.']) if (jar.get(prefix + name)) jar.delete(prefix + name);
  }
}
