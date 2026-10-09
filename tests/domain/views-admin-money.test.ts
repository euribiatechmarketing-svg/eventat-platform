// Read models of the admin money screens (lib/domain/views-admin-money.ts) on the demo seed:
// the bookings register, the case queue and case page, payouts, the email catalogue.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { actorFromUser, type Actor } from '@/lib/domain/actor';
import {
  attentionRows, bookingRecord, bookingsRegister, disputeCase, disputeQueue, emailCatalogue, emailPreview, payoutsOverview,
  refusalText, releaseNextBatch, requestReport, tie,
} from '@/lib/domain/views-admin-money';
import { AftercareError } from '@/lib/domain/aftercare-shared';
import { seedDemo } from '@/scripts/seed/run';

const NOW = sofiaInstant('2025-08-31', 12, 0);
let admin: Actor, support: Actor;
const plain = (t: string | null | undefined) => (t ?? '').replace(/ /g, ' ');

async function actor(email: string): Promise<Actor> {
  const [u] = await db.select().from(s.user).where(eq(s.user.email, email));
  return actorFromUser({ id: u.id, role: u.role });
}

beforeAll(async () => {
  setTestNow(NOW);
  await seedDemo();
  admin = await actor('monika.kovacheva@eventat.bg');
  support = await actor('daniela.valcheva@eventat.bg');
});
afterAll(() => setTestNow(null));

describe('bookings register', () => {
  it('June 2026: rows by event date, tab counts, turnover and commission', async () => {
    const r = await bookingsRegister(admin, { month: '2026-06' });
    expect(r.total).toBe(8);
    expect(r.counts['chakat-plashtane']).toBe(1);
    expect(r.counts.namesa).toBe(4);
    expect(r.rows.map(x => x.number)).toContain('2026-0614-ЕА');
    const ea = r.rows.find(x => x.number === '2026-0614-ЕА')!;
    expect(ea.commissionCents).toBe(14500);
    expect(r.commissionCents).not.toBeNull();
  });
  it('defaults to this month, or the next month with events', async () => {
    const r = await bookingsRegister(admin, {});
    expect(r.month).toBe('2026-05');
  });
  it('hides the commission without view_finance', async () => {
    const r = await bookingsRegister(support, { month: '2026-06' });
    expect(r.commissionCents).toBeNull();
    expect(r.rows.every(x => x.commissionCents === null)).toBe(true);
  });
  it('attention: open disputes (and deadlines within 4 hours)', async () => {
    const a = await attentionRows(admin);
    expect(a.map(x => x.number).sort()).toEqual(['2026-0607-СВ', '2026-0614-ФК', '2026-0621-ТЛ', '2026-0630-АБ']);
    expect(a.every(x => x.problem === 'dispute')).toBe(true);
  });
});

describe('booking record', () => {
  it('2026-0614-ЕА: parties, the 10% split, the history', async () => {
    const r = (await bookingRecord(admin, '2026-0614-ЕА'))!;
    expect(r.client.phone).toBe('+359 88 412 7730');
    expect(r.money.commission).toMatchObject({ pct: '10%', cents: 14500, partnerCents: 130500 });
    expect(r.timeline.map(t => t.title)).toEqual(['Клиентът изпрати заявка', 'Студио Мелодия одобри заявката', 'Плащането постъпи в платформата', 'Предстоящо събитие']);
    expect(r.can.cancel && r.can.openDispute).toBe(true);
    expect(await bookingRecord(admin, '2099-0101-ЯЯ')).toBeNull();
  });
});

