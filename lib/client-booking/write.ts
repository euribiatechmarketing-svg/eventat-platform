import 'server-only';
// ‹Пиши на изпълнителя› (request page, bookings hero, booking page):
// messages.getOrCreate() for the request/booking number → the thread.
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
import { getOrCreate } from '@/lib/domain/messaging';
import { requireRole } from '@/lib/session';

export const numberSchema = z.string().trim().regex(/^\d{4}-\d{4}-[А-Я]{2}$/u);

export async function openThread(formData: FormData): Promise<never> {
  const u = await requireRole('client');
  const number = numberSchema.parse(formData.get('number'));
  const conv = await getOrCreate(await actorFromUser(u), { number });
  redirect(`/akaunt/saobshteniya/${conv.id}`);
}
