'use server';
// /partner/uslugi/[id]: ‹Запази промените› (services.submitChange, S6), for an unpublished
// draft ‹Запази като чернова› / ‹Изпрати за преглед› (S1 / S2), ‹Архивирай› (S10) and the
// visibility choice ‹Активна› / ‹Чернова› (services.setVisibility, S9).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import * as services from '@/lib/domain/services';
import { setFlash } from '@/lib/flash';
import { partnerActor, refusal } from '../../_catalogue/server';
import { readEditor, type EditorState } from '../../_catalogue/service-form';

const id = z.uuid();

export async function saveServiceAction(serviceId: string, _prev: EditorState, formData: FormData): Promise<EditorState> {
  const actor = await partnerActor(`/partner/uslugi/${serviceId}`);
  if (!id.safeParse(serviceId).success) return { fields: { form: 'Записът не е намерен.' } };
  const intent = String(formData.get('intent') ?? '');
  if (!['change', 'draft', 'submit'].includes(intent)) return { fields: { form: 'Проверете попълнените полета.' } };
  const { input, fields } = readEditor(formData, intent !== 'draft');
  if (!input) return { fields };
  let message: string;
  let tab = '';
  try {
    await db.transaction(async tx => {
      if (intent === 'change') {
        const r = await services.submitChange(actor, { ...input, id: serviceId }, tx);
        message = r.revision ? 'Промените са изпратени за преглед' : 'Промените са запазени';
      } else if (intent === 'submit') {
        const s = await services.submit(actor, { ...input, id: serviceId }, tx);
        message = 'Услугата е изпратена за преглед';
        tab = s.status === 'pending_review' ? '?tab=v-pregled' : '';
      } else {
        await services.saveDraft(actor, { ...input, id: serviceId }, tx);
        message = 'Черновата е запазена';
        tab = '?tab=chernovi';
      }
    });
  } catch (e) { return { fields: { form: refusal(e) } }; }
  revalidatePath('/partner/uslugi');
  revalidatePath(`/partner/uslugi/${serviceId}`);
  await setFlash(message!);
  redirect(`/partner/uslugi${tab}`);
}

export async function archiveServiceAction(formData: FormData): Promise<void> {
  const serviceId = String(formData.get('id') ?? '');
  const actor = await partnerActor(`/partner/uslugi/${serviceId}`);
  if (!id.safeParse(serviceId).success) redirect('/partner/uslugi');
  try {
    await db.transaction(tx => services.archive(actor, { serviceId }, tx));
  } catch (e) {
    await setFlash(refusal(e), 'error');
    redirect(`/partner/uslugi/${serviceId}`);
  }
  revalidatePath('/partner/uslugi');
  await setFlash('Услугата е архивирана');
  redirect('/partner/uslugi?tab=arhiv');
}

export async function setServiceVisibilityAction(serviceId: string, active: boolean): Promise<{ ok: boolean; message: string }> {
  const actor = await partnerActor(`/partner/uslugi/${serviceId}`);
  if (!id.safeParse(serviceId).success || typeof active !== 'boolean') return { ok: false, message: 'Записът не е намерен.' };
  try {
    await db.transaction(tx => services.setVisibility(actor, { serviceId, active }, tx));
  } catch (e) { return { ok: false, message: refusal(e) }; }
  revalidatePath('/partner/uslugi');
  revalidatePath(`/partner/uslugi/${serviceId}`);
  return { ok: true, message: 'Промените са запазени' };
}
