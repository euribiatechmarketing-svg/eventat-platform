'use server';
// ‹Потвърди изтриването› from vendor-delete-confirm (SPEC §4.2 P10): partners.confirmDeletion()
// re-checks that there are no upcoming bookings or open disputes, anonymises the partner and the
// user, archives the services; this browser is signed out → /.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { confirmDeletion } from '@/lib/domain/partners';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { deletionLinkView } from '@/lib/domain/views-auth-account';
import { currentUser } from '@/lib/session';
import { ERR, type FormState } from '../../../_ui/messages';
import { clearAuthCookies } from '../../../_ui/server';

export async function confirmPartnerDeletionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get('token') ?? '');
  // A forwarded link must not work for someone else who happens to be signed in here.
  const signedIn = await currentUser();
  if (signedIn) {
    const link = await deletionLinkView(token, 'partner');
    if (!link || link.userId !== signedIn.id) return { error: ERR.linkUsed };
  }
  try {
    await confirmDeletion({ token });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.code === 'has_upcoming_bookings' ? ERR.upcoming : ERR.linkUsed };
    throw e;
  }
  await clearAuthCookies();
  revalidatePath('/', 'layout');
  redirect('/');
}
