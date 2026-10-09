'use server';
// /registratsiya (client/register.html): ‹Създай профил› → accounts.registerClient() / partners.register()
// (SPEC §4.1 A1, §4.2 P1) → the 6-digit code (client-verify-code / vendor-verify-code) →
// /potvarzhdenie?email=&as=&next=.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { registerClient } from '@/lib/domain/clients';
import { register as registerPartner } from '@/lib/domain/partners';
import { normalizePhone } from '@/lib/domain/catalogue-kit';
import { accountByEmail, safeNext } from '@/lib/domain/views-auth-account';
import { ERR, carry, type FormState } from '../_ui/messages';
import { authErrorCode, clientIp } from '../_ui/server';

const base = {
  email: z.string().trim().toLowerCase().pipe(z.email()),
  phone: z.string().trim().min(1).refine(v => !!normalizePhone(v)),
  password: z.string().min(8).max(128),
  consent: z.literal(true),
};
const clientSchema = z.object({ ...base, name: z.string().trim().min(1).max(120) });
const partnerSchema = z.object({ ...base, businessName: z.string().trim().min(1).max(120), contactName: z.string().trim().min(1).max(120) });

const MESSAGE: Record<string, (v: string) => string> = {
  email: v => (v ? ERR.email : ERR.required),
  phone: v => (v ? ERR.phone : ERR.required),
  password: v => (v ? ERR.password : ERR.required),
  consent: () => ERR.consent,
};

export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const role = fd.get('role') === 'partner' ? 'partner' : 'client';
  const next = safeNext(String(fd.get('next') ?? ''));
  const raw: Record<string, string> = {};
  for (const k of ['name', 'businessName', 'contactName', 'email', 'phone']) raw[k] = String(fd.get(k) ?? '').trim();
  const input = { ...raw, password: String(fd.get('password') ?? ''), consent: fd.get('consent') === 'on' };
  const parsed = role === 'client' ? clientSchema.safeParse(input) : partnerSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0]);
      if (!errors[k]) errors[k] = MESSAGE[k]?.((input as Record<string, unknown>)[k] as string) ?? ERR.required;
    }
    // A well-formed address that already has a profile is said at once, with the other errors.
    if (!errors.email && (await accountByEmail(raw.email))) errors.email = ERR.emailTaken;
    return { errors, values: { ...raw, role } };
  }
  const d = parsed.data;
  if (await accountByEmail(d.email)) return { errors: { email: ERR.emailTaken }, values: { ...raw, role } };

  const name = 'name' in d ? d.name : d.contactName;
  let userId: string;
  try {
    const r = await auth.api.signUpEmail({ body: { name, email: d.email, password: d.password, phone: normalizePhone(d.phone) ?? undefined }, headers: await headers() });
    userId = r.user.id;
  } catch (e) {
    const code = authErrorCode(e);
    if (code.startsWith('USER_ALREADY_EXISTS')) return { errors: { email: ERR.emailTaken }, values: { ...raw, role } };
    if (code === 'PASSWORD_TOO_SHORT') return { errors: { password: ERR.password }, values: { ...raw, role } };
    return { error: ERR.generic, values: { ...raw, role } };
  }
  const ip = await clientIp();
  if ('businessName' in d) {
    await registerPartner({ userId, businessName: d.businessName, contactName: d.contactName, phone: d.phone, email: d.email, ip, consent: true });
  } else {
    await registerClient({ userId, phone: d.phone, consent: true, ip });
  }
  // The code goes out once the role is known, so it is the client or the partner email.
  await auth.api.sendVerificationOTP({ body: { email: d.email, type: 'email-verification' } });
  redirect(`/potvarzhdenie${carry(role, next, { email: d.email })}`);
}
