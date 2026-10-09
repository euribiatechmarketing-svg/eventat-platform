'use server';
// ‹Изпрати по имейл› → invoices.resend() → `client-invoice` (SPEC §9).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
import { resend } from '@/lib/domain/invoices';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { numberSchema } from '@/lib/client-booking/write';

export async function resendInvoiceAction(formData: FormData) {
  const u = await requireRole('client');
  const number = numberSchema.parse(formData.get('number'));
  const invoiceNumber = z.string().regex(/^\d{10}$/).parse(formData.get('invoice'));
  const back = `/akaunt/rezervacii/${encodeURIComponent(number)}/faktura?f=${invoiceNumber}`;
  try {
    await resend(await actorFromUser(u), { number, invoiceNumber });
    await setFlash('Изпратихме документа на имейла ви');
  } catch (e) {
    if (isNextSignal(e)) throw e;
    await setFlash(errorText(e), 'error');
  }
  revalidatePath(back);
  redirect(back);
}
