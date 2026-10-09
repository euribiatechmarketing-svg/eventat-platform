'use server';
// /akaunt/rezervacii/[nomer] (SCREENS §4): ‹Пиши на изпълнителя›.
import { openThread } from '@/lib/client-booking/write';

export async function writeToPartnerAction(formData: FormData) {
  await openThread(formData);
}
