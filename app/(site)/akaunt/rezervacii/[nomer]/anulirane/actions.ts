'use server';
// ‹Анулирай резервацията› → cancellation.cancelByClient() (SPEC K7).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
import { cancelByClient } from '@/lib/domain/cancellation';
import { cancelPageData } from '@/lib/domain/views-client-booking';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/components/client-booking/ActionForm';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { numberSchema } from '@/lib/client-booking/write';

const Input = z.object({
  number: numberSchema,
  reason: z.enum(['date_change', 'other_vendor', 'event_cancelled', 'other'], { message: 'Причина за анулирането' }),
  reasonText: z.string().trim().max(1000).optional(),
});

export async function cancelBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await requireRole('client');
  const parsed = Input.safeParse({
    number: formData.get('number'), reason: formData.get('reason') ?? undefined, reasonText: formData.get('reasonText') ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues.some(i => i.path[0] === 'reason') ? 'Причина за анулирането' : 'Действието не е изпълнено. Опитайте отново.' };
  const { number, reason, reasonText } = parsed.data;
  if (reason === 'other' && !reasonText) return { error: 'Опишете причината.' };
  const actor = await actorFromUser(u);
  try {
    const v = await cancelPageData(actor, number);
    await cancelByClient(actor, { bookingId: v.booking.id, reason, reasonText: reason === 'other' ? reasonText : null });
  } catch (e) {
    if (isNextSignal(e)) throw e;
    return { error: errorText(e) };
  }
  const n = encodeURIComponent(number);
  revalidatePath('/akaunt/rezervacii');
  revalidatePath(`/akaunt/rezervacii/${n}`);
  await setFlash('Резервацията е анулирана — изпратихме ви потвърждение по имейл');
  redirect('/akaunt/rezervacii');
}
