// The demo seed (scripts/seed.ts, DATA-MODEL §3): seeds this file's own
// database and checks the facts the prototype shows, the row counts the
// records of §3 imply, the money invariants (SPEC §7.5), logins and the
// timers (SPEC §3). Runs on its own database (tests/setup/db.ts).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { verifyPassword } from 'better-auth/crypto';
import { db } from '@/db';
import * as s from '@/db/schema';
import { invalidateClock, now, setTestNow } from '@/lib/clock';
import { money, sofiaInstant } from '@/lib/format';
import { accountBalance, bookingBalances, checkLedgerInvariants, partnerBalances } from '@/lib/domain/ledger';
import { SETTING_KEYS } from '@/lib/domain/settings';
import { DEMO_PASSWORD } from '@/scripts/seed/data';
import { JOB_KINDS } from '@/scripts/seed/jobs';
import { SeedRefusedError, at, seedDemo, type SeedResult } from '@/scripts/seed/run';

const NOW = sofiaInstant('2025-08-31', 12, 0);
let seeded: SeedResult;

beforeAll(async () => {
  setTestNow(NOW);
  seeded = await seedDemo();
});
afterAll(() => setTestNow(null));

/** Display strings use no-break spaces (lib/format); compare them as plain text. */
const plain = (t: string | null) => (t ?? '').replace(/\u00a0/g, ' ');
const rows = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;
const bookingByNumber = async (n: string) => {
  const [b] = await db.select().from(s.booking).where(eq(s.booking.number, n));
  if (!b) throw new Error(`no booking ${n}`);
  return b;
};
const partnerBySlug = async (slug: string) => (await db.select().from(s.partner).where(eq(s.partner.slug, slug)))[0];

describe('2026-0614-ЕА (S7)', () => {
  it('is Мария’s confirmed, paid booking with Студио Мелодия: 1 450,00 €, partner receives 1 305,00 €', async () => {
    const b = await bookingByNumber('2026-0614-ЕА');
    const [client] = await db.select().from(s.user).where(eq(s.user.id, b.clientId));
    const p = await partnerBySlug('studio-melodiya');
    expect(client.email).toBe('maria.dimitrova@gmail.com');
    expect(b.partnerId).toBe(p.id);
    expect(b).toMatchObject({
      status: 'confirmed', amountCents: 145_000, commissionBp: 1000, eventDate: '2026-06-14', startTime: '17:00:00', endTime: '02:00:00',
      guests: 120, venueName: 'Вила Екатерина', locality: 'с. Панчарево', serviceTitle: 'Пакет „Цял ден“', serviceSummary: 'DJ, озвучаване и осветление',
      cancellationPolicy: 'moderate', depositPercent: 30, freeCancelUntil: '2026-05-15', holdUntil: '2026-06-15', batchDate: '2026-06-15',
      paymentMode: 'full', dueNowCents: 145_000, balanceCents: 0, contactPhone: '+359884127730', payoutHold: false,
    });
    expect(b.inclusions).toEqual(['DJ за цялото събитие', 'Озвучаване за церемония и парти', 'Диско осветление', 'Безжичен микрофон']);
    expect(b.approvedAt).toEqual(at('2025-08-12 11:06'));
    expect(b.paymentDueAt).toEqual(at('2025-08-13 11:06'));
    expect(b.paidAt).toEqual(at('2025-08-12 14:05'));

    const [line] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, b.id));
    expect(line).toMatchObject({ baseCents: 145_000, commissionCents: 14_500, amountCents: 130_500, status: 'awaiting_event', batchDate: '2026-06-15' });
    expect(plain(money(line.amountCents))).toBe('1 305,00 €');
    expect(plain(money(b.amountCents))).toBe('1 450,00 €');

    const [charge] = await db.select().from(s.charge).where(eq(s.charge.bookingId, b.id));
    expect(charge).toMatchObject({ status: 'succeeded', method: 'card', provider: 'simulated', amountCents: 145_000, applicationFeeCents: 14_500, cardBrand: 'Visa', cardLast4: '4242' });
    const [inv] = await db.select().from(s.invoice).where(eq(s.invoice.chargeId, charge.id));
    expect(inv).toMatchObject({ number: '0000000412', issuerLegalName: 'Студио Мелодия ЕООД', issuerEik: '204512389', recipientName: 'Мария Димитрова', totalCents: 145_000, place: 'София', paymentNote: 'Карта Visa •••• 4242' });
    const [il] = await db.select().from(s.invoiceLine).where(eq(s.invoiceLine.invoiceId, inv.id));
    expect(il.description).toBe('Пакет „Цял ден“ · DJ и озвучаване');
    expect(plain(il.detail)).toBe('14 юни 2026 · Вила Екатерина, с. Панчарево · 120 гости');

    const [req] = await db.select().from(s.request).where(eq(s.request.number, '2026-0614-ЕА'));
    expect(req).toMatchObject({ status: 'approved', kind: 'package', spaceType: 'garden_hall', amountCents: 145_000 });
    expect(req.sentAt).toEqual(at('2025-08-12 09:24'));
    expect(await rows(s.requestAttachment)).toBe(3);
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 145_000, provider_held: 145_000 });
  });

  it('numbers Студио Мелодия’s invoices in payment order, 407 … 414', async () => {
    const p = await partnerBySlug('studio-melodiya');
    const inv = await db.select({ number: s.invoice.number, booking: s.booking.number }).from(s.invoice)
      .innerJoin(s.booking, eq(s.booking.id, s.invoice.bookingId)).where(eq(s.invoice.issuerKey, p.id)).orderBy(asc(s.invoice.number));
    expect(inv.map(i => i.number)).toEqual(['0000000407', '0000000408', '0000000409', '0000000410', '0000000411', '0000000412', '0000000413', '0000000414']);
    expect(inv.find(i => i.number === '0000000413')!.booking).toBe('2026-0630-АБ');
    const [seq] = await db.select().from(s.invoiceSequence).where(eq(s.invoiceSequence.issuerKey, p.id));
    expect(seq.lastNumber).toBe(414);
  });
});

