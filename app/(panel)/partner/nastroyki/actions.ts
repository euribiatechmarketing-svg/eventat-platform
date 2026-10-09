'use server';
// /partner/nastroyki (SCREENS §7): ‹Запази промените› (partners.updateAccount + notifications.setPreferences),
// ‹Смени името›, ‹Смени паролата› (auth.requestPasswordReset → vendor-password-reset), ‹Деактивирай›
// (vendor-deactivated) and its way back (P9), ‹Изтрий› (vendor-delete-confirm), ‹BG› / ‹EN›.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { auth } from '@/lib/auth';
import { setPreferences } from '@/lib/domain/clients';
import * as partners from '@/lib/domain/partners';
import { hit } from '@/lib/domain/throttle';
import { setLocale } from '@/lib/domain/views-partner-catalogue';
import { requireRole } from '@/lib/session';
import { partnerActor, refusal } from '../_catalogue/server';

type Result = { ok: true; message: string } | { ok: false; error: string; fields?: Record<string, string> };

const PREF_KEYS = ['partner.new-request', 'partner.payment-reminder', 'partner.new-review', 'partner.news'] as const;
const settings = z.object({
  contactName: z.string().max(200), notificationEmail: z.string().max(320), phone: z.string().max(40), socialHandle: z.string().max(400),
  prefs: z.object(Object.fromEntries(PREF_KEYS.map(k => [k, z.boolean()])) as Record<(typeof PREF_KEYS)[number], z.ZodBoolean>),
});

export async function saveSettingsAction(a: unknown): Promise<Result> {
  const actor = await partnerActor('/partner/nastroyki');
  const r = settings.safeParse(a);
  if (!r.success) return { ok: false, error: 'Проверете попълнените полета.' };
  const d = r.data;
  const fields: Record<string, string> = {};
  if (!d.contactName.trim()) fields.contactName = 'Въведете лице за контакт.';
  if (!z.email().safeParse(d.notificationEmail.trim()).success) fields.notificationEmail = 'Въведете валиден имейл.';
  if (!d.phone.trim()) fields.phone = 'Въведете валиден телефон.';
  if (!d.socialHandle.trim()) fields.socialHandle = 'Въведете профил в Instagram или Facebook.';
  if (Object.keys(fields).length) return { ok: false, error: 'Проверете попълнените полета.', fields };
  try {
    await db.transaction(async tx => {
      await partners.updateAccount(actor, { contactName: d.contactName.trim(), notificationEmail: d.notificationEmail.trim(), phone: d.phone.trim() }, tx);
      await partners.updateProfile(actor, { socialHandle: d.socialHandle.trim() }, tx);
      await setPreferences(actor, PREF_KEYS.map(key => ({ key, channel: 'email' as const, enabled: d.prefs[key] })), tx);
    });
  } catch (e) {
    const msg = refusal(e);
    return msg === 'Въведете валиден телефон.' ? { ok: false, error: msg, fields: { phone: msg } } : { ok: false, error: msg };
  }
  revalidatePath('/partner', 'layout');
  return { ok: true, message: 'Промените са запазени' };
}

export async function changeNameAction(name: string): Promise<Result> {
  const actor = await partnerActor('/partner/nastroyki');
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > 120) return { ok: false, error: 'Проверете попълнените полета.' };
  try {
    await db.transaction(tx => partners.changeBusinessName(actor, { businessName: n }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner', 'layout');
  return { ok: true, message: 'Промените са запазени' };
}

export async function requestPasswordResetAction(): Promise<Result> {
  const u = await requireRole('partner', '/partner/nastroyki');
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  if (await hit('resetEmail', u.email)) await auth.api.requestPasswordReset({ body: { email: u.email, redirectTo: `${base}/vhod/nova-parola` } });
  return { ok: true, message: 'Изпратихме линк за нова парола на имейла ви' };
}

export async function deactivateAction(): Promise<Result> {
  const actor = await partnerActor('/partner/nastroyki');
  try {
    await db.transaction(tx => partners.deactivate(actor, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner', 'layout');
  return { ok: true, message: 'Профилът е деактивиран — можете да го върнете по всяко време' };
}

export async function reactivateAction(): Promise<Result> {
  const actor = await partnerActor('/partner/nastroyki');
  try {
    await db.transaction(tx => partners.reactivate(actor, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner', 'layout');
  return { ok: true, message: 'Промените са запазени' };
}

export async function requestDeletionAction(): Promise<Result> {
  const actor = await partnerActor('/partner/nastroyki');
  try {
    await db.transaction(tx => partners.requestDeletion(actor, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  return { ok: true, message: 'Изпратихме имейл за потвърждение на изтриването' };
}

export async function setLocaleAction(locale: 'bg' | 'en'): Promise<Result> {
  const actor = await partnerActor('/partner/nastroyki');
  if (locale !== 'bg' && locale !== 'en') return { ok: false, error: 'Проверете попълнените полета.' };
  try {
    await db.transaction(tx => setLocale(actor, { locale }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/nastroyki');
  return { ok: true, message: locale === 'bg' ? 'Езикът е сменен на български' : 'Промените са запазени' };
}
