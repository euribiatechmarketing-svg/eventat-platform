'use server';
// /akaunt/zapazeni (client/saved.html): the bell on a saved search → saved.setNotify(); the bin → saved.deleteSearch().
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { deleteSearch, setNotify } from '@/lib/domain/saved';

const PATH = '/akaunt/zapazeni';
const idSchema = z.uuid();

/** ‹Изключи известията за това търсене› / ‹Включи известията за това търсене›. */
export async function setNotifyAction(fd: FormData) {
  const actor = await actorFromUser(await requireRole('client', PATH));
  const id = idSchema.parse(String(fd.get('id') ?? ''));
  const on = fd.get('notify') === '1';
  await setNotify(actor, { id, notify: on });
  revalidatePath(PATH);
  await setFlash(on ? 'Ще ви известим при нови резултати' : 'Известията за това търсене са изключени');
  redirect(PATH);
}

/** ‹Изтрий запазеното търсене› (toast ‹Търсенето е изтрито›). */
export async function deleteSearchAction(fd: FormData) {
  const actor = await actorFromUser(await requireRole('client', PATH));
  const id = idSchema.parse(String(fd.get('id') ?? ''));
  await deleteSearch(actor, { id });
  revalidatePath(PATH);
  await setFlash('Търсенето е изтрито');
  redirect(PATH);
}
