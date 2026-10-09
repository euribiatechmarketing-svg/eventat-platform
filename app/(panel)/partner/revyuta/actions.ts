'use server';
// /partner/revyuta: ‹Отговори› → reviews.reply() → client-review-reply; toast ‹Отговорът е публикуван под ревюто›.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import * as reviews from '@/lib/domain/reviews';
import { partnerActor, refusal } from '../_catalogue/server';

const input = z.object({ reviewId: z.uuid(), text: z.string().max(2000) });

export async function replyToReviewAction(a: { reviewId: string; text: string }): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const actor = await partnerActor('/partner/revyuta');
  const r = input.safeParse(a);
  if (!r.success) return { ok: false, error: 'Напишете отговор.' };
  if (!r.data.text.trim()) return { ok: false, error: 'Напишете отговор.' };
  try {
    await db.transaction(tx => reviews.reply(actor, { reviewId: r.data.reviewId, text: r.data.text }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/revyuta');
  return { ok: true, message: 'Отговорът е публикуван под ревюто' };
}