describe('row counts (DATA-MODEL §3 records, plus the assumed rows listed in scripts/seed/README.md)', () => {
  // 11 clients (S4) + 15 partner owners (S5: 11 approved + 4 pending) + 4 team members (S3).
  const EXPECTED: [string, PgTable, number][] = [
    ['user', s.user, 30], ['account', s.account, 30], ['session (S4 Мария)', s.session, 2],
    ['client_profile', s.clientProfile, 11], ['client_invoice_profile', s.clientInvoiceProfile, 1], ['search_history', s.searchHistory, 3],
    ['team_member', s.teamMember, 4], ['team_invite', s.teamInvite, 2],
    ['partner', s.partner, 15], ['partner_member', s.partnerMember, 15], ['partner_check (6 each)', s.partnerCheck, 90],
    ['partner_decision (approved)', s.partnerDecision, 11], ['partner_photo', s.partnerPhoto, 25], ['partner_tag', s.partnerTag, 6],
    ['payout_account', s.payoutAccount, 14], ['availability_block', s.availabilityBlock, 8],
    // S6: 24 listed + one package each for Балон Градина, DJ Живко, Тортите на Мими (a).
    ['service', s.service, 27], ['service_revision (3 new + 1 edit)', s.serviceRevision, 4], ['service_inclusion', s.serviceInclusion, 4],
    ['client_event (S4)', s.clientEvent, 15],
    // S7: 7 requests without a booking + 21 bookings.
    ['request', s.request, 28], ['booking_number', s.bookingNumber, 28], ['booking', s.booking, 21], ['offer (2 quote bookings)', s.offer, 2],
    ['charge (18 paid bookings, 2025-0426-ФТ twice)', s.charge, 19], ['refund', s.refund, 2], ['cancellation', s.cancellation, 1],
    ['invoice (19 + 2 credit notes)', s.invoice, 21], ['invoice_line', s.invoiceLine, 21],
    ['dispute (S9)', s.dispute, 7], ['dispute_option', s.disputeOption, 11], ['dispute_message', s.disputeMessage, 11], ['dispute_attachment', s.disputeAttachment, 8],
    ['payout_batch (S8: 3 paid + 1 scheduled)', s.payoutBatch, 4], ['payout_item', s.payoutItem, 6], ['payout_line (one per paid booking)', s.payoutLine, 18],
    ['review (S11)', s.review, 3], ['conversation (S10)', s.conversation, 8], ['message', s.message, 21],
    ['saved_search (S12)', s.savedSearch, 3], ['date_watch', s.dateWatch, 2], ['notification (bell)', s.notification, 6],
    ['admin_note (S13)', s.adminNote, 4], ['metrics_snapshot', s.metricsSnapshot, 2],
    // L1 × 19, L3 × 7, L2 × 2, L4 × 6.
    ['ledger_transaction', s.ledgerTransaction, 34],
    ['city', s.city, 4], ['event_type', s.eventType, 5], ['platform_settings', s.platformSettings, SETTING_KEYS.length],
  ];
  it.each(EXPECTED)('%s', async (_name, table, n) => {
    expect(await rows(table)).toBe(n);
  });

  it('S5: 11 approved partners listed, 4 applications waiting', async () => {
    const byStatus = await db.select({ status: s.partner.status, n: count() }).from(s.partner).groupBy(s.partner.status);
    expect(Object.fromEntries(byStatus.map(r => [r.status, r.n]))).toEqual({ approved: 11, submitted: 4 });
    const checks = await db.select({ slug: s.partner.slug, ok: sql<number>`count(*) filter (where ${s.partnerCheck.state} = 'ok')::int` })
      .from(s.partnerCheck).innerJoin(s.partner, eq(s.partner.id, s.partnerCheck.partnerId))
      .where(eq(s.partner.status, 'submitted')).groupBy(s.partner.slug);
    expect(Object.fromEntries(checks.map(c => [c.slug, c.ok]))).toEqual({ 'lunna-fotografiya': 5, 'balon-gradina': 6, 'dj-zhivko': 4, 'tortite-na-mimi': 6 });
  });

  it('S13: the moderation queue has 3 new services and 1 edit', async () => {
    const q = await db.select({ type: s.serviceRevision.type, n: count() }).from(s.serviceRevision)
      .where(eq(s.serviceRevision.status, 'pending')).groupBy(s.serviceRevision.type);
    expect(Object.fromEntries(q.map(r => [r.type, r.n]))).toEqual({ new: 3, edit: 1 });
  });

  it('S7: booking states as the prototype shows them', async () => {
    const st = await db.select({ status: s.booking.status, n: count() }).from(s.booking).groupBy(s.booking.status);
    expect(Object.fromEntries(st.map(r => [r.status, r.n]))).toEqual({ confirmed: 11, awaiting_payment: 3, completed: 6, cancelled: 1 });
    const reqs = await db.select({ status: s.request.status, n: count() }).from(s.request).groupBy(s.request.status);
    expect(Object.fromEntries(reqs.map(r => [r.status, r.n]))).toEqual({ approved: 21, pending: 5, declined: 2 });
  });
});

