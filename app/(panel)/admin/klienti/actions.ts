'use server';
// /admin/klienti and /admin/klienti/[id] (SCREENS §8, SPEC §4.1 A12): ‹Блокирай профила›, ‹Вътрешна бележка›, ‹Експорт›.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { block } from '@/lib/domain/clients';
import { addNote } from '@/lib/domain/team';
import { requestAdminExport } from '@/lib/domain/views-admin-ops';
import { requireTeam } from '../_ops/guard';
import { failure, safeBack, toastBack } from '../_ops/act';

const back = (fd: FormData) => safeBack(String(fd.get('back') ?? ''), '/admin/klienti');

/** ‹Блокирай профила› → `client-account-blocked`; toast ‹Профилът е блокиран› → the client list. */
export async function blockClientAction(fd: FormData) {
  const { actor } = await requireTeam();
  const d = z.object({ clientId: z.string().min(1).max(64) }).safeParse({ clientId: fd.get('clientId') });
  if (!d.success) return { error: failure('validation') };
  try { await db.transaction(tx => block(actor, { clientId: d.data.clientId }, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin/klienti', 'layout');
  await toastBack('Профилът е блокиран', '/admin/klienti');
}

/** ‹Вътрешна бележка› saved on blur → notes.add(). */
export async function addClientNoteAction(fd: FormData) {
  const { actor } = await requireTeam();
  const d = z.object({ clientId: z.string().min(1).max(64), body: z.string().trim().min(1).max(2000) }).safeParse({ clientId: fd.get('clientId'), body: fd.get('body') });
  if (!d.success) return { error: failure('validation') };
  try { await db.transaction(tx => addNote(actor, { subjectType: 'client', subjectId: d.data.clientId, body: d.data.body }, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath(`/admin/klienti/${d.data.clientId}`);
  await toastBack('Бележката е запазена', back(fd));
}

/** ‹Експорт› (D68): report_job; toast only until the team email exists. */
export async function requestClientsExportAction(fd: FormData) {
  const { actor } = await requireTeam();
  const params = Object.fromEntries(['tab', 'grad', 'registratsiya', 'q'].map(k => [k, String(fd.get(k) ?? '') || null]));
  try { await requestAdminExport(actor, { kind: 'admin_clients', params }); } catch (e) { return { error: failure(e) }; }
  await toastBack('Справката се подготвя — ще я получите по имейл', back(fd));
}
