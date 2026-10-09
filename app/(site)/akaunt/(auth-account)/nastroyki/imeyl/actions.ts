'use server';
// D55: the code sent to the new address confirms the email change (accounts.confirmEmailChange()).
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { confirmEmailChange } from '@/lib/domain/clients';
import { hitAll } from '@/lib/domain/throttle';
import { cancelEmailChange, resendEmailChangeCode } from '@/lib/domain/views-auth-account';
import { ERR, type FormState } from '../../../../(auth)/_ui/messages';
import { clientIp } from '../../../../(auth)/_ui/server';

const PATH = '/akaunt/nastroyki/imeyl';

export async function confirmEmailChangeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await actorFromUser(await requireRole('client', PATH));
  const code = z.string().regex(/^\d{6}$/).safeParse(String(fd.get('code') ?? ''));
  if (!code.success) return { error: ERR.code };
  // Code entries per user and per IP, like the other code screens (lib/domain/throttle).
  if (!(await hitAll([['codeKey', `email-change:${actor.userId}`], ['codeIp', await clientIp()]]))) return { error: ERR.generic };
  const current = await auth.api.getSession({ headers: await headers() });
  try {
    // The account's other sessions and trusted devices end with the change; this browser stays signed in.
    await confirmEmailChange(actor, { code: code.data, keepSessionId: current?.session.id ?? null });
  } catch (e) {
    if (e instanceof DomainError) {
      if (e.code === 'email_taken') return { error: ERR.emailTaken };
      return { error: e.code === 'too_many_attempts' ? ERR.codeExpired : ERR.code };
    }
    throw e;
  }
  revalidatePath('/', 'layout');
  await setFlash('Промените са запазени');
  redirect('/akaunt/nastroyki');
}

/** ‹Поискайте нов›: a fresh code to the new address (toast ‹Изпратихме нов код›). */
export async function resendEmailChangeAction() {
  const actor = await actorFromUser(await requireRole('client', PATH));
  try {
    await resendEmailChangeCode(actor);
    await setFlash('Изпратихме нов код');
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
  }
  redirect(PATH);
}

/** ‹Сменете имейла› (verify.html's link): the code stops working → back to the settings, where the address can be typed again. */
export async function cancelEmailChangeAction() {
  const actor = await actorFromUser(await requireRole('client', PATH));
  await cancelEmailChange(actor);
  redirect('/akaunt/nastroyki');
}
