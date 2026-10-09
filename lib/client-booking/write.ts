import 'server-only';
// ‹Пиши на изпълнителя› (request page, bookings hero, booking page):
// messages.getOrCreate() for the request/booking number → the thread.
// Someone else's number answers like any record that is not yours: 404.
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { ForbiddenError, actorFromUser } from '@/lib/domain/actor';
import { LifecycleError } from '@/lib/domain/bookings';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { getOrCreate } from '@/lib/domain/messaging';
import { requireRole } from '@/lib/session';

export const numberSchema = z.string().trim().regex(/^\d{4}-\d{4}-[А-Я]{2}$/u);

export async function openThread(formData: FormData): Promise<never> {
  const u = await requireRole('client');
  const parsed = numberSchema.safeParse(formData.get('number'));
  if (!parsed.success) notFound();
  let id: string;
  try {
    ({ id } = await getOrCreate(await actorFromUser(u), { number: parsed.data }));
  } catch (e) {
    if (e instanceof ForbiddenError || ((e instanceof LifecycleError || e instanceof DomainError) && e.code === 'not_found')) notFound();
    throw e;
  }
  redirect(`/akaunt/saobshteniya/${id}`);
}