describe('money (SPEC §7.5 invariants, S8 payouts)', () => {
  it('every ledger invariant holds and the provider holds exactly the unreleased client funds', async () => {
    expect(await checkLedgerInvariants(db)).toEqual([]);
    const held = await accountBalance(db, 'provider_held');
    const clientFunds = await accountBalance(db, 'client_funds');
    expect(held).toBe(clientFunds);
    // The 11 confirmed, paid bookings are still held; everything earlier has been released and paid out.
    const confirmed = await db.select({ amount: s.booking.amountCents }).from(s.booking).where(eq(s.booking.status, 'confirmed'));
    expect(held).toBe(confirmed.reduce((a, b) => a + b.amount, 0));
    expect(await accountBalance(db, 'partner_payable')).toBe(0);
    expect(await accountBalance(db, 'partner_receivable')).toBe(0);
    // Commission kept = 10 % of what partners kept on released bookings.
    const lines = await db.select().from(s.payoutLine).where(eq(s.payoutLine.status, 'paid'));
    const commission = lines.reduce((a, l) => a + l.commissionCents, 0);
    expect(await accountBalance(db, 'commission_revenue')).toBe(commission);
    expect(await accountBalance(db, 'platform_cash')).toBe(commission);
  });

  it('S8: three paid batches with the prototype’s items, and the 1 September batch scheduled empty', async () => {
    const batches = await db.select().from(s.payoutBatch).orderBy(asc(s.payoutBatch.batchDate));
    expect(batches.map(b => [b.batchDate, b.label, b.status, b.netCents])).toEqual([
      ['2025-05-01', 'Партида април · втора половина', 'paid', 171_000 + 171_000 + 34_200],
      ['2025-05-15', 'Партида май · първа половина', 'paid', 130_500],
      ['2025-06-01', 'Партида май · втора половина', 'paid', 188_100 + 80_640],
      ['2025-09-01', 'Партида август · втора половина', 'scheduled', 0],
    ]);
    const items = await db.select({ date: s.payoutBatch.batchDate, slug: s.partner.slug, amount: s.payoutItem.amountCents, status: s.payoutItem.status })
      .from(s.payoutItem).innerJoin(s.payoutBatch, eq(s.payoutBatch.id, s.payoutItem.batchId)).innerJoin(s.partner, eq(s.partner.id, s.payoutItem.partnerId));
    const key = (d: string, slug: string) => items.find(i => i.date === d && i.slug === slug)?.amount;
    expect(key('2025-05-01', 'studio-melodiya')).toBe(171_000);
    expect(key('2025-05-01', 'ana-petrova-photography')).toBe(171_000);
    expect(key('2025-05-01', 'sladkarnitsa-med-i-mlyako')).toBe(34_200);
    expect(key('2025-05-15', 'studio-melodiya')).toBe(130_500);
    expect(key('2025-06-01', 'studio-melodiya')).toBe(188_100);
    expect(key('2025-06-01', 'vkusna-istoriya')).toBe(80_640);
    expect(items.every(i => i.status === 'paid')).toBe(true);
    for (const slug of ['studio-melodiya', 'vkusna-istoriya', 'ana-petrova-photography', 'sladkarnitsa-med-i-mlyako']) {
      expect((await partnerBalances(db, (await partnerBySlug(slug)).id)).partner_payable).toBe(0);
    }
  });

  it('2025-0517-РД: 384 € refunded after release; the partner keeps 896 € and receives 806,40 €', async () => {
    const b = await bookingByNumber('2025-0517-РД');
    const [r] = await db.select().from(s.refund).where(eq(s.refund.bookingId, b.id));
    expect(r).toMatchObject({ amountCents: 38_400, reason: 'dispute_decision', status: 'succeeded', applicationFeeRefundCents: 3_840 });
    const [c] = await db.select().from(s.charge).where(eq(s.charge.bookingId, b.id));
    expect(c).toMatchObject({ status: 'partially_refunded', refundedCents: 38_400 });
    const [line] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, b.id));
    expect(line).toMatchObject({ baseCents: 89_600, commissionCents: 8_960, amountCents: 80_640, status: 'paid' });
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0, partner_payable: 0 });
    const notes = await db.select().from(s.invoice).where(and(eq(s.invoice.bookingId, b.id), eq(s.invoice.type, 'credit_note')));
    expect(notes).toHaveLength(1);
    expect(notes[0].totalCents).toBe(38_400);
  });

  it('2025-0426-ФТ: the duplicate charge is refunded in full and the booking stays paid once', async () => {
    const b = await bookingByNumber('2025-0426-ФТ');
    const charges = await db.select().from(s.charge).where(eq(s.charge.bookingId, b.id)).orderBy(asc(s.charge.succeededAt));
    expect(charges.map(c => [c.isDuplicate, c.status, c.refundedCents])).toEqual([[false, 'succeeded', 0], [true, 'refunded', 190_000]]);
    expect(charges[1].succeededAt!.getTime() - charges[0].succeededAt!.getTime()).toBeLessThan(60_000);
    const [line] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, b.id));
    expect(line.amountCents).toBe(171_000);
  });

  it('2025-0509-СВ: cancelled 4 days before; 1 450,00 € retained, 1 305,00 € to the partner (§5)', async () => {
    const b = await bookingByNumber('2025-0509-СВ');
    expect(b).toMatchObject({ status: 'cancelled', cancelledBy: 'client' });
    const [c] = await db.select().from(s.cancellation).where(eq(s.cancellation.bookingId, b.id));
    expect(c).toMatchObject({ daysBefore: 4, policy: 'moderate', retainedCents: 145_000, refundCents: 0, partnerAmountCents: 130_500 });
    expect(await rows(s.refund)).toBe(2);
  });
});

