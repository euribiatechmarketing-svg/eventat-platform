'use server';
// /partner/smetka: ‹Качи документ› (media.upload('bank_proof')), ‹Запази сметката›
// (payouts.submitAccount → vendor-payout-account-submitted, team-payout-account) and, with
// stripe, the provider's onboarding link.
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import * as media from '@/lib/domain/media';
import { onboardingLink, submitAccount } from '@/lib/domain/payout-accounts';
import { BANKS } from '@/lib/domain/views-partner-catalogue';
import { setFlash } from '@/lib/flash';
import { partnerActor, refusal } from '../_catalogue/server';

export type AccountState = { fields?: Record<string, string>; error?: string; at?: number };

export async function uploadBankProofAction(formData: FormData): Promise<{ ok: true; mediaId: string; name: string; message: string } | { ok: false; error: string }> {
  const actor = await partnerActor('/partner/smetka');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Форматът на файла не се приема.' };
  try {
    const m = await media.upload(actor, { kind: 'bank_proof', file });
    return { ok: true, mediaId: m.id, name: file.name, message: 'Документът е качен и чака проверка' };
  } catch (e) { return { ok: false, error: refusal(e) }; }
}

const form = z.object({
  iban: z.string().max(64), holderName: z.string().max(200), bankName: z.string().max(120), proofMediaId: z.string().max(64),
});

export async function submitAccountAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const actor = await partnerActor('/partner/smetka');
  const r = form.safeParse(Object.fromEntries(['iban', 'holderName', 'bankName', 'proofMediaId'].map(k => [k, String(formData.get(k) ?? '')])));
  if (!r.success) return { error: 'Проверете попълнените полета.', at: Date.now() };
  const d = r.data;
  const fields: Record<string, string> = {};
  if (!d.iban.trim()) fields.iban = 'Въведете валиден български IBAN.';
  if (!d.holderName.trim()) fields.holderName = 'Титулярят трябва да е фирмата от профила ви.';
  if (!(BANKS as readonly string[]).includes(d.bankName)) fields.bankName = 'Изберете банка.';
  if (!z.uuid().safeParse(d.proofMediaId).success) fields.proof = 'Качете документ от банката.';
  if (Object.keys(fields).length) return { fields, at: Date.now() };
  try {
    await db.transaction(tx => submitAccount(actor, { iban: d.iban, holderName: d.holderName.trim(), bankName: d.bankName, proofMediaId: d.proofMediaId }, tx));
  } catch (e) {
    const msg = refusal(e);
    const field = msg.includes('IBAN') ? 'iban' : msg.includes('Титуляр') ? 'holderName' : msg.includes('банка') ? 'bankName' : null;
    return field ? { fields: { [field]: msg }, at: Date.now() } : { error: msg, at: Date.now() };
  }
  revalidatePath('/partner/smetka');
  revalidatePath('/partner/prihodi');
  await setFlash('Сметката е изпратена за проверка');
  redirect('/partner/prihodi');
}

/** stripe only: the provider's hosted onboarding (KYC) page. */
export async function providerOnboardingAction(): Promise<void> {
  const actor = await partnerActor('/partner/smetka');
  const h = await headers();
  const base = (process.env.APP_URL ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`).replace(/\/$/, '');
  let url: string;
  try {
    url = (await onboardingLink(actor, { returnUrl: `${base}/partner/smetka`, refreshUrl: `${base}/partner/smetka` })).url;
  } catch (e) {
    await setFlash(refusal(e), 'error');
    redirect('/partner/smetka');
  }
  redirect(url);
}
