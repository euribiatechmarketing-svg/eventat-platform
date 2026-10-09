'use server';
// /vhod (client/auth.html): ‹Влез› → auth.signIn() (Better Auth; the SMS step when two-step is on)
// → SPEC §1.3 redirect; ‹Забравена парола?› → auth.requestPasswordReset(); ‹Продължи с Google /
// Facebook› → auth.signInSocial(). An unverified email goes to the code screen with a fresh code.
// These actions call auth.api directly (no Better Auth HTTP limiter): lib/domain/throttle counts them.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import {
  accountByEmail, recordSignIn, resendWaitMs, safeNext, signInDestination, verificationView,
} from '@/lib/domain/views-auth-account';
import { clearHits, hitAll } from '@/lib/domain/throttle';
import { ERR, carry, type FormState } from '../_ui/messages';
import { authErrorCode, clientIp, rememberSignup, socialProviders } from '../_ui/server';

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(256),
  remember: z.boolean(),
  next: z.string().max(2000).optional(),
});

/** Better Auth's two_factor cookie from a response's Set-Cookie headers, as a request Cookie header. */
function twoFactorCookie(h: Headers): string | null {
  for (const c of h.getSetCookie()) {
    const pair = c.split(';')[0];
    const name = pair.slice(0, pair.indexOf('='));
    if (name.endsWith('two_factor') && pair.length > name.length + 1) return pair;
  }
  return null;
}

/** ‹Влез›. */
export async function signInAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = { email: String(fd.get('email') ?? '').trim() };
  const parsed = signInSchema.safeParse({ email: fd.get('email') ?? '', password: fd.get('password') ?? '', remember: fd.get('remember') === 'on', next: String(fd.get('next') ?? '') || undefined });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      if (i.path[0] === 'email') errors.email = values.email ? ERR.email : ERR.required;
      if (i.path[0] === 'password') errors.password = ERR.required;
    }
    return { errors, values };
  }
  const { email, password, remember } = parsed.data;
  const next = safeNext(parsed.data.next);
  const h = await headers();
  // Every attempt counts (per address and per IP) before the password is checked; a success clears the address.
  if (!(await hitAll([['signInEmail', email], ['signInIp', await clientIp()]]))) return { error: ERR.generic, values };
  let res: { headers: Headers; response: unknown };
  try {
    res = await auth.api.signInEmail({ body: { email, password, rememberMe: remember }, headers: h, returnHeaders: true });
  } catch (e) {
    const code = authErrorCode(e);
    const acc = await accountByEmail(email);
    if (code === 'EMAIL_NOT_VERIFIED' && acc) {
      // Right password, email never confirmed: a fresh code (after the 60 s cooldown) and the code screen.
      const v = await verificationView(email);
      if (resendWaitMs(v.sentAt, Date.now()) === 0) await auth.api.sendVerificationOTP({ body: { email, type: 'email-verification' } });
      await rememberSignup(email);
      redirect(`/potvarzhdenie${carry(acc.role === 'partner' ? 'partner' : 'client', next, { email })}`);
    }
    if (acc?.banned && (code === 'FAILED_TO_CREATE_SESSION' || code === '')) return { error: ERR.blocked, values };
    if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD' || code === 'USER_NOT_FOUND' || code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') {
      return { error: ERR.credentials, values };
    }
    if (acc?.banned || acc?.deletedAt) return { error: acc.banned ? ERR.blocked : ERR.credentials, values };
    return { error: ERR.credentials, values };
  }
  await clearHits('signInEmail', email);
  const body = res.response as { twoFactorRedirect?: boolean; user?: { id: string } };
  if (body.twoFactorRedirect) {
    const cookie = twoFactorCookie(res.headers);
    if (cookie) await auth.api.sendTwoFactorOTP({ headers: new Headers({ cookie }), body: {} });
    redirect(`/vhod/kod${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  }
  const acc = await accountByEmail(email);
  if (!acc) return { error: ERR.credentials, values };
  await recordSignIn(acc.id);
  redirect(await signInDestination({ id: acc.id, role: acc.role }, next));
}

/** ‹Забравена парола?›: the reset link by email (the same answer whether or not the address has a profile, A5). */
export async function forgotPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get('email') ?? '').trim();
  const r = z.string().trim().toLowerCase().pipe(z.email()).safeParse(raw);
  if (!r.success) return { errors: { email: raw ? ERR.email : ERR.required }, values: { email: raw } };
  const acc = await accountByEmail(r.data);
  // Over the limit, nothing is sent and the answer stays the same (A5).
  if (acc && !acc.banned && !acc.deletedAt && await hitAll([['resetEmail', r.data], ['resetIp', await clientIp()]])) {
    await auth.api.requestPasswordReset({ body: { email: r.data, redirectTo: '/vhod/nova-parola' }, headers: await headers() });
  }
  return { ok: 'Изпратихме ви линк за нова парола', values: { email: raw }, at: Date.now() };
}

/** ‹Продължи с Google› / ‹Продължи с Facebook› (rendered only when the provider is configured). */
export async function socialSignInAction(fd: FormData) {
  const provider = String(fd.get('provider') ?? '');
  if (provider !== 'google' && provider !== 'facebook') return;
  if (!socialProviders().includes(provider)) return;
  const next = safeNext(String(fd.get('next') ?? '')) ?? '';
  const as = fd.get('as') === 'partner' ? 'partner' : 'client';
  const back = `/vhod/prodalzhi${carry(as, next)}`;
  const r = await auth.api.signInSocial({
    body: { provider, callbackURL: back, newUserCallbackURL: `/vhod/prodalzhi${carry(as, next, { nov: '1' })}`, errorCallbackURL: `/vhod${carry(as, next)}` },
    headers: await headers(),
  });
  if (r.url) redirect(r.url);
}
