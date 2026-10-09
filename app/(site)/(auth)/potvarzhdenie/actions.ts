'use server';
// /potvarzhdenie (client/verify.html): ‹Потвърди› → accounts.verifyEmail() → client-welcome (toast
// ‹Профилът е създаден›, → next or /tarsene) / vendor-welcome (toast ‹Имейлът е потвърден›, →
// /partner/registratsiya/1); ‹Поискайте нов› → accounts.resendCode() (toast ‹Изпратихме нов код›);
// ‹Сменете имейла› → the code stops working (only in the browser that started the sign-up) → /registratsiya.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { verifyEmail } from '@/lib/domain/clients';
import { invalidateEmailCode, recordSignIn, resendWaitMs, safeNext, verificationView } from '@/lib/domain/views-auth-account';
import { hit, hitAll } from '@/lib/domain/throttle';
import { ERR, carry, type FormState } from '../_ui/messages';
import { authErrorCode, clientIp, signupCookie } from '../_ui/server';

const emailOf = (fd: FormData) => z.string().trim().toLowerCase().pipe(z.email()).safeParse(String(fd.get('email') ?? ''));

export async function verifyCodeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = emailOf(fd);
  const code = z.string().regex(/^\d{6}$/).safeParse(String(fd.get('code') ?? ''));
  if (!email.success) redirect('/registratsiya');
  if (!code.success) return { error: ERR.code };
  const { account } = await verificationView(email.data);
  if (!account || account.emailVerified) redirect('/vhod');
  if (!(await hitAll([['codeKey', email.data], ['codeIp', await clientIp()]]))) return { error: ERR.generic };
  try {
    await auth.api.verifyEmailOTP({ body: { email: email.data, otp: code.data }, headers: await headers() });
  } catch (e) {
    const c = authErrorCode(e);
    return { error: c === 'OTP_EXPIRED' || c === 'TOO_MANY_ATTEMPTS' ? ERR.codeExpired : ERR.code };
  }
  await verifyEmail({ userId: account.id });
  await recordSignIn(account.id);
  if (account.role === 'partner') {
    await setFlash('Имейлът е потвърден');
    redirect('/partner/registratsiya/1');
  }
  await setFlash('Профилът е създаден');
  redirect(safeNext(String(fd.get('next') ?? '')) ?? '/tarsene');
}

export async function resendCodeAction(fd: FormData) {
  const email = emailOf(fd);
  if (!email.success) redirect('/registratsiya');
  const as = fd.get('as') === 'partner' ? 'partner' : 'client';
  const next = safeNext(String(fd.get('next') ?? ''));
  const v = await verificationView(email.data);
  if (!v.account || v.account.emailVerified) redirect('/vhod');
  // The 60 s cooldown runs on the same (wall) clock as Better Auth's code.
  if (resendWaitMs(v.sentAt, Date.now()) === 0 && await hit('codeSend', email.data)) {
    await auth.api.sendVerificationOTP({ body: { email: email.data, type: 'email-verification' } });
    await setFlash('Изпратихме нов код');
  }
  redirect(`/potvarzhdenie${carry(as, next, { email: email.data })}`);
}

/**
 * ‹Сменете имейла›: back to sign-up. The code sent to this address stops working only when this
 * browser started the sign-up (its httpOnly cookie); the action needs no session, so without that
 * proof anyone could delete anyone's code.
 */
export async function changeEmailAction(fd: FormData) {
  const email = emailOf(fd);
  const as = fd.get('as') === 'partner' ? 'partner' : 'client';
  const next = safeNext(String(fd.get('next') ?? ''));
  if (email.success) await invalidateEmailCode(email.data, await signupCookie());
  redirect(`/registratsiya${carry(as, next)}`);
}
