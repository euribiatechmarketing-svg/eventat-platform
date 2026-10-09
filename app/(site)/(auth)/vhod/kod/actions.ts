'use server';
// The SMS step of sign-in when ‹Потвърждение в две стъпки› is on (SPEC §1.3, §11.4): the code
// confirms this device (trusted for 30 days, so the next sign-in here needs no code).
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { accountById, recordSignIn, resendWaitMs, safeNext, signInDestination, twoFactorChallenge } from '@/lib/domain/views-auth-account';
import { hit, hitAll } from '@/lib/domain/throttle';
import { ERR, type FormState } from '../../_ui/messages';
import { authErrorCode, clientIp } from '../../_ui/server';

async function challenge() {
  const jar = await cookies();
  const c = jar.get('better-auth.two_factor') ?? jar.get('__Secure-better-auth.two_factor');
  // Better Auth keeps this challenge on the wall clock (its own expiry), not on business time.
  return twoFactorChallenge(c?.value, Date.now());
}

/** ‹Потвърди›. */
export async function verifyTwoFactorAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const code = z.string().regex(/^\d{6}$/).safeParse(String(fd.get('code') ?? ''));
  if (!code.success) return { error: ERR.code };
  const ch = await challenge();
  if (!ch) redirect('/vhod');
  if (!(await hitAll([['codeKey', `2fa:${ch.userId}`], ['codeIp', await clientIp()]]))) return { error: ERR.generic };
  let userId: string;
  try {
    const r = await auth.api.verifyTwoFactorOTP({ body: { code: code.data, trustDevice: true }, headers: await headers() }) as { user?: { id: string } };
    userId = r.user?.id ?? ch.userId;
  } catch (e) {
    const c = authErrorCode(e);
    return { error: c === 'OTP_HAS_EXPIRED' || c === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' ? ERR.codeExpired : ERR.code };
  }
  const u = await accountById(userId);
  if (!u) redirect('/vhod');
  await recordSignIn(u.id);
  redirect(await signInDestination(u, safeNext(String(fd.get('next') ?? ''))));
}

/** ‹Поискайте нов›: a new SMS code after the 60 s cooldown (the previous one stops working). */
export async function resendTwoFactorAction(fd: FormData) {
  const ch = await challenge();
  if (!ch) redirect('/vhod');
  const next = safeNext(String(fd.get('next') ?? ''));
  if (resendWaitMs(ch.sentAt, Date.now()) === 0 && await hit('codeSend', `2fa:${ch.userId}`)) {
    await auth.api.sendTwoFactorOTP({ headers: await headers(), body: {} });
    await setFlash('Изпратихме нов код');
  }
  redirect(`/vhod/kod${next ? `?next=${encodeURIComponent(next)}` : ''}`);
}
