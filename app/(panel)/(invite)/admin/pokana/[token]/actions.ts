'use server';
// /admin/pokana/[token] (SPEC §4.15 ‹Приеми поканата›): a new address chooses a password; an existing
// account confirms its own. Then team.acceptInvite() and a session; the panel opens.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { acceptInviteWithPassword, invitePage } from '@/lib/domain/views-admin-ops';
import { failure } from '@/app/(panel)/admin/_ops/act';

export async function acceptInviteAction(fd: FormData) {
  const token = z.string().min(10).max(200).safeParse(fd.get('token'));
  if (!token.success) return { error: failure('invalid_token') };
  const password = String(fd.get('password') ?? '');
  const page = await invitePage(token.data);
  if (!page || !page.valid) return { error: failure('invalid_token') };
  const email = page.invite.email;
  try {
    if (page.existingUser) {
      if (page.existingUser.role === 'partner') return { error: failure('email_taken') };
      const h = await headers();
      const ok = await auth.api.signInEmail({ body: { email, password, rememberMe: true }, headers: h }).then(() => true).catch(() => false);
      if (!ok) return { error: failure('wrong_password') };
      await acceptInviteWithPassword({ token: token.data, existingUserId: page.existingUser.id });
    } else {
      const name = String(fd.get('name') ?? '');
      if (password.length < 8) return { error: failure('password_short') };
      await acceptInviteWithPassword({ token: token.data, name, password });
      const h = await headers();
      await auth.api.signInEmail({ body: { email, password, rememberMe: true }, headers: h });
    }
  } catch (e) { return { error: failure(e) }; }
  redirect('/admin');
}
