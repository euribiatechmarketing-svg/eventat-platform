// Payout account (SPEC §4.3 B1–B3, §8.3).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow, advanceTestNow } from '@/lib/clock';
import {
  confirmAccount, decryptIban, encryptIban, heldForPartner, isValidBgIban, onboardingLink, overview, pendingAccounts, rejectAccount, submitAccount,
} from '@/lib/domain/payout-accounts';
import { checksSummary } from '@/lib/domain/partners';
import { createAdmin, createBookingRow, createClient } from '../helpers/factories';
import { NOW, bells, emails, expectLedgerClean, failure, listedPartner, mediaRow, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

const IBAN = 'BG22 STSA 9300 0012 3452 72';
const IBAN2 = 'BG44UNCR70001512345678';

async function partnerWithProof() {
  const pr = await listedPartner({ businessName: 'Студио Мелодия' });
  const proof = await mediaRow(pr.user.id, 'bank_proof', { mime: 'application/pdf' });
  return { ...pr, proof };
}

describe('IBAN', () => {
  it('accepts Bulgarian IBANs with a valid mod-97 check only', () => {
    expect(isValidBgIban(IBAN)).toBe(true);
    expect(isValidBgIban('BG80 BNBG 9661 1020 3456 78')).toBe(true);
    expect(isValidBgIban('BG23 STSA 9300 0012 3452 72')).toBe(false);
    expect(isValidBgIban('DE89370400440532013000')).toBe(false);
    expect(isValidBgIban('BG22STSA930000123452')).toBe(false);
  });
  it('stores the IBAN encrypted', () => {
    const enc = encryptIban(IBAN);
    expect(enc.toString('utf8')).not.toContain('STSA');
    expect(decryptIban(enc)).toBe('BG22STSA93000012345272');
  });
});

describe('B1 submit', () => {
  it('checks the IBAN, the holder (= legal name), the bank and the document', async () => {
    const { actor, proof } = await partnerWithProof();
    const ok = { iban: IBAN, holderName: 'Студио Мелодия ЕООД', bankName: 'Postbank', proofMediaId: proof.id };
    expect(await failure(submitAccount(actor, { ...ok, iban: 'BG23STSA93000012345272' }))).toContain('invalid_iban');
    expect(await failure(submitAccount(actor, { ...ok, holderName: 'Друга фирма ООД' }))).toContain('holder_mismatch');
    expect(await failure(submitAccount(actor, { ...ok, bankName: ' ' }))).toContain('bank_required');
    const notProof = await mediaRow(null, 'gallery');
    expect(await failure(submitAccount(actor, { ...ok, proofMediaId: notProof.id }))).toContain('not_found');
    const { actor: client } = await createClient();
    expect(await failure(submitAccount(client, ok))).toContain('ForbiddenError');
  });

  it('pauses payouts, keeps only the last four digits in clear, emails the partner and view_finance', async () => {
    const accounting = await createAdmin('accounting');
    const moderator = await createAdmin('moderator');
    const pr = await partnerWithProof();
    const { user: client } = await createClient();
    const b = await createBookingRow({ client, partner: pr, eventDate: '2026-06-14' });
    await db.insert(s.payoutLine).values({ bookingId: b.booking.id, partnerId: pr.partner.id, batchDate: '2026-06-15', baseCents: 145_000, commissionCents: 14_500, amountCents: 130_500 });
    expect(await heldForPartner(db, pr.partner.id)).toBe(130_500);
    const acc = await submitAccount(pr.actor, { iban: IBAN, holderName: '  студио мелодия ЕООД ', bankName: 'Postbank', bankBranch: 'София', proofMediaId: pr.proof.id });
    expect(acc).toMatchObject({ status: 'pending_verification', ibanLast4: '5272', bankName: 'Postbank' });
    expect(decryptIban(acc.ibanEncrypted!)).toBe('BG22STSA93000012345272');
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p.payoutsPaused).toBe(true);
    expect(plain((await emails('vendor-payout-account-submitted', pr.user.id))[0].vars)).toEqual({ partnerLegalName: 'Студио Мелодия ЕООД', heldAmount: '1 305,00 €' });
    expect((await bells(pr.user.id))[0].kind).toBe('vendor-payout-account-submitted');
    const team = (await emails('team-payout-account')).filter(e => (e.vars as { partnerName: string }).partnerName === pr.partner.businessName);
    expect(team.map(e => e.toUserId)).toContain(accounting.user.id);
    expect(team.map(e => e.toUserId)).not.toContain(moderator.user.id);
    expect(plain(team[0].vars)).toMatchObject({ partnerLegalName: 'Студио Мелодия ЕООД', previousIbanLast4: '—', heldAmount: '1 305,00 €' });
    const o = await overview(pr.actor);
    expect(o).toMatchObject({ confirmed: null, payoutsPaused: true, heldCents: 130_500 });
    expect(o.pending?.ibanMasked).toBe('•••• 5272');
  });
});