describe('disputes', () => {
  it('queue: open first (urgent on top), decided after, head figures, the most urgent case', async () => {
    const q = await disputeQueue(admin, {});
    expect(q.open.map(x => x.number)[0]).toBe('2026-0607-СВ');
    expect(q.open).toHaveLength(4);
    expect(q.done).toHaveLength(3);
    expect(q.openCount).toBe(4);
    expect(q.peek?.number).toBe('2026-0607-СВ');
    expect(plain(q.done.find(d => d.number === '2025-0517-РД')?.amount)).toBe('върнати 384 €');
    expect((await disputeQueue(admin, { filter: 'otvoreni' })).done).toHaveLength(0);
  });
  it('needs resolve_disputes', async () => {
    await expect(disputeQueue(support, {})).rejects.toThrow(/Forbidden/);
  });
  it('case 2026-0614-ФК: statements, waiting side, options, money held', async () => {
    const c = (await disputeCase(admin, '2026-0614-ФК'))!;
    expect(c.client.filer).toBe(true);
    expect(c.client.statements).toHaveLength(1);
    expect(c.partner.wait?.[0]).toBe('Още не е отговорил.');
    expect(c.options.map(o => plain(o.label))).toEqual(['Задължи Snap360 да осигури 4 часа', 'Върни разликата — 140 €', 'Анулирай с пълно възстановяване']);
    expect(plain(c.money.value)).toBe('560 €');
    expect(c.remind).toEqual({ side: 'partner', name: 'Snap360' });
    expect(c.timeline.at(-1)?.title).toBe('Вашето решение');
  });
  it('case 2026-0621-ТЛ: the payment warning and the pending price change', async () => {
    const c = (await disputeCase(admin, '2026-0621-ТЛ'))!;
    expect(plain(c.warn?.text)).toMatch(/^Срокът за плащане изтича след 6 ч 20 мин\./);
    expect(c.warn?.extend).toBe(true);
    expect(c.revisionHref).toMatch(/^\/admin\/moderatsiya\?usluga=/);
    expect(plain(c.money.note)).toBe('За плащане: 3 600 € вместо одобрените 3 200 €.');
  });
  it('a decided case shows its decision', async () => {
    const c = (await disputeCase(admin, '2025-0517-РД'))!;
    expect(plain(c.decision?.title)).toBe('Частично възстановяване — 30%');
    expect(plain(c.decision?.by)).toBe('Моника Ковачева · 20 май 2025, 11:30');
  });
});

describe('payouts', () => {
  it('overview: history, the next batch, the account waiting for the check', async () => {
    const r = await payoutsOverview(admin);
    expect(r.history).toHaveLength(3);
    expect(r.next.batchDate).toBe('2025-09-01');
    expect(r.releasable).toBe(false);
    expect(r.accounts).toHaveLength(1);
  });
  it('the batch is released on its day (prepared first when T17 has not run)', async () => {
    setTestNow(sofiaInstant('2025-09-01', 10, 0));
    try {
      expect((await payoutsOverview(admin)).releasable).toBe(true);
      const res = await releaseNextBatch(admin, { batchDate: '2025-09-01' });
      expect(res.status).toBe('released');
      const [b] = await db.select().from(s.payoutBatch).where(eq(s.payoutBatch.batchDate, '2025-09-01'));
      expect(['released', 'paid']).toContain(b.status);
    } finally { setTestNow(NOW); }
  });
});

describe('emails and reports', () => {
  it('catalogue: 90 emails by audience, search, previews with samples', async () => {
    const c = await emailCatalogue({});
    expect(c.count).toBe(90);
    expect(c.totals).toEqual({ client: 35, partner: 42, team: 13 });
    expect((await emailCatalogue({ audience: 'team' })).count).toBe(13);
    const p = await emailPreview('client-welcome');
    expect(p?.kind === 'sample' && p.content.heading).toBe('Добре дошли в EventAT');
    expect(await emailPreview('no-such-key')).toBeNull();
  });
  it('requestReport records a report job', async () => {
    const { reportId } = await requestReport(admin, { kind: 'admin_bookings', params: { month: '2026-06' } });
    const [r] = await db.select().from(s.reportJob).where(eq(s.reportJob.id, reportId));
    expect(r.kind).toBe('admin_bookings');
  });
  it('copy helpers', () => {
    expect(tie('3 200 € за 4 часа')).toBe('3 200 € за 4 часа');
    expect(refusalText(new AftercareError('motive_required'))).toMatch(/^Напишете мотива/);
    expect(refusalText(new AftercareError('whatever'))).toBe('Действието вече не е възможно');
  });
});