describe('S9 disputes', () => {
  it('opens the four live cases and closes the three decided ones as in admin/dispute.html', async () => {
    const ds = await db.select({ number: s.dispute.number, status: s.dispute.status, urgent: s.dispute.urgent, holds: s.dispute.holdsPayout,
      decision: s.dispute.decisionKind }).from(s.dispute).orderBy(asc(s.dispute.number));
    expect(ds).toEqual([
      { number: '2025-0426-ФТ', status: 'resolved', urgent: false, holds: true, decision: 'refund_duplicate' },
      { number: '2025-0509-СВ', status: 'resolved', urgent: false, holds: true, decision: 'no_refund' },
      { number: '2025-0517-РД', status: 'resolved', urgent: false, holds: true, decision: 'partial_refund' },
      { number: '2026-0607-СВ', status: 'awaiting_decision', urgent: true, holds: true, decision: null },
      { number: '2026-0614-ФК', status: 'collecting', urgent: false, holds: true, decision: null },
      { number: '2026-0621-ТЛ', status: 'collecting', urgent: false, holds: true, decision: null },
      { number: '2026-0630-АБ', status: 'collecting', urgent: false, holds: false, decision: null },
    ]);
    const [fk] = await db.select().from(s.dispute).where(eq(s.dispute.number, '2026-0614-ФК'));
    expect(fk.positionDueAt).toEqual(at('2025-08-31 12:10'));
    const opts = await db.select().from(s.disputeOption).where(eq(s.disputeOption.disputeId, fk.id)).orderBy(asc(s.disputeOption.position));
    expect(opts.map(o => [o.kind, o.label, o.refundCents])).toEqual([
      ['enforce_terms', 'Задължи Snap360 да осигури 4 часа', null],
      ['partial_refund', 'Върни разликата — 140 €', 14_000],
      ['cancel_full_refund', 'Анулирай с пълно възстановяване', 56_000],
    ]);
    const held = await db.select({ number: s.booking.number }).from(s.payoutLine).innerJoin(s.booking, eq(s.booking.id, s.payoutLine.bookingId))
      .where(eq(s.payoutLine.status, 'held'));
    expect(held.map(h => h.number).sort()).toEqual(['2026-0607-СВ', '2026-0614-ФК']);
  });
});

