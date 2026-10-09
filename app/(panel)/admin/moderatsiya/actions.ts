'use server';
// /admin/moderatsiya (SCREENS §8, SPEC §4.4 S3/S4/S7/S8) [moderate_listings].
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { approveChange, publish, returnRevision } from '@/lib/domain/services';
import { requireTeam } from '../_ops/guard';
import { failure, safeBack, toastBack } from '../_ops/act';

const id = z.object({ revisionId: z.uuid() });
const back = (fd: FormData) => safeBack(String(fd.get('back') ?? ''), '/admin/moderatsiya');

/** ‹Публикувай› a new service → `vendor-service-published`. */
export async function publishRevisionAction(fd: FormData) {
  const { actor } = await requireTeam('moderate_listings');
  const d = id.safeParse({ revisionId: fd.get('revisionId') });
  if (!d.success) return { error: failure('validation') };
  try { await db.transaction(tx => publish(actor, d.data, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin', 'layout');
  await toastBack('Обявата е публикувана', back(fd));
}

/** ‹Одобри› an edit → `vendor-service-change-approved`. */
export async function approveChangeAction(fd: FormData) {
  const { actor } = await requireTeam('moderate_listings');
  const d = id.safeParse({ revisionId: fd.get('revisionId') });
  if (!d.success) return { error: failure('validation') };
  try { await db.transaction(tx => approveChange(actor, d.data, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin', 'layout');
  await toastBack('Промяната е одобрена', back(fd));
}

/** ‹Върни с бележка› (note required) → `vendor-service-returned` / `vendor-service-change-returned`. */
export async function returnRevisionAction(fd: FormData) {
  const { actor } = await requireTeam('moderate_listings');
  const d = id.extend({ note: z.string().trim().min(1).max(2000) }).safeParse({ revisionId: fd.get('revisionId'), note: fd.get('note') });
  if (!d.success) return { error: failure('note_required') };
  try { await db.transaction(tx => returnRevision(actor, d.data, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin', 'layout');
  await toastBack('Обявата е върната с бележка', back(fd));
}
