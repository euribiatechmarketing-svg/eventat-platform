'use server';
// /vhod/nova-parola: the new password from the email link (SPEC §4.1 A6 → `accounts.resetPassword()`;
// lib/auth.ts onPasswordReset records password_changed_at, ends every session and sends
// `client-password-changed` to clients). The toast is that email's own heading.
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { ERR, type FormState } from '../../_ui/messages';

export async function resetPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get('token') ?? '');
  const pw = z.string().min(8).max(128).safeParse(String(fd.get('password') ?? ''));
  if (!pw.success) return { errors: { password: String(fd.get('password') ?? '') ? ERR.password : ERR.required } };
  try {
    await auth.api.resetPassword({ body: { newPassword: pw.data, token } });
  } catch {
    return { error: ERR.link };
  }
  await setFlash('Паролата ви е сменена');
  redirect('/vhod');
}
