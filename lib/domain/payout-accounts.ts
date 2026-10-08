// Payout account (SPEC §4.3 B1–B3, §8.3). The partner submits a Bulgarian IBAN with a bank
// document; payouts pause until the team (view_finance) confirms it. Only the last four
// digits are shown anywhere; the full IBAN is stored encrypted (AES-256-GCM).
//
//   ∅ ─B1─▶ pending_verification ─B2─▶ confirmed (the previous one → superseded)
//                                └─B3─▶ rejected (the previous confirmed account stays, D57)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { partner, payoutAccount, payoutLine } from '@/db/schema';
import { now } from '@/lib/clock';
import { money } from '@/lib/format';
import { assertCan, type AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, lockPartnerOf, mail, mailEach, partnerOf, partnerRecipient, teamRecipients, withTx } from './catalogue-kit';
import { ownMedia } from './media';
import { providerById, refreshChecks } from './partners';

export type PayoutAccount = typeof payoutAccount.$inferSelect;

// ── IBAN ─────────────────────────────────────────────────────────────────

export const normalizeIban = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

/** A Bulgarian IBAN: BGkk BBBB SSSS DD + 8 alphanumerics, ISO 13616 mod-97 = 1. */
export function isValidBgIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^BG\d{2}[A-Z]{4}\d{6}[A-Z0-9]{8}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

function ibanKey(): Buffer {
  const secret = process.env.IBAN_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET
    ?? (process.env.NODE_ENV === 'production' ? null : 'eventat-dev-iban-key');
  if (!secret) throw new Error('IBAN_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) must be set');
  return createHash('sha256').update(`iban:${secret}`).digest();
}

