'use server';
// Step 3 ‹Пакети и услуги› (SPEC §12.1, §12.2, S5): every open editor → services.saveOnboarding();
// ‹Премахни› → services.remove(); ‹Продължи към наличността› → partners.saveStep(3).
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { parseMoney } from '@/lib/format';
import { saveDraft, saveStep } from '@/lib/domain/partners';
import { remove, saveOnboarding } from '@/lib/domain/services';
import { DomainError, partnerOf } from '@/lib/domain/catalogue-kit';
import { onboardingServices } from '@/lib/domain/views-partner-onboarding';
import { getSetting } from '@/lib/domain/settings';
import { BASE, CHECK_FORM, REQUIRED, proceed, readIntent, readOnlyRedirect, text, wizardActor, type StepState } from '../flow';

const isUuid = (v: string) => z.uuid().safeParse(v).success;

type Editor = {
  key: string; id: string | null; kind: 'package_fixed' | 'on_request'; name: string; categoryId: string; description: string;
  price: string; duration: string; extraHour: boolean; extraHourPrice: string; travel: boolean; inclusions: string[];
};

function readEditors(fd: FormData): Editor[] {
  return [...new Set(fd.getAll('pkg').map(String))].filter(k => /^[\w-]{1,64}$/.test(k)).map(key => {
    const f = (n: string) => text(fd, `pkg.${key}.${n}`);
    const id = f('id');
    return {
      key, id: isUuid(id) ? id : null, kind: f('kind') === 'on_request' ? 'on_request' : 'package_fixed',
      name: f('name').slice(0, 80), categoryId: f('categoryId'), description: f('description').slice(0, 600),
      price: f('price'), duration: f('duration').slice(0, 80), extraHour: fd.get(`pkg.${key}.extraHour`) === 'on',
      extraHourPrice: f('extraHourPrice'), travel: fd.get(`pkg.${key}.travel`) === 'on',
      inclusions: fd.getAll(`pkg.${key}.inc`).map(v => String(v).trim().slice(0, 120)).filter(Boolean).slice(0, 12),
    };
  });
}

const isEmpty = (e: Editor) => !e.name && !e.description && !e.price && !e.duration && !e.inclusions.length;

/** Field errors of one editor for ‹Продължи› (§12.1 step 3: name, category, short description, price). */
function editorErrors(e: Editor): Record<string, string> {
  const f: Record<string, string> = {};
  const k = `pkg.${e.key}`;
  if (!e.name) f[`${k}.name`] = REQUIRED;
  if (!isUuid(e.categoryId)) f[`${k}.categoryId`] = REQUIRED;
  if (!e.description) f[`${k}.description`] = REQUIRED;
  if (e.kind === 'package_fixed') {
    if (!e.price) f[`${k}.price`] = REQUIRED;
    else if (!(parseMoney(e.price)! > 0)) f[`${k}.price`] = 'Проверете цената.';
  }
  if (e.extraHour && e.extraHourPrice && !(parseMoney(e.extraHourPrice)! > 0)) f[`${k}.extraHourPrice`] = 'Проверете цената.';
  return f;
}

export async function servicesAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const actor = await wizardActor();
  const intent = readIntent(fd);
  const flags = { offersFixedPackages: fd.get('offersFixedPackages') === 'on', offersOnRequest: fd.get('offersOnRequest') === 'on' };
  const editors = readEditors(fd);
  const created: Record<string, string> = {};
  const fields: Record<string, string> = {};
  let error: string | null = null;
  try {
    await saveDraft(actor, { step: 3, data: flags });
    for (const e of editors) {
      if (!e.name) continue; // a package needs at least its name to be kept (S1)
      const price = parseMoney(e.price);
      const extra = parseMoney(e.extraHourPrice);
      const input = {
        kind: e.kind, name: e.name,
        ...(isUuid(e.categoryId) ? { categoryId: e.categoryId } : {}),
        ...(e.description ? { description: e.description } : {}),
        ...(e.kind === 'package_fixed' && price && price > 0 ? { priceCents: price } : {}),
        durationLabel: e.duration || null,
        extraHourEnabled: e.extraHour, extraHourPriceCents: extra && extra > 0 ? extra : null,
        travelFeeEnabled: e.travel, inclusions: e.inclusions,
      };
      try {
        const s = await saveOnboarding(actor, e.id ? { ...input, id: e.id } : input);
        if (!e.id) created[e.key] = s.id;
      } catch (err) {
        readOnlyRedirect(err);
        if (!(err instanceof DomainError)) throw err;
        if (err.code === 'max_packages') error = `Можете да добавите до ${await getSetting('partner.max_packages')} пакета.`;
        else if (err.code === 'not_found' || err.code === 'service_status') continue;
        else fields[`pkg.${e.key}.name`] = REQUIRED;
      }
    }
  } catch (e) {
    readOnlyRedirect(e);
    if (!(e instanceof DomainError)) throw e;
  }
  const out = (s: StepState): StepState => ({ ...s, created: Object.keys(created).length ? created : undefined, saved: true, at: Date.now() });

  if (intent === 'next') {
    for (const e of editors) if (!isEmpty(e)) Object.assign(fields, editorErrors(e));
    // Saved services that are not open in an editor must be complete too.
    const p = await partnerOf(actor, db);
    const open = new Set(editors.map(e => e.id ?? created[e.key]).filter(Boolean));
    for (const s of await onboardingServices(p.id)) {
      if (open.has(s.id) || s.complete) continue;
      Object.assign(fields, editorErrors({
        key: s.id, id: s.id, kind: s.kind, name: s.name, categoryId: s.categoryId, description: s.description,
        price: s.priceCents ? String(s.priceCents / 100) : '', duration: s.durationLabel, extraHour: false, extraHourPrice: '', travel: false, inclusions: [],
      }));
    }
    if (error || Object.keys(fields).length) return out({ error: error ?? CHECK_FORM, fields });
    try {
      await saveStep(actor, { step: 3, data: flags });
    } catch (e) {
      readOnlyRedirect(e);
      if (!(e instanceof DomainError)) throw e;
      const errs = (e.details?.errors as string[] | undefined) ?? [];
      return out({ error: errs.includes('max_packages') ? `Можете да добавите до ${await getSetting('partner.max_packages')} пакета.` : 'Добавете поне един пакет с фиксирана цена.', fields });
    }
  }
  return out(await proceed(3, intent));
}

/** ‹Премахни› → services.remove() (archived; records are never deleted). Toast ‹Пакетът е премахнат›. */
export async function removeServiceAction(serviceId: string): Promise<{ ok: boolean }> {
  const actor = await wizardActor();
  if (!isUuid(serviceId)) return { ok: false };
  try {
    await remove(actor, { serviceId });
  } catch (e) {
    readOnlyRedirect(e);
    if (e instanceof DomainError) return { ok: false };
    throw e;
  }
  revalidatePath(BASE, 'layout');
  return { ok: true };
}
