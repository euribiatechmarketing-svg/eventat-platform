'use server';
// /admin/nastroyki/ekip (SCREENS §8, SPEC §4.15) [manage_team_settings].
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { invite, removeMember, revokeInvite } from '@/lib/domain/team';
import { requireTeam } from '../../_ops/guard';
import { failure, toastBack } from '../../_ops/act';

const BACK = '/admin/nastroyki/ekip';

/** ‹Изпрати покана› (Имейл, Роля) → `team-invite`; toast ‹Поканата е изпратена›. */
export async function inviteMemberAction(fd: FormData) {
  const { actor } = await requireTeam('manage_team_settings');
  const email = z.email().safeParse(String(fd.get('email') ?? '').trim().toLowerCase());
  if (!email.success) return { error: failure('invalid_email') };
  const role = z.enum(['admin', 'moderator', 'support', 'accounting']).safeParse(fd.get('role'));
  if (!role.success) return { error: failure('validation') };
  try { await db.transaction(tx => invite(actor, { email: email.data, role: role.data }, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath(BACK);
  await toastBack('Поканата е изпратена', BACK);
}

/** ‹Оттегли› → revoked; toast ‹Поканата е оттеглена›. */
export async function revokeInviteAction(fd: FormData) {
  const { actor } = await requireTeam('manage_team_settings');
  const d = z.uuid().safeParse(fd.get('inviteId'));
  if (!d.success) return { error: failure('validation') };
  try { await db.transaction(tx => revokeInvite(actor, { inviteId: d.data }, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath(BACK);
  await toastBack('Поканата е оттеглена', BACK);
}

/** ‹Премахни› (never the owner): sessions revoked; toast ‹Премахнато›. */
export async function removeMemberAction(fd: FormData) {
  const { actor } = await requireTeam('manage_team_settings');
  const d = z.string().min(1).max(64).safeParse(fd.get('userId'));
  if (!d.success) return { error: failure('validation') };
  try { await db.transaction(tx => removeMember(actor, { userId: d.data }, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin/nastroyki', 'layout');
  await toastBack('Премахнато', BACK);
}
