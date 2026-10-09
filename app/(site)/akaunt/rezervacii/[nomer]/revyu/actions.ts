'use server';
// ‹Публикувай ревюто› → reviews.publish() (SPEC V2); photos → media.upload().
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
import { REVIEW_MIN_CHARS, REVIEW_TAGS, publish } from '@/lib/domain/reviews';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/components/client-booking/ActionForm';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { uploadPhoto } from '@/lib/client-booking/upload';
import { numberSchema } from '@/lib/client-booking/write';

const star = z.coerce.number().int().min(1).max(5);
const Input = z.object({
  number: numberSchema,
  ratingOverall: star, ratingCommunication: star, ratingAccuracy: star, ratingQuality: star, ratingValue: star,
  body: z.string().trim().min(REVIEW_MIN_CHARS).max(4000),
  tags: z.array(z.enum(REVIEW_TAGS)).max(REVIEW_TAGS.length),
  photos: z.array(z.string().uuid()).max(6),
});

export async function uploadReviewPhotoAction(formData: FormData) {
  return uploadPhoto('review_photo', formData);
}

export async function publishReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await requireRole('client');
  const parsed = Input.safeParse({
    number: formData.get('number'),
    ratingOverall: formData.get('ratingOverall'), ratingCommunication: formData.get('ratingCommunication'),
    ratingAccuracy: formData.get('ratingAccuracy'), ratingQuality: formData.get('ratingQuality'), ratingValue: formData.get('ratingValue'),
    body: formData.get('body') ?? '', tags: formData.getAll('tag'), photos: formData.getAll('photo'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.some(i => i.path[0] === 'body') ? 'Вашият коментар — поне 40 символа' : 'Действието не е изпълнено. Опитайте отново.' };
  }
  const d = parsed.data;
  try {
    await publish(await actorFromUser(u), {
      number: d.number, ratingOverall: d.ratingOverall, ratingCommunication: d.ratingCommunication, ratingAccuracy: d.ratingAccuracy,
      ratingQuality: d.ratingQuality, ratingValue: d.ratingValue, body: d.body, tags: d.tags, photoMediaIds: d.photos,
    });
  } catch (e) {
    if (isNextSignal(e)) throw e;
    return { error: errorText(e) };
  }
  revalidatePath('/akaunt/rezervacii');
  revalidatePath(`/akaunt/rezervacii/${encodeURIComponent(d.number)}`);
  await setFlash('Ревюто е публикувано');
  redirect('/akaunt/rezervacii');
}
