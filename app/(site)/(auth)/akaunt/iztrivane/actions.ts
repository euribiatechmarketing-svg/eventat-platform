'use server';
// ‹Потвърди изтриването› from the client-delete-confirm email (SPEC §4.1 A10): accounts.confirmDeletion()
// anonymises the profile and ends its sessions; this browser is signed out → /.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { confirmDeletion } from '@/lib/domain/clients';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { deletionLinkView } from '@/lib/domain/views-auth-account';
import { currentUser } from '@/lib/session';
import { ERR, type FormState } from '../../_ui/messages';
import { clearAuthCookies } from '../../_ui/server';

export async function confirmClientDeletionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get('token') ?? '');
  // A forwarded link must not work for someone else who happens to be signed in here.
  const signedIn = await currentUser();
  if (signedIn) {
    const link = await deletionLinkView(token, 'client');
    if (!link || link.userId !== signedIn.id) return { error: ERR.linkUsed };
  }
  try {
    await confirmDeletion({ token });
  } catch (e) {
    if (e instanceof DomainError) return { error: ERR.linkUsed };
    throw e;
  }
  await clearAuthCookies();
  revalidatePath('/', 'layout');
  redirect('/');
}