describe('B2 / B3 team check', () => {
  it('confirms (view_finance): the previous account is superseded, payouts resume, the bank check is ok', async () => {
    const pr = await partnerWithProof();
    const { actor: mod } = await createAdmin('moderator');
    const { actor: acc } = await createAdmin('accounting');
    const first = await submitAccount(pr.actor, { iban: IBAN, holderName: 'Студио Мелодия ЕООД', bankName: 'Postbank', proofMediaId: pr.proof.id });
    expect(await failure(confirmAccount(mod, { accountId: first.id }))).toContain('ForbiddenError');
    expect((await pendingAccounts(acc)).some(a => a.id === first.id)).toBe(true);
    await confirmAccount(acc, { accountId: first.id });
    expect((await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id)))[0].payoutsPaused).toBe(false);
    expect((await emails('vendor-payout-account-confirmed', pr.user.id))[0].vars).toMatchObject({ partnerLegalName: 'Студио Мелодия ЕООД' });
    expect(await failure(confirmAccount(acc, { accountId: first.id }))).toContain('account_status');

    advanceTestNow(86_400_000);
    const second = await submitAccount(pr.actor, { iban: IBAN2, holderName: 'Студио Мелодия ЕООД', bankName: 'Обединена банка', proofMediaId: pr.proof.id });
    const team = (await emails('team-payout-account')).filter(e => (e.vars as { partnerName: string }).partnerName === pr.partner.businessName);
    expect(team.at(-1)?.vars).toMatchObject({ previousIbanLast4: '5272', previousBank: 'Postbank' });
    await confirmAccount(acc, { accountId: second.id });
    const rows = await db.select().from(s.payoutAccount).where(eq(s.payoutAccount.partnerId, pr.partner.id));
    expect(Object.fromEntries(rows.map(r => [r.ibanLast4, r.status]))).toEqual({ 5272: 'superseded', 5678: 'confirmed' });
    expect((await overview(pr.actor)).confirmed?.bankName).toBe('Обединена банка');
  });

  it('rejects with a reason: the confirmed account stays and payouts resume (D57)', async () => {
    const pr = await partnerWithProof();
    const { actor: admin } = await createAdmin('admin');
    const first = await submitAccount(pr.actor, { iban: IBAN, holderName: 'Студио Мелодия ЕООД', bankName: 'Postbank', proofMediaId: pr.proof.id });
    await confirmAccount(admin, { accountId: first.id });
    const second = await submitAccount(pr.actor, { iban: IBAN2, holderName: 'Студио Мелодия ЕООД', bankName: 'Обединена банка', proofMediaId: pr.proof.id });
    expect((await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id)))[0].payoutsPaused).toBe(true);
    expect(await failure(rejectAccount(admin, { accountId: second.id, reason: '' }))).toContain('reason_required');
    await rejectAccount(admin, { accountId: second.id, reason: 'Документът е за друга сметка.' });
    const rows = await db.select().from(s.payoutAccount).where(eq(s.payoutAccount.partnerId, pr.partner.id));
    expect(Object.fromEntries(rows.map(r => [r.ibanLast4, r.status]))).toEqual({ 5272: 'confirmed', 5678: 'rejected' });
    expect((await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id)))[0].payoutsPaused).toBe(false);
    expect((await overview(pr.actor)).lastRejected?.rejectedReason).toBe('Документът е за друга сметка.');
  });

  it('a newer submission replaces one still waiting; the bank_account check follows the account', async () => {
    const pr = await partnerWithProof();
    await db.insert(s.partnerCheck).values(['company', 'contacts', 'gallery', 'services', 'cancellation_policy', 'bank_account']
      .map(kind => ({ partnerId: pr.partner.id, kind: kind as 'company' })));
    await submitAccount(pr.actor, { iban: IBAN, holderName: 'Студио Мелодия ЕООД', bankName: 'Postbank', proofMediaId: pr.proof.id });
    let bank = (await checksSummary(db, pr.partner.id)).checks.find(c => c.kind === 'bank_account');
    expect(bank).toMatchObject({ state: 'waiting', detail: 'IBAN подаден, чака потвърждение от банката' });
    const second = await submitAccount(pr.actor, { iban: IBAN2, holderName: 'Студио Мелодия ЕООД', bankName: 'Обединена банка', proofMediaId: pr.proof.id });
    const rows = await db.select().from(s.payoutAccount).where(eq(s.payoutAccount.partnerId, pr.partner.id));
    expect(rows.map(r => r.status).sort()).toEqual(['pending_verification', 'superseded']);
    const { actor: admin } = await createAdmin('admin');
    await confirmAccount(admin, { accountId: second.id });
    bank = (await checksSummary(db, pr.partner.id)).checks.find(c => c.kind === 'bank_account');
    expect(bank?.state).toBe('ok');
  });

  it('gives the provider onboarding link (simulated: back to the page)', async () => {
    const pr = await listedPartner();
    expect(await failure(onboardingLink(pr.actor, { returnUrl: '/partner/smetka', refreshUrl: '/partner/smetka' }))).toContain('no_provider_account');
    await db.update(s.partner).set({ providerAccountRef: `sim_acct_${pr.partner.id.slice(0, 8)}` }).where(eq(s.partner.id, pr.partner.id));
    expect(await onboardingLink(pr.actor, { returnUrl: '/partner/smetka', refreshUrl: '/partner/smetka' })).toEqual({ url: '/partner/smetka' });
  });
});
