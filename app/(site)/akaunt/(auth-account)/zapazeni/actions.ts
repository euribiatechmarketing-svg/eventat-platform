'use server';
// /akaunt/zapazeni (client/saved.html): the bell on a saved search → saved.setNotify(); the bin → saved.deleteSearch().
// Someone else's search (or one already deleted) → the 404 page.
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { deleteSearch, setNotify } from '@/lib/domain/saved';
import { NotFoundError } from '@/lib/domain/catalogue-kit';

const PATH = '/akaunt/zapazeni';
const idSchema = z.uuid();

/** The search id from the form, or the 404 page. */
function idOf(fd: FormData): string {
  const r = idSchema.safeParse(String(fd.get('id') ?? ''));
  if (!r.success) notFound();
  return r.data;
}

async function own<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

/** ‹Изключи известията за това търсене› / ‹Включи известията за това търсене›. */
export async function setNotifyAction(fd: FormData) {
  const actor = await actorFromUser(await requireRole('client', PATH));
  const id = idOf(fd);
  const on = fd.get('notify') === '1';
  await own(() => setNotify(actor, { id, notify: on }));
  revalidatePath(PATH);
  await setFlash(on ? 'Ще ви известим при нови резултати' : 'Известията за това търсене са изключени');
  redirect(PATH);
}

/** ‹Изтрий запазеното търсене› (toast ‹Търсенето е изтрито›). */
export async function deleteSearchAction(fd: FormData) {
  const actor = await actorFromUser(await requireRole('client', PATH));
  const id = idOf(fd);
  await own(() => deleteSearch(actor, { id }));
  revalidatePath(PATH);
  await setFlash('Търсенето е изтрито');
  redirect(PATH);
}
