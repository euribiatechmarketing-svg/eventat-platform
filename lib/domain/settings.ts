// Platform settings ⚙ (SPEC §2): key → JSON value, versioned by effective_from.
// The value at instant t is the row with the greatest effective_from ≤ t
// (ties: the latest written). A key with no row yet reads its default.
// Records snapshot the values that govern them; later changes never move
// existing records (‹Промяната важи само за нови резервации.›).
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Queryable } from '@/db';
import { platformSettings } from '@/db/schema';
import { invalidateClock, now } from '@/lib/clock';
import { TEMPLATES } from '@/lib/email/templates';
import { assertCan, isSystem, type AnyActor } from './actor';
import { audit } from './audit';

const int = z.number().int();
const bp = int.min(0).max(10_000);
const hours = int.min(1).max(24 * 60);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const intList = (min: number, max: number) => z.array(int.min(min).max(max)).min(1);

/** One row of the cancellation table (SPEC §5.2): from `minDaysBefore` days before the event, keep this much. */
const policyTier = z.object({ minDaysBefore: int.min(0), retained: z.enum(['none', 'deposit', 'total']) });
const policy = z.object({ tiers: z.array(policyTier).min(1) }).refine(
  p => p.tiers.every((t, i) => i === 0 || t.minDaysBefore < p.tiers[i - 1].minDaysBefore) && p.tiers.at(-1)!.minDaysBefore === 0,
  'tiers must be ordered by minDaysBefore (descending) and end at 0',
);

