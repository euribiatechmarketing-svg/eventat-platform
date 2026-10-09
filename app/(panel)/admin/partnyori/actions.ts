'use server';
// /admin/partnyori and /admin/partnyori/[id] (SCREENS §8, SPEC §4.2 P5–P7): decisions, checks, notes,
// ‹Покани изпълнител›, ‹Експорт›. Each action: team permission → zod → domain → revalidate → toast.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { approve, invite, reject, returnApplication, setCheck } from '@/lib/domain/partners';
import { addNote } from '@/lib/domain/team';
import { requestAdminExport, teamCheckDetail } from '@/lib/domain/views-admin-ops';
import { requireTeam } from '../_ops/guard';
import { failure, safeBack, toastBack } from '../_ops/act';

const uuid = z.uuid();
const back = (fd: FormData) => safeBack(String(fd.get('back') ?? ''), '/admin/partnyori');

const decision = z.object({ partnerId: uuid, decision: z.enum(['approve', 'return', 'reject']), note: z.string().trim().max(2000).default('') });
const TOAST = { approve: 'Профилът е одобрен', return: 'Профилът е върнат за поправка', reject: 'Заявката е отказана' } as const;

/** ‹Одобри› / ‹Върни за поправка› / ‹Откажи заявката› (note required for the last two). */
export async function decidePartnerAction(fd: FormData) {
  const { actor } = await requireTeam('approve_partners');
  const d = decision.safeParse({ partnerId: fd.get('partnerId'), decision: fd.get('decision'), note: fd.get('note') ?? '' });
  if (!d.success) return { error: failure('validation') };
  if (d.data.decision !== 'approve' && !d.data.note) return { error: failure('note_required') };
  try {
    await db.transaction(async tx => {
      if (d.data.decision === 'approve') await approve(actor, { partnerId: d.data.partnerId, note: d.data.note || null }, tx);
      else if (d.data.decision === 'return') await returnApplication(actor, { partnerId: d.data.partnerId, note: d.data.note }, tx);
      else await reject(actor, { partnerId: d.data.partnerId, note: d.data.note }, tx);
    });
  } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin', 'layout');
  await toastBack(TOAST[d.data.decision], '/admin/partnyori');
}

const check = z.object({ partnerId: uuid, kind: z.enum(['company', 'contacts', 'gallery']), state: z.enum(['ok', 'waiting']) });

/** A team check (company, contacts, gallery) marked ok or back to waiting [control new copy]. */
export async function setCheckAction(fd: FormData) {
  const { actor } = await requireTeam('approve_partners');
  const d = check.safeParse({ partnerId: fd.get('partnerId'), kind: fd.get('kind'), state: fd.get('state') });
  if (!d.success) return { error: failure('validation') };
  try {
    const detail = d.data.state === 'ok' ? await teamCheckDetail(d.data.partnerId, d.data.kind) : null;
    await db.transaction(tx => setCheck(actor, { ...d.data, detail }, tx));
  } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin/partnyori', 'layout');
  await toastBack('Промените са запазени', back(fd));
}

const note = z.object({ partnerId: uuid, body: z.string().trim().min(1).max(2000) });

/** ‹Бележки от модерацията›: notes.add() on blur. */
export async function addPartnerNoteAction(fd: FormData) {
  const { actor } = await requireTeam('approve_partners');
  const d = note.safeParse({ partnerId: fd.get('partnerId'), body: fd.get('body') });
  if (!d.success) return { error: failure('validation') };
  try {
    await db.transaction(tx => addNote(actor, { subjectType: 'partner', subjectId: d.data.partnerId, body: d.data.body }, tx));
  } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin/partnyori', 'layout');
  await toastBack('Бележката е запазена', back(fd));
}

/** ‹Покани изпълнител› → `vendor-invite`; toast ‹Поканата е изпратена›. */
export async function invitePartnerAction(fd: FormData) {
  const { actor } = await requireTeam('invite_partner');
  const email = z.email().safeParse(String(fd.get('email') ?? '').trim().toLowerCase());
  if (!email.success) return { error: failure('invalid_email') };
  try {
    await db.transaction(tx => invite(actor, { email: email.data }, tx));
  } catch (e) { return { error: failure(e) }; }
  await toastBack('Поканата е изпратена', back(fd));
}

/** ‹Експорт› (D68): report_job; toast only until the team email exists. */
export async function requestPartnersExportAction(fd: FormData) {
  const { actor } = await requireTeam('approve_partners');
  const params = Object.fromEntries(['tab', 'kategoriya', 'grad', 'q'].map(k => [k, String(fd.get(k) ?? '') || null]));
  try {
    await requestAdminExport(actor, { kind: 'admin_partners', params });
  } catch (e) { return { error: failure(e) }; }
  await toastBack('Справката се подготвя — ще я получите по имейл', back(fd));
}
