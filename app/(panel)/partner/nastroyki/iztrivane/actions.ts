'use server';
// The email link ‹Потвърди изтриването› (P10): partners.confirmDeletion() → signed out → `/`.
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { auth } from '@/lib/auth';
import * as partners from '@/lib/domain/partners';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { refusal } from '../../_catalogue/server';

export async function confirmDeletionAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  await requireRole('partner', '/partner/nastroyki');
  const token = String(formData.get('token') ?? '');
  if (!token || token.length > 200) return { error: 'Линкът е невалиден или е изтекъл.' };
  try {
    await db.transaction(tx => partners.confirmDeletion({ token }, tx));
  } catch (e) { return { error: refusal(e) }; }
  // The sessions are already gone (anonymised user); clear this browser's cookie too.
  try { await auth.api.signOut({ headers: await headers() }); } catch { /* session already deleted */ }
  const jar = await cookies();
  for (const c of jar.getAll()) if (c.name.includes('better-auth')) jar.delete(c.name);
  await setFlash('Изтрито');
  redirect('/');
}