/** The value shape of every setting. */
export const SETTING_SCHEMAS = {
  'commission.standard_bp': bp,
  'commission.intro_bp': bp,
  'commission.intro_count': int.min(0),
  'commission.business_bp': bp,
  'request.response_hours': hours,
  'request.partner_reminder_before_h': hours,
  'brief.offer_window_hours': hours,
  'offer.confirm_hours': hours,
  'payment.window_hours': hours,
  'payment.client_reminders_before_h': intList(1, 24 * 7),
  'payment.partner_reminder_before_h': hours,
  'payment.team_alert_before_h': hours,
  'payment.extension_hours': hours,
  'payment.provider': z.enum(['simulated', 'stripe']),
  'payment.schedule': z.object({
    mode: z.enum(['full', 'deposit_balance']),
    deposit_percent: int.min(1).max(99).nullable(),
    balance_due_days: int.min(14),
  }),
  'payment.provider_max_hold_days': int.min(1).nullable(),
  'payment.bank_transfer_enabled': z.boolean(),
  'payout.days': intList(1, 28),
  'payout.hold_days_after_event': int.min(0),
  'payout.prepare_time': hhmm,
  'payout.require_second_admin': z.boolean(),
  'partner.approval_sla_hours': hours,
  'partner.approval_target_hours': hours,
  'partner.max_packages': int.min(1),
  'partner.gallery_min': int.min(0),
  'partner.gallery_max': int.min(1),
  'partner.name_change_interval_months': int.min(0),
  'dispute.team_reply_hours': hours,
  'dispute.position_hours': hours,
  'reminders.client_event_days': intList(1, 365),
  'reminders.partner_event_days': intList(1, 365),
  'reminders.send_time': hhmm,
  'reviews.invite_days_after': int.min(0),
  'reviews.invite_time': hhmm,
  'reviews.paid_only': z.literal(true),
  'moderation.manual': z.boolean(),
  'digest.time': hhmm,
  'saved_search.scan_time': hhmm,
  'cancellation.policies': z.object({ flexible: policy, moderate: policy, strict: policy }),
  'locale.en_enabled': z.boolean(),
  'uploads.max_photos': int.min(1),
  'uploads.max_mb': int.min(1),
  'support.email': z.email(),
  'sender.email': z.email(),
  'demo.bank_transfer_details': z.object({ recipient: z.string().min(1), iban: z.string().min(1) }),
  'clock_offset_ms': int,
  'sms.transport': z.string().min(1),
  'platform.legal_entity': z.object({
    name: z.string().min(1), eik: z.string().min(1), vat_number: z.string().nullable(), address: z.string().min(1),
  }).nullable(),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;
export type Settings = { [K in SettingKey]: SettingValue<K> };
export type CancellationPolicies = SettingValue<'cancellation.policies'>;
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

/** SPEC §5.2 as data (boundaries inclusive, D9). */
export const DEFAULT_CANCELLATION_POLICIES: CancellationPolicies = {
  flexible: { tiers: [{ minDaysBefore: 7, retained: 'none' }, { minDaysBefore: 1, retained: 'deposit' }, { minDaysBefore: 0, retained: 'total' }] },
  moderate: { tiers: [{ minDaysBefore: 30, retained: 'none' }, { minDaysBefore: 7, retained: 'deposit' }, { minDaysBefore: 0, retained: 'total' }] },
  strict: { tiers: [{ minDaysBefore: 14, retained: 'deposit' }, { minDaysBefore: 0, retained: 'total' }] },
};

/** The defaults of SPEC §2. The payment provider follows the environment (simulated unless PAYMENT_PROVIDER=stripe). */
export function settingDefaults(): Settings {
  const stripe = process.env.PAYMENT_PROVIDER === 'stripe';
  return {
    'commission.standard_bp': 1000,
    'commission.intro_bp': 500,
    'commission.intro_count': 3,
    'commission.business_bp': 1000,
    'request.response_hours': 24,
    'request.partner_reminder_before_h': 6,
    'brief.offer_window_hours': 24,
    'offer.confirm_hours': 24,
    'payment.window_hours': 24,
    'payment.client_reminders_before_h': [6, 2],
    'payment.partner_reminder_before_h': 6,
    'payment.team_alert_before_h': 4,
    'payment.extension_hours': 24,
    'payment.provider': stripe ? 'stripe' : 'simulated',
    'payment.schedule': { mode: 'full', deposit_percent: null, balance_due_days: 30 },
    'payment.provider_max_hold_days': stripe ? 90 : null,
    'payment.bank_transfer_enabled': true,
    'payout.days': [1, 15],
    'payout.hold_days_after_event': 1,
    'payout.prepare_time': '09:00',
    'payout.require_second_admin': false,
    'partner.approval_sla_hours': 48,
    'partner.approval_target_hours': 24,
    'partner.max_packages': 5,
    'partner.gallery_min': 4,
    'partner.gallery_max': 8,
    'partner.name_change_interval_months': 1,
    'dispute.team_reply_hours': 24,
    'dispute.position_hours': 48,
    'reminders.client_event_days': [7, 1],
    'reminders.partner_event_days': [7],
    'reminders.send_time': '09:00',
    'reviews.invite_days_after': 1,
    'reviews.invite_time': '10:00',
    'reviews.paid_only': true,
    'moderation.manual': true,
    'digest.time': '09:00',
    'saved_search.scan_time': '08:00',
    'cancellation.policies': DEFAULT_CANCELLATION_POLICIES,
    'locale.en_enabled': false,
    'uploads.max_photos': 6,
    'uploads.max_mb': 5,
    'support.email': 'help@eventat.bg',
    'sender.email': 'no-reply@eventat.bg',
    'demo.bank_transfer_details': { recipient: 'EventAT', iban: 'BG80 BNBG 9661 1020 3456 78' },
    'clock_offset_ms': 0,
    'sms.transport': 'outbox',
    'platform.legal_entity': null,
  };
}

export class SettingsError extends Error {
  constructor(message: string) { super(message); this.name = 'SettingsError'; }
}

function parse<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const r = SETTING_SCHEMAS[key].safeParse(value);
  if (!r.success) throw new SettingsError(`Invalid value for ${key}: ${r.error.issues.map(i => i.message).join('; ')}`);
  return r.data as SettingValue<K>;
}

/** The value of one setting at instant `at` (default: the platform clock's now). */
export async function getSetting<K extends SettingKey>(key: K, at?: Date, q: Queryable = db): Promise<SettingValue<K>> {
  if (!(key in SETTING_SCHEMAS)) throw new SettingsError(`Unknown setting: ${key}`);
  const t = at ?? (await now());
  const [row] = await q.select({ value: platformSettings.value }).from(platformSettings)
    .where(and(eq(platformSettings.key, key), lte(platformSettings.effectiveFrom, t)))
    .orderBy(desc(platformSettings.effectiveFrom), desc(platformSettings.createdAt))
    .limit(1);
  return row ? parse(key, row.value) : settingDefaults()[key];
}

