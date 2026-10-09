'use server';
// ‹Изпрати запитването› → briefs.create() (SPEC O1); photos → media.upload().
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
import { create } from '@/lib/domain/briefs';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/components/client-booking/ActionForm';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { uploadPhoto } from '@/lib/client-booking/upload';

const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const Input = z.object({
  categories: z.array(slug).min(1, 'изберете поне една').max(20),
  eventType: slug,
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.coerce.number().int().min(1).max(100_000),
  city: slug,
  budget: z.enum(['lt_1000', 'b1000_2000', 'gt_2000', 'unknown']).default('unknown'),
  description: z.string().trim().max(2000).optional(),
  photos: z.array(z.string().uuid()).max(6),
});

export async function uploadBriefPhotoAction(formData: FormData) {
  return uploadPhoto('brief_attachment', formData);
}

export async function sendBriefAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await requireRole('client');
  const val = (k: string) => { const v = formData.get(k); return v == null ? undefined : String(v); };
  const parsed = Input.safeParse({
    categories: formData.getAll('category').map(String), eventType: val('eventType'), eventDate: val('eventDate'), guests: val('guests'),
    city: val('city'), budget: val('budget') || undefined, description: val('description'), photos: formData.getAll('photo').map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.some(i => i.path[0] === 'categories') ? 'Какво търсите — изберете поне една' : 'Действието не е изпълнено. Опитайте отново.' };
  }
  const d = parsed.data;
  try {
    await create(await actorFromUser(u), {
      categorySlugs: d.categories, eventTypeSlug: d.eventType, eventDate: d.eventDate, guests: d.guests, citySlug: d.city,
      budget: d.budget, description: d.description || null, attachmentMediaIds: d.photos,
    });
  } catch (e) {
    if (isNextSignal(e)) throw e;
    return { error: errorText(e) };
  }
  revalidatePath('/akaunt/zayavki');
  await setFlash('Запитването е изпратено — потвърждението е на имейла ви, а офертите идват в „Моите заявки“');
  redirect('/akaunt/zayavki');
}