describe('S4/S10–S12 Мария', () => {
  it('has her messages, unread counts, draft, saved searches, watches and bell', async () => {
    const [maria] = await db.select().from(s.user).where(eq(s.user.email, 'maria.dimitrova@gmail.com'));
    const convs = await db.select().from(s.conversation).where(eq(s.conversation.clientId, maria.id));
    expect(convs).toHaveLength(6);
    expect(convs.reduce((a, c) => a + c.clientUnreadCount, 0)).toBe(3);
    expect(convs.find(c => c.clientDraft)?.clientDraft).toBe('Благодаря! Ще изпратя списъка с песните в петък.');
    const latest = convs.sort((a, b) => b.lastMessageAt!.getTime() - a.lastMessageAt!.getTime())[0];
    expect(latest.lastMessageAt).toEqual(at('2025-08-31 11:42'));
    expect(await db.select().from(s.savedSearch).where(eq(s.savedSearch.clientId, maria.id))).toHaveLength(3);
    expect(await db.select().from(s.dateWatch).where(and(eq(s.dateWatch.clientId, maria.id), eq(s.dateWatch.status, 'watching')))).toHaveLength(2);
    const bell = await db.select().from(s.notification).where(eq(s.notification.userId, maria.id));
    expect(bell.filter(n => !n.readAt).map(n => n.title).sort()).toEqual(['Вкусна История ви писа', 'Флора Студио одобри заявката ви']);
    expect(maria.lastLoginAt).toEqual(at('2025-08-31 08:50'));
    expect(maria.createdAt).toEqual(at('2025-03-12 10:00'));
  });

  it('S11: Студио Мелодия’s cached rating comes from its three reviews', async () => {
    const p = await partnerBySlug('studio-melodiya');
    expect(p.reviewCount).toBe(3);
    expect(p.ratingAvg).toBe(4.7);
    expect(p.minPriceCents).toBe(64_000);
    expect((await partnerBySlug('vkusna-istoriya')).reviewCount).toBe(0);
  });
});

