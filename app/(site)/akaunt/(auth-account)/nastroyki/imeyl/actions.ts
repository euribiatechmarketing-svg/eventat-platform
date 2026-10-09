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
import { confirmEmailChangeLimited, resendEmailChangeCode } from '@/lib/domain/views-auth-account';
import { ERR, type FormState } from '../../../../(auth)/_ui/messages';

const PATH = '/akaunt/nastroyki/imeyl';

export async function confirmEmailChangeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await actorFromUser(await requireRole('client', PATH));
  const code = z.string().regex(/^\d{6}$/).safeParse(String(fd.get('code') ?? ''));
  if (!code.success) return { error: ERR.code };
  try {
    await confirmEmailChangeLimited(actor, code.data);
  } catch (e) {
    if (e instanceof DomainError) {
      if (e.code === 'email_taken') return { error: ERR.emailTaken };
      return { error: e.code === 'too_many_attempts' ? ERR.codeExpired : ERR.code };
    }
    throw e;
  }
  try { await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } }); } catch { /* ignore */ }
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
