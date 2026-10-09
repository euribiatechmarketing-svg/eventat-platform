'use server';
// ‹Изпрати заявката› → requests.sendRequest() (SPEC R1); photos → media.upload().
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { city } from '@/db/schema';
import { actorFromUser } from '@/lib/domain/actor';
import { sendRequest } from '@/lib/domain/requests';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/components/client-booking/ActionForm';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { uploadPhoto } from '@/lib/client-booking/upload';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal('')).optional();
const Input = z.object({
  slug: z.string().min(1).max(120),
  serviceId: z.string().uuid(),
  eventTypeId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: time, endTime: time,
  guests: z.coerce.number().int().min(1).max(100_000),
  venueName: z.string().trim().max(120).optional(),
  locality: z.string().trim().max(120).optional(),
  spaceType: z.enum(['indoor', 'garden_hall', 'outdoor', 'undecided']).optional(),
  note: z.string().trim().max(2000).optional(),
  clientEventId: z.string().uuid().optional(),
  photos: z.array(z.string().uuid()).max(6),
});

export async function uploadRequestPhotoAction(formData: FormData) {
  return uploadPhoto('request_attachment', formData);
}

export async function sendRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await requireRole('client');
  const val = (k: string) => { const v = formData.get(k); return v == null ? undefined : String(v); };
  const parsed = Input.safeParse({
    slug: val('slug'), serviceId: val('serviceId'), eventTypeId: val('eventTypeId'), eventDate: val('eventDate'),
    startTime: val('startTime'), endTime: val('endTime'), guests: val('guests'), venueName: val('venueName'), locality: val('locality'),
    spaceType: val('spaceType') || undefined, note: val('note'), clientEventId: val('clientEventId') || undefined, photos: formData.getAll('photo').map(String),
  });
  if (!parsed.success) return { error: 'Действието не е изпълнено. Опитайте отново.' };
  const d = parsed.data;
  // ‹Град / село›: when it names one of our cities, the request carries that city too (search, matching).
  const [c] = d.locality ? await db.select({ id: city.id }).from(city).where(eq(city.name, d.locality.replace(/^(гр\.|град)\s*/i, ''))).limit(1) : [];
  let number: string;
  try {
    ({ number } = await sendRequest(await actorFromUser(u), {
      partnerSlug: d.slug, serviceId: d.serviceId, eventTypeId: d.eventTypeId, eventDate: d.eventDate,
      startTime: d.startTime || null, endTime: d.endTime || null, guests: d.guests,
      venueName: d.venueName || null, locality: d.locality || null, cityId: c?.id ?? null, spaceType: d.spaceType ?? null,
      note: d.note || null, clientEventId: d.clientEventId ?? null, attachmentMediaIds: d.photos,
    }));
  } catch (e) {
    if (isNextSignal(e)) throw e;
    return { error: errorText(e) };
  }
  revalidatePath('/akaunt/zayavki');
  redirect(`/akaunt/zayavki/${encodeURIComponent(number)}`);
}