describe('users', () => {
  it('every user is found by email and signs in with the demo password', async () => {
    expect(seeded.users).toHaveLength(30);
    const all = await db.select({ id: s.user.id, email: s.user.email, verified: s.user.emailVerified }).from(s.user);
    expect(new Set(all.map(u => u.email))).toEqual(new Set(seeded.users.map(u => u.email)));
    for (const u of seeded.users) {
      const [row] = await db.select({ id: s.user.id, verified: s.user.emailVerified }).from(s.user).where(eq(s.user.email, u.email));
      expect(row, u.email).toBeDefined();
      expect(row.verified).toBe(true);
      const [acc] = await db.select().from(s.account).where(and(eq(s.account.userId, row.id), eq(s.account.providerId, 'credential')));
      expect(acc.accountId).toBe(row.id);
      expect(await verifyPassword({ hash: acc.password!, password: DEMO_PASSWORD })).toBe(true);
    }
  });

  it('gives the three demo logins their roles: client, partner owner, admin team member', async () => {
    const [maria] = await db.select().from(s.user).where(eq(s.user.email, 'maria.dimitrova@gmail.com'));
    expect(maria).toMatchObject({ role: 'client', name: 'Мария Димитрова', phone: '+359884127730' });
    const [martin] = await db.select().from(s.user).where(eq(s.user.email, 'studio.melodia@gmail.com'));
    expect(martin).toMatchObject({ role: 'partner', name: 'Мартин Стоянов' });
    const [member] = await db.select().from(s.partnerMember).where(eq(s.partnerMember.userId, martin.id));
    expect(member.partnerId).toBe((await partnerBySlug('studio-melodiya')).id);
    const [monika] = await db.select().from(s.user).where(eq(s.user.email, 'monika.kovacheva@eventat.bg'));
    const [tm] = await db.select().from(s.teamMember).where(eq(s.teamMember.userId, monika.id));
    expect(tm).toMatchObject({ role: 'admin', isOwner: true, status: 'active' });
  });
});

describe('S1 clock and settings', () => {
  it('stores the offset that puts now() at Sunday 31 August 2025, 12:00 Sofia, and the demo payment settings', async () => {
    const [off] = await db.select().from(s.platformSettings).where(eq(s.platformSettings.key, 'clock_offset_ms'));
    expect(off.value).toBe(seeded.clockOffsetMs);
    expect(Math.abs(Date.now() + seeded.clockOffsetMs - NOW.getTime())).toBeLessThan(60_000);
    expect(off.effectiveFrom).toEqual(sofiaInstant('2025-07-01', 0, 0));
    const [provider] = await db.select().from(s.platformSettings).where(eq(s.platformSettings.key, 'payment.provider'));
    expect(provider.value).toBe('simulated');
  });
});