/** Every setting at instant `at`, defaults filled in. */
export async function getSettings(at?: Date, q: Queryable = db): Promise<Settings> {
  const t = at ?? (await now());
  const rows = await q.execute<{ key: string; value: unknown }>(sql`
    select distinct on (key) key, value from platform_settings
    where effective_from <= ${t.toISOString()}::timestamptz
    order by key, effective_from desc, created_at desc`);
  const out = settingDefaults() as Record<SettingKey, unknown>;
  for (const r of rows) if (r.key in SETTING_SCHEMAS) out[r.key as SettingKey] = parse(r.key as SettingKey, r.value);
  return out as Settings;
}

/** Proposed email keys that deposit mode needs before an admin can switch to it (D5). */
export const DEPOSIT_MODE_TEMPLATES = [
  'client-balance-charged', 'client-balance-failed', 'client-booking-cancelled-unpaid', 'vendor-booking-cancelled-unpaid',
] as const;

/** Rules that span keys (SPEC §2, §7.2). Checked only for the keys that can break them. */
function checkCombination(key: SettingKey, s: Settings) {
  const schedule = s['payment.schedule'];
  const maxHold = s['payment.provider_max_hold_days'];
  if (['payment.schedule', 'payment.provider_max_hold_days', 'payout.hold_days_after_event'].includes(key)
    && maxHold != null && schedule.balance_due_days + s['payout.hold_days_after_event'] + 15 > maxHold) {
    throw new SettingsError('balance_due_days + payout.hold_days_after_event + 15 must not exceed payment.provider_max_hold_days');
  }
  if (key === 'payment.schedule' && schedule.mode === 'deposit_balance') {
    const missing = DEPOSIT_MODE_TEMPLATES.filter(k => !TEMPLATES[k]);
    if (missing.length) throw new SettingsError(`Deposit mode needs the emails ${missing.join(', ')} (D5)`);
  }
  if (key === 'payment.provider' && s['payment.provider'] === 'stripe' && !process.env.STRIPE_SECRET_KEY) {
    throw new SettingsError('payment.provider = stripe needs STRIPE_SECRET_KEY in the environment');
  }
  if (key.startsWith('partner.gallery_') && s['partner.gallery_min'] > s['partner.gallery_max']) {
    throw new SettingsError('partner.gallery_min must not exceed partner.gallery_max');
  }
}

/**
 * Write a new version of a setting, effective from `effectiveFrom` (default: now).
 * Team actors need `manage_team_settings`; SYSTEM (seed, jobs) may always write.
 */
export async function setSetting<K extends SettingKey>(
  key: K, value: SettingValue<K>, actor: AnyActor, effectiveFrom?: Date, q: Queryable = db,
): Promise<void> {
  if (!(key in SETTING_SCHEMAS)) throw new SettingsError(`Unknown setting: ${key}`);
  if (!isSystem(actor)) assertCan(actor, 'manage_team_settings');
  const v = parse(key, value);
  const from = effectiveFrom ?? (await now());
  const merged = { ...(await getSettings(from, q)), [key]: v } as Settings;
  checkCombination(key, merged);
  // JSON null must be stored as the jsonb literal, not SQL NULL.
  const jsonValue = v === null ? sql`'null'::jsonb` : v;
  await q.insert(platformSettings).values({
    key, value: jsonValue, effectiveFrom: from, changedBy: isSystem(actor) ? null : actor.userId,
    // Write order breaks ties between versions with the same effective_from, even inside one transaction.
    createdAt: sql`clock_timestamp()`,
  });
  await audit(q, { actor, action: 'settings.changed', entity: 'platform_settings', entityId: key, data: { value: v, effectiveFrom: from.toISOString() } });
  if (key === 'clock_offset_ms') invalidateClock();
}
