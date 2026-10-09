'use server';
// /akaunt/rezervacii (SCREENS §4): ‹Пиши на изпълнителя› on the next booking.
import { openThread } from '@/lib/client-booking/write';

export async function writeToPartnerAction(formData: FormData) {
  await openThread(formData);
}
