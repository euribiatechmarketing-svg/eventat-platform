'use server';
// ‹Потвърди изтриването› from vendor-delete-confirm (SPEC §4.2 P10): partners.confirmDeletion()
// re-checks that there are no upcoming bookings or open disputes, anonymises the partner and the
// user, archives the services; this browser is signed out → /.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { confirmDeletion } from '@/lib/domain/partners';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { ERR, type FormState } from '../../../_ui/messages';
import { clearAuthCookies } from '../../../_ui/server';

export async function confirmPartnerDeletionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    await confirmDeletion({ token: String(fd.get('token') ?? '') });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.code === 'has_upcoming_bookings' ? ERR.upcoming : ERR.linkUsed };
    throw e;
  }
  await clearAuthCookies();
  revalidatePath('/', 'layout');
  redirect('/');
}