/** iv (12) · tag (16) · ciphertext */
export function encryptIban(iban: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', ibanKey(), iv);
  const body = Buffer.concat([c.update(normalizeIban(iban), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decryptIban(b: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', ibanKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

const sameHolder = (a: string, b: string) => {
  const n = (s: string) => s.toLocaleLowerCase('bg').replace(/[„“"'«»]/g, '').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
};

/** ‹Задържани до събитията›: the partner's amounts not paid out yet (§8.2). */
export async function heldForPartner(q: Queryable, partnerId: string): Promise<number> {
  const [r] = await q.select({ s: sql<string>`coalesce(sum(${payoutLine.amountCents}), 0)` }).from(payoutLine)
    .where(and(eq(payoutLine.partnerId, partnerId), inArray(payoutLine.status, ['awaiting_event', 'ready', 'held', 'released_early', 'in_batch'])));
  return Number(r?.s ?? 0);
}

// ── B1 ───────────────────────────────────────────────────────────────────

/**
 * B1 ‹Запази сметката› after ‹Качи документ›: valid BG IBAN (mod-97), holder = the partner's
 * legal name, bank chosen, document uploaded. Payouts pause (§8.3) — held amounts stay reserved;
 * `vendor-payout-account-submitted`, `team-payout-account`; toast ‹Сметката е изпратена за проверка›.
 */
export async function submitAccount(actor: AnyActor, a: { iban: string; holderName: string; bankName: string; bankBranch?: string | null; proofMediaId: string }, tx?: Tx) {
  const iban = normalizeIban(a.iban ?? '');
  if (!isValidBgIban(iban)) throw new DomainError('invalid_iban');
  if (!a.bankName?.trim()) throw new DomainError('bank_required');
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    if (!p.legalName) throw new DomainError('legal_name_missing');
    if (!sameHolder(a.holderName ?? '', p.legalName)) throw new DomainError('holder_mismatch');
    await ownMedia(t, actor, a.proofMediaId, ['bank_proof']);
    const at = await now();
    // A newer submission replaces one still waiting for the check.
    await t.update(payoutAccount).set({ status: 'superseded' })
      .where(and(eq(payoutAccount.partnerId, p.id), eq(payoutAccount.status, 'pending_verification')));
    const [acc] = await t.insert(payoutAccount).values({
      partnerId: p.id, ibanEncrypted: encryptIban(iban), ibanLast4: iban.slice(-4), holderName: a.holderName.trim(),
      bankName: a.bankName.trim(), bankBranch: a.bankBranch?.trim() || null, proofMediaId: a.proofMediaId, submittedAt: at,
    }).returning();
    await t.update(partner).set({ payoutsPaused: true, updatedAt: at }).where(eq(partner.id, p.id));
    await refreshChecks(t, p.id);
    await audit(t, { actor, action: 'payout_account.submitted', entity: 'payout_account', entityId: acc.id, data: { last4: acc.ibanLast4, bank: acc.bankName } });
    const held = money(await heldForPartner(t, p.id));
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-payout-account-submitted', to: r.email, toUserId: r.userId, dedupeKey: `payoutaccount:${acc.id}:submitted`,
      vars: { partnerLegalName: p.legalName, heldAmount: held },
    });
    const [previous] = await t.select().from(payoutAccount)
      .where(and(eq(payoutAccount.partnerId, p.id), eq(payoutAccount.status, 'confirmed'))).limit(1);
    await mailEach(t, await teamRecipients(t, ['view_finance']), {
      key: 'team-payout-account', dedupeKey: `payoutaccount:${acc.id}:team`,
      vars: {
        partnerName: p.businessName, partnerLegalName: p.legalName, eik: p.eik ?? '',
        // The template has no wording for a first account; it shows a dash then.
        previousIbanLast4: previous?.ibanLast4 ?? '—', previousBank: previous?.bankName ?? '—', heldAmount: held,
      },
    });
    return acc;
  });
}

// ── B2 / B3 ──────────────────────────────────────────────────────────────

async function lockPending(tx: Tx, accountId: string): Promise<PayoutAccount> {
  const [acc] = await tx.select().from(payoutAccount).where(eq(payoutAccount.id, accountId)).for('update');
  if (!acc) throw new NotFoundError('payout_account');
  if (acc.status !== 'pending_verification') throw new DomainError('account_status', `account is ${acc.status}`);
  return acc;
}

/**
 * B2 ‹Провери сметката› → confirm (view_finance): the previous confirmed account → superseded;
 * payouts resume; the `bank_account` check becomes ok; `vendor-payout-account-confirmed`.
 * The provider boundary has no call to set the external account, so the confirmation is recorded here.
 */
export async function confirmAccount(actor: AnyActor, a: { accountId: string }, tx?: Tx) {
  assertCan(actor, 'confirm_payout_account');
  return withTx(tx, async t => {
    const acc = await lockPending(t, a.accountId);
    const at = await now();
    await t.update(payoutAccount).set({ status: 'superseded' })
      .where(and(eq(payoutAccount.partnerId, acc.partnerId), eq(payoutAccount.status, 'confirmed')));
    const [row] = await t.update(payoutAccount).set({ status: 'confirmed', verifiedBy: actor.userId, verifiedAt: at })
      .where(eq(payoutAccount.id, acc.id)).returning();
    const [p] = await t.update(partner).set({ payoutsPaused: false, updatedAt: at }).where(eq(partner.id, acc.partnerId)).returning();
    await refreshChecks(t, acc.partnerId);
    await audit(t, { actor, action: 'payout_account.confirmed', entity: 'payout_account', entityId: acc.id, data: { partnerId: acc.partnerId } });
    const r = await partnerRecipient(t, acc.partnerId);
    await mail(t, {
      key: 'vendor-payout-account-confirmed', to: r.email, toUserId: r.userId, dedupeKey: `payoutaccount:${acc.id}:confirmed`,
      vars: { partnerLegalName: p.legalName ?? acc.holderName, heldAmount: money(await heldForPartner(t, acc.partnerId)) },
    });
    return row;
  });
}

/**
 * B3 reject (control not drawn; new copy, D57): the reason is required; the previous confirmed
 * account stays and payouts resume on it. No email exists for this yet.
 */
export async function rejectAccount(actor: AnyActor, a: { accountId: string; reason: string }, tx?: Tx) {
  assertCan(actor, 'confirm_payout_account');
  const reason = a.reason?.trim();
  if (!reason) throw new DomainError('reason_required');
  return withTx(tx, async t => {
    const acc = await lockPending(t, a.accountId);
    const at = await now();
    const [row] = await t.update(payoutAccount).set({ status: 'rejected', rejectedReason: reason, verifiedBy: actor.userId, verifiedAt: at })
      .where(eq(payoutAccount.id, acc.id)).returning();
    await t.update(partner).set({ payoutsPaused: false, updatedAt: at }).where(eq(partner.id, acc.partnerId));
    await refreshChecks(t, acc.partnerId);
    await audit(t, { actor, action: 'payout_account.rejected', entity: 'payout_account', entityId: acc.id, data: { reason } });
    return row;
  });
}

// ── Read models ──────────────────────────────────────────────────────────

const masked = (a: PayoutAccount) => ({
  id: a.id, ibanMasked: `•••• ${a.ibanLast4}`, ibanLast4: a.ibanLast4, holderName: a.holderName, bankName: a.bankName, bankBranch: a.bankBranch,
  status: a.status, submittedAt: a.submittedAt, verifiedAt: a.verifiedAt, rejectedReason: a.rejectedReason,
});

/** `/partner/smetka`: the confirmed account (masked), the one waiting for the check, the held total. */
export async function overview(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const rows = await q.select().from(payoutAccount).where(eq(payoutAccount.partnerId, p.id)).orderBy(desc(payoutAccount.submittedAt));
  const confirmed = rows.find(r => r.status === 'confirmed');
  const pending = rows.find(r => r.status === 'pending_verification');
  const rejected = rows.find(r => r.status === 'rejected' && (!pending || r.submittedAt > pending.submittedAt));
  return {
    confirmed: confirmed ? masked(confirmed) : null, pending: pending ? masked(pending) : null, lastRejected: rejected ? masked(rejected) : null,
    heldCents: await heldForPartner(q, p.id), payoutsPaused: p.payoutsPaused, provider: p.provider, providerStatus: p.providerStatus,
  };
}

/** Admin ‹Плащания› block [new]: accounts waiting for the check, oldest first. */
export async function pendingAccounts(actor: AnyActor, q: Queryable = db) {
  assertCan(actor, 'confirm_payout_account');
  const rows = await q.select({ acc: payoutAccount, partnerName: partner.businessName, legalName: partner.legalName, eik: partner.eik })
    .from(payoutAccount).innerJoin(partner, eq(partner.id, payoutAccount.partnerId))
    .where(eq(payoutAccount.status, 'pending_verification')).orderBy(asc(payoutAccount.submittedAt));
  return rows.map(r => ({ ...masked(r.acc), partnerId: r.acc.partnerId, partnerName: r.partnerName, legalName: r.legalName, eik: r.eik, proofMediaId: r.acc.proofMediaId }));
}

/** Stripe: the provider's hosted onboarding (KYC) link [new copy]. The simulated provider returns `returnUrl`. */
export async function onboardingLink(actor: AnyActor, a: { returnUrl: string; refreshUrl: string }, q: Queryable = db): Promise<{ url: string }> {
  const p = await partnerOf(actor, q);
  if (!p.provider || !p.providerAccountRef) throw new DomainError('no_provider_account');
  return providerById(p.provider).partnerOnboardingLink(p.providerAccountRef, a.returnUrl, a.refreshUrl);
}