describe('SPEC §3 timers', () => {
  it('schedules the jobs the seeded states imply, with no reminder in the past', async () => {
    const jobs = await db.select().from(s.job).where(eq(s.job.status, 'pending'));
    expect(jobs).toHaveLength(seeded.jobs.length);
    const byKind = (k: string) => jobs.filter(j => j.kind === k);
    expect(byKind(JOB_KINDS.requestExpire)).toHaveLength(5);         // 5 pending requests
    expect(byKind(JOB_KINDS.paymentExpire)).toHaveLength(3);         // 3 awaiting payment
    expect(byKind(JOB_KINDS.teamPaymentAlert)).toHaveLength(3);      // one per payment deadline; the handler checks for a dispute
    expect(byKind(JOB_KINDS.bookingComplete)).toHaveLength(11);      // 11 confirmed bookings
    expect(byKind(JOB_KINDS.partnerEventReminder)).toHaveLength(11);
    expect(byKind(JOB_KINDS.clientEventReminder)).toHaveLength(14);  // 7 events × (7 days, 1 day)
    expect(byKind(JOB_KINDS.disputePosition)).toHaveLength(3);       // 3 cases collecting
    expect(byKind(JOB_KINDS.dateWatchExpire)).toHaveLength(2);
    expect(byKind(JOB_KINDS.teamInviteExpire)).toHaveLength(2);
    const [prep] = byKind(JOB_KINDS.payoutsPrepare);
    expect(prep).toMatchObject({ dedupeKey: 'batch:2025-09-01', payload: { batchDate: '2025-09-01' } });
    expect(prep.runAt).toEqual(at('2025-08-31 09:00'));

    const reminders = new Set<string>([JOB_KINDS.requestReminder, JOB_KINDS.clientPayReminder, JOB_KINDS.partnerPayReminder,
      JOB_KINDS.teamPaymentAlert, JOB_KINDS.clientEventReminder, JOB_KINDS.partnerEventReminder, JOB_KINDS.reviewInvite]);
    expect(jobs.filter(j => reminders.has(j.kind) && j.runAt <= NOW)).toEqual([]);
    // Технолинк's quote (sent 30 Aug 14:00) and Флора's 2026-0614-ДК (30 Aug 18:00) are past their 6-hour reminder; both still expire.
    expect(byKind(JOB_KINDS.requestReminder)).toHaveLength(3);
    const [scan] = byKind(JOB_KINDS.savedSearchScan);
    expect(scan).toMatchObject({ dedupeKey: 'savedsearch:2025-09-01', payload: { date: '2025-09-01' } });
    expect(scan.runAt).toEqual(at('2025-09-01 08:00'));

    const ea = await bookingByNumber('2026-0614-ЕА');
    const eaJobs = jobs.filter(j => j.dedupeKey?.startsWith(`booking:${ea.id}:`)).map(j => [j.kind, j.runAt.toISOString()]);
    expect(eaJobs.sort()).toEqual([
      [JOB_KINDS.bookingComplete, sofiaInstant('2026-06-15', 0, 0).toISOString()],
      [JOB_KINDS.reviewInvite, sofiaInstant('2026-06-15', 10, 0).toISOString()],
      [JOB_KINDS.partnerEventReminder, sofiaInstant('2026-06-07', 9, 0).toISOString()],
    ].sort());

    // Payload and key shapes the handlers read (lifecycle jobKey: `hours`, `days`, `:vremind:<d>`).
    expect(jobs.find(j => j.dedupeKey === `booking:${ea.id}:vremind:7`)?.payload).toEqual({ bookingId: ea.id, days: 7 });
    expect(jobs.find(j => j.dedupeKey === `event:${ea.clientEventId}:remind:1`)?.payload).toEqual({ clientEventId: ea.clientEventId, days: 1 });

    const tl = await bookingByNumber('2026-0621-ТЛ');
    expect(jobs.find(j => j.dedupeKey === `booking:${tl.id}:payrem:2`)?.payload).toEqual({ bookingId: tl.id, hours: 2 });
    const [expire] = jobs.filter(j => j.dedupeKey === `booking:${tl.id}:payexpire`);
    expect(expire.runAt).toEqual(at('2025-08-31 18:20'));
  });
});

