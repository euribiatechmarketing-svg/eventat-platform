'use server';
// Step 1 ‹Бизнес информация› (SPEC §12.1): partners.saveDraft() always, partners.saveStep(1) on ‹Продължи към профила›.
import { z } from 'zod';
import { isValidEik, saveDraft, saveStep } from '@/lib/domain/partners';
import { DomainError, normalizePhone } from '@/lib/domain/catalogue-kit';
import { CHECK_FORM, REQUIRED, issueFields, opt, proceed, readIntent, readOnlyRedirect, text, wizardActor, type StepState } from '../flow';

const LEGAL = ['freelancer', 'sole_trader', 'eood', 'ood', 'other'] as const;
const EXPERIENCE = ['lt_1', 'y1_3', 'y3_5', 'y5_10', 'gt_10'] as const;
const pick = <T extends string>(list: readonly T[], v: string): T | undefined => list.find(x => x === v);

function read(fd: FormData) {
  const radius = text(fd, 'radius');
  const eik = text(fd, 'eik').replace(/\s/g, '');
  return {
    businessName: opt(text(fd, 'businessName')),
    legalForm: pick(LEGAL, text(fd, 'legalForm')),
    legalFormOther: text(fd, 'legalFormOther'),
    eik,
    primaryCategoryId: z.uuid().safeParse(text(fd, 'primaryCategoryId')).success ? text(fd, 'primaryCategoryId') : undefined,
    cityId: z.uuid().safeParse(text(fd, 'cityId')).success ? text(fd, 'cityId') : undefined,
    radius: radius === 'nationwide' ? 'nationwide' as const : ([50, 100, 150] as const).find(r => String(r) === radius),
    experienceBand: pick(EXPERIENCE, text(fd, 'experienceBand')),
    languages: text(fd, 'languages').split(/[,;]/).map(s => s.trim()).filter(Boolean),
    contactName: opt(text(fd, 'contactName')),
    notificationEmail: opt(text(fd, 'notificationEmail')),
    phone: opt(text(fd, 'phone')),
    socialHandle: opt(text(fd, 'socialHandle')),
    websiteUrl: text(fd, 'websiteUrl'),
  };
}

function check(d: ReturnType<typeof read>): Record<string, string> {
  const f: Record<string, string> = {};
  for (const k of ['businessName', 'legalForm', 'primaryCategoryId', 'cityId', 'radius', 'experienceBand', 'contactName', 'notificationEmail', 'phone', 'socialHandle'] as const) {
    if (!d[k]) f[k] = REQUIRED;
  }
  if (d.legalForm === 'other' && !d.legalFormOther) f.legalForm = REQUIRED;
  if (!d.eik) f.eik = REQUIRED;
  else if (!isValidEik(d.eik, d.legalForm)) f.eik = 'Проверете ЕИК / Булстат.';
  if (!d.languages.length) f.languages = REQUIRED;
  if (d.notificationEmail && !z.email().safeParse(d.notificationEmail).success) f.notificationEmail = 'Проверете имейла.';
  if (d.phone && !normalizePhone(d.phone)) f.phone = 'Проверете телефона.';
  return f;
}

export async function businessAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const actor = await wizardActor();
  const intent = readIntent(fd);
  const d = read(fd);
  const draft: Record<string, unknown> = Object.fromEntries(Object.entries({
    ...d, eik: d.eik.length <= 13 ? d.eik : undefined, languages: d.languages.length ? d.languages : undefined,
  }).filter(([, v]) => v !== undefined));
  try {
    await saveDraft(actor, { step: 1, data: draft });
  } catch (e) {
    readOnlyRedirect(e);
    if (!(e instanceof DomainError)) throw e;
  }
  if (intent === 'next') {
    const fields = check(d);
    if (Object.keys(fields).length) return { error: CHECK_FORM, fields, saved: true, at: Date.now() };
    try {
      await saveStep(actor, { step: 1, data: { ...d, legalFormOther: d.legalFormOther || null, websiteUrl: d.websiteUrl || null } });
    } catch (e) {
      readOnlyRedirect(e);
      if (!(e instanceof DomainError)) throw e;
      const fields = e.code === 'invalid_eik' ? { eik: 'Проверете ЕИК / Булстат.' } : e.code === 'invalid_phone' ? { phone: 'Проверете телефона.' } : issueFields(e);
      return { error: CHECK_FORM, fields, saved: true, at: Date.now() };
    }
  }
  return proceed(1, intent);
}
