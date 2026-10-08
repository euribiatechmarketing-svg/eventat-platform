'use server';
// /partner/uslugi/nova: ‹Запази като чернова› (services.saveDraft, S1) and
// ‹Изпрати за преглед› (services.submit, S2 → vendor-service-submitted / -published).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import * as services from '@/lib/domain/services';
import { setFlash } from '@/lib/flash';
import { partnerActor, refusal } from '../../_catalogue/server';
import { readEditor, type EditorState } from '../../_catalogue/service-form';

export async function createServiceAction(_prev: EditorState, formData: FormData): Promise<EditorState> {
  const actor = await partnerActor('/partner/uslugi/nova');
  const intent = formData.get('intent') === 'submit' ? 'submit' : 'draft';
  const { input, fields } = readEditor(formData, intent === 'submit');
  if (!input) return { fields };
  let status: string;
  try {
    const s = await db.transaction(tx => (intent === 'submit' ? services.submit(actor, input, tx) : services.saveDraft(actor, input, tx)));
    status = s.status;
  } catch (e) { return { fields: { form: refusal(e) } }; }
  revalidatePath('/partner/uslugi');
  await setFlash(intent === 'submit' ? 'Услугата е изпратена за преглед' : 'Черновата е запазена');
  redirect(status === 'pending_review' ? '/partner/uslugi?tab=v-pregled' : status === 'active' ? '/partner/uslugi' : '/partner/uslugi?tab=chernovi');
}