describe('photos', () => {
  it('every photo row points at a file in public/photos with its real size', async () => {
    const photos = await db.select().from(s.media).where(sql`${s.media.storageKey} like '/photos/%'`);
    expect(photos.length).toBeGreaterThan(60);
    for (const m of photos) {
      expect(existsSync(fileURLToPath(new URL(`../public${m.storageKey}`, import.meta.url))), m.storageKey).toBe(true);
      expect(m.sizeBytes).toBeGreaterThan(0);
      expect(m.width).toBeGreaterThan(0);
    }
    const sm = await partnerBySlug('studio-melodiya');
    const gallery = await db.select({ key: s.media.storageKey }).from(s.partnerPhoto).innerJoin(s.media, eq(s.media.id, s.partnerPhoto.mediaId))
      .where(eq(s.partnerPhoto.partnerId, sm.id)).orderBy(asc(s.partnerPhoto.position));
    expect(gallery.map(g => g.key)).toEqual(['/photos/v1-dj-mod.jpg', '/photos/v1-dj-perf.jpg', '/photos/v1-dj-doc.jpg', '/photos/dancers.jpg', '/photos/booth.jpg']);
    const [avatar] = await db.select().from(s.media).where(eq(s.media.id, sm.avatarMediaId!));
    expect(avatar.storageKey).toBe('/photos/v1-dj-doc.jpg');
  });
});

describe('re-running', () => {
  it('refuses a database that has users, and reseeds the same records with force', async () => {
    await expect(seedDemo()).rejects.toBeInstanceOf(SeedRefusedError);
    const before = { users: await rows(s.user), bookings: await rows(s.booking), ledger: await rows(s.ledgerEntry), jobs: await rows(s.job) };
    const again = await seedDemo({ force: true });
    expect({ users: await rows(s.user), bookings: await rows(s.booking), ledger: await rows(s.ledgerEntry), jobs: await rows(s.job) }).toEqual(before);
    // Generated numbers are deterministic, so the demo's URLs survive a reseed.
    expect(again.numbers).toEqual(seeded.numbers);
    expect(await checkLedgerInvariants(db)).toEqual([]);
    const nums = await db.select({ n: s.booking.number }).from(s.booking).where(inArray(s.booking.number, ['2026-0614-ЕА', '2025-0424-СЛ']));
    expect(nums).toHaveLength(2);
    seeded = again;
  });

  it('reseeds with the real demo clock on, and now() then reads 31 August 2025, 12:00', async () => {
    // With ALLOW_TIME_TRAVEL the clock reads clock_offset_ms from the database on its own connection,
    // which a TRUNCATE inside the seed's transaction would block.
    const saved = process.env.ALLOW_TIME_TRAVEL;
    process.env.ALLOW_TIME_TRAVEL = 'true';
    setTestNow(null);
    invalidateClock();
    try {
      seeded = await seedDemo({ force: true });
      expect(Math.abs((await now()).getTime() - NOW.getTime())).toBeLessThan(60_000);
    } finally {
      if (saved === undefined) delete process.env.ALLOW_TIME_TRAVEL; else process.env.ALLOW_TIME_TRAVEL = saved;
      setTestNow(NOW);
      invalidateClock();
    }
  }, 20_000);

  it('refuses a non-local database', async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://eventat:x@db.example.com:5432/eventat';
    try {
      await expect(seedDemo({ force: true })).rejects.toThrow(/non-local/);
    } finally {
      process.env.DATABASE_URL = saved;
    }
    expect(await rows(s.user)).toBe(30);
  });
});
