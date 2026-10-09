'use server';
// /admin/nastroyki (SCREENS §8, SPEC §2) [manage_team_settings]: versioned settings, categories, demo clock.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { getSetting } from '@/lib/domain/settings';
import { addCategory, advanceClock, updateSettings, type EditableSetting } from '@/lib/domain/views-admin-ops';
import { requireTeam } from '../_ops/guard';
import { failure, toastBack } from '../_ops/act';

const percent = z.string().trim().regex(/^\d{1,3}([.,]\d{1,2})?$/).transform(v => Math.round(parseFloat(v.replace(',', '.')) * 100)).pipe(z.number().int().min(0).max(10_000));
const hours = z.string().trim().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().min(1).max(24 * 60));
const days = z.string().trim().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(365));
const flag = z.enum(['0', '1']).transform(v => v === '1');

/** ‹Запази промените› → settings.update() (new versions effective now); toast ‹Промените са запазени›. */
export async function updateSettingsAction(fd: FormData) {
  const { actor } = await requireTeam('manage_team_settings');
  const values: Record<string, unknown> = {};
  const has = (k: string) => fd.has(k) && String(fd.get(k)) !== '';
  try {
    for (const [field, key] of [['commission.standard', 'commission.standard_bp'], ['commission.intro', 'commission.intro_bp'], ['commission.business', 'commission.business_bp']] as const) {
      if (has(field)) values[key] = percent.parse(String(fd.get(field)));
    }
    for (const key of ['payment.window_hours', 'request.response_hours'] as const) if (has(key)) values[key] = hours.parse(String(fd.get(key)));
    for (const key of ['moderation.manual', 'locale.en_enabled', 'payment.bank_transfer_enabled'] as const) if (has(key)) values[key] = flag.parse(String(fd.get(key)));
    if ([...fd.keys()].some(k => k.startsWith('policy.'))) {
      const current = await getSetting('cancellation.policies');
      const next = structuredClone(current);
      for (const k of ['flexible', 'moderate', 'strict'] as const) {
        next[k].tiers = current[k].tiers.map((t, i) => {
          const f = `policy.${k}.${i}`;
          return has(f) && t.minDaysBefore !== 0 ? { ...t, minDaysBefore: days.parse(String(fd.get(f))) } : t;
        });
        if (!next[k].tiers.every((t, i, a) => i === 0 || t.minDaysBefore < a[i - 1].minDaysBefore)) return { error: failure('validation') };
      }
      values['cancellation.policies'] = next;
    }
  } catch { return { error: failure('validation') }; }
  const categories = [...fd.entries()].filter(([k]) => k.startsWith('cat.'))
    .map(([k, v]) => ({ id: k.slice(4), visible: v === '1' })).filter(c => z.uuid().safeParse(c.id).success);
  try {
    await db.transaction(tx => updateSettings(actor, { values: values as Partial<Record<EditableSetting, never>>, categories }, tx));
  } catch (e) { return { error: failure(e) }; }
  revalidatePath('/', 'layout');
  await toastBack('Промените са запазени', '/admin/nastroyki');
}

/** ‹Добави категория› [dialog new copy] → reference category; toast ‹Категорията е добавена›. */
export async function addCategoryAction(fd: FormData) {
  const { actor } = await requireTeam('manage_team_settings');
  const name = z.string().trim().min(2).max(60).safeParse(fd.get('name'));
  if (!name.success) return { error: failure('validation') };
  try { await db.transaction(tx => addCategory(actor, { name: name.data }, tx)); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/', 'layout');
  await toastBack('Категорията е добавена', '/admin/nastroyki');
}

/** Demo clock (ALLOW_TIME_TRAVEL only): move the platform clock forward and run the due jobs. */
export async function advanceClockAction(fd: FormData) {
  const { actor } = await requireTeam('manage_team_settings');
  const h = z.coerce.number().int().min(1).max(24 * 90).safeParse(fd.get('hours'));
  if (!h.success) return { error: failure('validation') };
  try { await advanceClock(actor, { hours: h.data }); } catch (e) { return { error: failure(e) }; }
  revalidatePath('/', 'layout');
  await toastBack('Промените са запазени', '/admin/nastroyki');
}
