'use server';
// ‹Запази бележката› → events.saveNotes(); toast ‹Бележката е запазена›.
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { NOTES_MAX, saveNotes } from '@/lib/domain/events';
import { LifecycleError } from '@/lib/domain/bookings';
import { ERR, type FormState } from '../../../../(auth)/_ui/messages';

const schema = z.object({ eventId: z.uuid(), notes: z.string().max(NOTES_MAX) });

export async function saveNotesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const eventId = String(fd.get('eventId') ?? '');
  const actor = await actorFromUser(await requireRole('client', `/akaunt/sabitiya/${eventId}`));
  // A submitted <textarea> sends CRLF line breaks; store plain \n.
  const p = schema.safeParse({ eventId, notes: String(fd.get('notes') ?? '').replace(/\r\n?/g, '\n') });
  if (!z.uuid().safeParse(eventId).success) notFound();
  if (!p.success) return { error: ERR.generic };
  try {
    await saveNotes(actor, p.data);
  } catch (e) {
    // Someone else's event (or one that is gone) → the 404 page, as when opening it.
    if (e instanceof LifecycleError && e.code === 'not_found') notFound();
    if (e instanceof LifecycleError) return { error: ERR.generic };
    throw e;
  }
  revalidatePath(`/akaunt/sabitiya/${eventId}`);
  await setFlash('Бележката е запазена');
  redirect(`/akaunt/sabitiya/${eventId}`);
}
