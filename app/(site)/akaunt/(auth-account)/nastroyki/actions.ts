'use server';
// /akaunt/nastroyki (client/settings.html). Every action: requireRole('client') → zod → domain → revalidate → toast.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { DomainError, normalizePhone } from '@/lib/domain/catalogue-kit';
import { requestDeletion, setAvatar, signOutEverywhere, updateInvoiceProfile } from '@/lib/domain/clients';
import { upload } from '@/lib/domain/media';
import { saveSettings } from '@/lib/domain/views-auth-account';
import { ERR, type FormState } from '../../../(auth)/_ui/messages';
import { clearAuthCookies } from '../../../(auth)/_ui/server';

const PATH = '/akaunt/nastroyki';

async function client() {
  const u = await requireRole('client', PATH);
  return actorFromUser(u);
}

/** The session cookie caches the user for a few minutes; read it fresh so the header shows the new name at once. */
async function refreshSession() {
  try { await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } }); } catch { /* signed out meanwhile */ }
}

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).refine(v => !!normalizePhone(v)),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  cityId: z.union([z.uuid(), z.literal('')]).transform(v => v || null),
  marketing: z.boolean(),
  twoFactor: z.boolean(),
  prefs: z.array(z.object({ key: z.string().max(64), channel: z.enum(['email', 'sms']), enabled: z.boolean() })).max(40),
});

/** ‹Запази промените› → accounts.updateClient() + notifications.setPreferences() + setMarketing() + setTwoFactor(); a new email → D55 code. */
export async function saveSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await client();
  const raw = { name: String(fd.get('name') ?? ''), phone: String(fd.get('phone') ?? ''), email: String(fd.get('email') ?? '') };
  let prefs: unknown = [];
  try { prefs = JSON.parse(String(fd.get('prefs') ?? '[]')); } catch { prefs = []; }
  const parsed = settingsSchema.safeParse({ ...raw, cityId: String(fd.get('cityId') ?? ''), marketing: fd.get('marketing') === '1', twoFactor: fd.get('twoFactor') === '1', prefs });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0]);
      if (errors[k]) continue;
      errors[k] = k === 'email' ? (raw.email.trim() ? ERR.email : ERR.required) : k === 'phone' ? (raw.phone.trim() ? ERR.phone : ERR.required) : ERR.required;
    }
    return { errors };
  }
  let emailChange: string | null = null;
  try {
    ({ emailChange } = await saveSettings(actor, parsed.data));
  } catch (e) {
    if (e instanceof DomainError) {
      if (e.code === 'email_taken') return { errors: { email: ERR.emailTaken } };
      if (e.code === 'invalid_email') return { errors: { email: ERR.email } };
      if (e.code === 'invalid_phone' || e.code === 'phone_required') return { errors: { phone: ERR.phone } };
      return { error: ERR.generic };
    }
    throw e;
  }
  await refreshSession();
  revalidatePath('/', 'layout');
  if (emailChange) redirect(`${PATH}/imeyl`);
  await setFlash('Промените са запазени');
  redirect(PATH);
}

/** ‹Смени снимката› → media.upload() + accounts.setAvatar(); toast ‹Снимката е обновена›. */
export async function changePhotoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await client();
  const file = fd.get('photo');
  if (!(file instanceof File) || file.size === 0) return null;
  try {
    const m = await upload(actor, { kind: 'user_avatar', file });
    await setAvatar(actor, { mediaId: m.id });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.code === 'upload_size' ? ERR.fileSize : e.code === 'upload_type' ? ERR.fileType : ERR.generic, at: Date.now() };
    if (e instanceof Error && /^[А-Я]/.test(e.message)) return { error: e.message, at: Date.now() }; // lib/storage's own messages
    throw e;
  }
  await refreshSession();
  revalidatePath('/', 'layout');
  await setFlash('Снимката е обновена');
  redirect(PATH);
}

/** ‹Смени паролата› → auth.requestPasswordReset() → client-password-link; toast ‹Изпратихме линк за нова парола на имейла ви›. */
export async function changePasswordAction() {
  const u = await requireRole('client', PATH);
  await auth.api.requestPasswordReset({ body: { email: u.email, redirectTo: '/vhod/nova-parola' }, headers: await headers() });
  await setFlash('Изпратихме линк за нова парола на имейла ви');
  redirect(PATH);
}

/** ‹Излез навсякъде› → accounts.signOutEverywhere() → client-signout-all → /. */
export async function signOutEverywhereAction() {
  const actor = await client();
  await signOutEverywhere(actor);
  await clearAuthCookies();
  revalidatePath('/', 'layout');
  redirect('/');
}

/** ‹Изтрий профила› → accounts.requestDeletion() → client-delete-confirm; toast ‹Изпратихме имейл за потвърждение на изтриването›. */
export async function requestDeletionAction() {
  const actor = await client();
  await requestDeletion(actor);
  await setFlash('Изпратихме имейл за потвърждение на изтриването');
  redirect(PATH);
}

const invoiceSchema = z.object({
  recipientType: z.enum(['individual', 'company']),
  name: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(200),
  eik: z.string().trim().max(20),
  mol: z.string().trim().max(200),
  address: z.string().trim().max(300),
});

/** ‹Данни за фактура› inline form → accounts.updateInvoiceProfile(); toast ‹Промените са запазени›. */
export async function saveInvoiceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await client();
  const raw = Object.fromEntries(['recipientType', 'name', 'companyName', 'eik', 'mol', 'address'].map(k => [k, String(fd.get(k) ?? '')]));
  const p = invoiceSchema.safeParse(raw);
  if (!p.success) return { errors: Object.fromEntries(p.error.issues.map(i => [String(i.path[0]), ERR.required])), values: raw };
  const d = p.data;
  if (d.recipientType === 'company') {
    const errors: Record<string, string> = {};
    if (!d.companyName) errors.companyName = ERR.required;
    if (!d.eik) errors.eik = ERR.required;
    if (!d.mol) errors.mol = ERR.required;
    if (Object.keys(errors).length) return { errors, values: raw };
  }
  try {
    await updateInvoiceProfile(actor, { ...d, companyName: d.companyName || null, eik: d.eik || null, mol: d.mol || null, address: d.address || null });
  } catch (e) {
    if (e instanceof DomainError) return { errors: e.code === 'invalid_eik' ? { eik: ERR.eik } : {}, error: e.code === 'invalid_eik' ? undefined : ERR.generic, values: raw };
    throw e;
  }
  revalidatePath(PATH);
  await setFlash('Промените са запазени');
  redirect(PATH);
}
