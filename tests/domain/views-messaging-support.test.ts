// Read models of the messages and support screens (lib/domain/views-messaging-support.ts):
// formats, who may see what (SPEC §0 guards, §10 masking), and the case page's state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { getOrCreate, markRead, send } from '@/lib/domain/messaging';
import { openByClient, openByPartner, submitStatement, withdraw } from '@/lib/domain/disputes';
import {
  caseView, clientDisputeChoices, conversationList, conversationView, dayLabel, eventDateShort, listTime, partnerDisputeChoices, partyCases,
} from '@/lib/domain/views-messaging-support';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { media } from '@/db/schema';
import { createClient } from '../helpers/factories';
import { clearJobs, paidBooking } from '../helpers/aftercare';
import { mediaRow } from '../helpers/catalogue';

const NOW = sofiaInstant('2025-08-31', 12, 0);
/** Day and month, number and word never part (lib/format.ts writes a no-break space). */
const NB = '\u00A0';
beforeEach(async () => { await clearJobs(); setTestNow(NOW); });
afterEach(() => setTestNow(null));

describe('formats', () => {
  it('list times and day separators as the prototype writes them', () => {
    expect(listTime(sofiaInstant('2025-08-31', 11, 42), NOW)).toBe('11:42');
    expect(listTime(sofiaInstant('2025-08-30', 18, 40), NOW)).toBe('вчера');
    expect(listTime(sofiaInstant('2025-08-29', 9, 0), NOW)).toBe(`29${NB}авг`);
    expect(listTime(sofiaInstant('2024-12-19', 9, 0), NOW)).toBe(`19${NB}дек 2024`);
    expect(dayLabel(sofiaInstant('2025-08-31', 9, 0), NOW)).toBe('Днес');
    expect(dayLabel(sofiaInstant('2025-08-30', 9, 0), NOW)).toBe('Вчера');
    expect(dayLabel(sofiaInstant('2025-08-29', 18, 20), NOW)).toBe(`Петък, 29${NB}август`);
    // list rows and picks write the event date short, as client/messages.html and client/dispute.html do
    expect(eventDateShort('2026-12-19')).toBe(`19${NB}дек 2026`);
    expect(eventDateShort('2026-06-14')).toBe(`14${NB}юни 2026`);
  });
});

describe('messages', () => {
  it('each side sees its own list; the partner sees contacts masked before a confirmed booking', async () => {
    const { client, partner, booking } = await paidBooking({ status: 'awaiting_payment', line: false });
    const c = await getOrCreate(client.actor, { bookingId: booking.id });
    await send(client.actor, { conversationId: c.id, body: 'Обадете се на 0888 123 456' });
    const mine = await conversationView(client.actor, c.id);
    expect(mine.days.at(-1)!.messages.at(-1)!.body).toBe('Обадете се на 0888 123 456');
    expect(mine.contextLink?.label).toBe('Виж заявката');
    const theirs = await conversationView(partner.actor, c.id);
    expect(theirs.days.at(-1)!.messages.at(-1)!.body).toBe('Обадете се на •••');
    expect((await conversationList(partner.actor)).totals).toEqual({ conversations: 1, unreadMessages: 1 });
    expect((await conversationList(partner.actor, { unreadOnly: true })).items).toHaveLength(1);
    // ‹Само непрочетени›: once read it leaves the filtered list, unless it is the conversation open beside it
    await markRead(partner.actor, { conversationId: c.id });
    expect((await conversationList(partner.actor, { unreadOnly: true })).items).toHaveLength(0);
    expect((await conversationList(partner.actor, { unreadOnly: true, keepId: c.id })).items.map(i => i.id)).toEqual([c.id]);
    expect((await conversationList(partner.actor, { unreadOnly: true, keepId: c.id, q: 'няма такъв' })).items).toHaveLength(0);
    expect((await conversationList(partner.actor, { q: 'няма такъв' })).items).toHaveLength(0);
    const stranger = await createClient();
    await expect(conversationView(stranger.actor, c.id)).rejects.toThrow();
    expect((await conversationList(stranger.actor)).items).toHaveLength(0);
  });

  it('a message that is only a file previews as the file name', async () => {
    const { client, partner, booking } = await paidBooking({ status: 'awaiting_payment', line: false });
    const c = await getOrCreate(client.actor, { bookingId: booking.id });
    const file = await mediaRow(client.user.id, 'message_attachment', { mime: 'application/pdf' });
    await db.update(media).set({ originalName: 'plan-na-zalata.pdf' }).where(eq(media.id, file.id));
    await send(client.actor, { conversationId: c.id, body: '', attachmentMediaId: file.id });
    expect((await conversationList(partner.actor)).items[0].preview).toBe('plan-na-zalata.pdf');
    await send(partner.actor, { conversationId: c.id, body: 'Получихме плана.' });
    expect((await conversationList(client.actor)).items[0].preview).toBe('Получихме плана.');
  });
});

describe('support', () => {
  it('a client case: choices, list, the case page for both parties only, deadline, withdraw', async () => {
    const { client, partner, booking } = await paidBooking();
    const old = await paidBooking({ client, partner, eventDate: '2025-07-01', status: 'completed' });
    const choices = await clientDisputeChoices(client.actor);
    expect(choices.map(c => c.number)).toEqual([booking.number]); // 2025-07-01 is more than 30 days ago (D70)
    expect(choices[0].sub).not.toContain('№'); // the page adds ‹№ …› kept on one line
    expect(choices[0].sub).not.toMatch(/ ·/); // ‹ · › sticks to the word before it
    const d = await openByClient(client.actor, { bookingId: booking.id, reason: 'no_show', description: 'Не дойдоха.' });
    expect(await clientDisputeChoices(client.actor)).toEqual([]);
    expect((await partnerDisputeChoices(partner.actor)).map(c => c.number)).not.toContain(booking.number);
    expect((await partnerDisputeChoices(partner.actor, old.number)).map(c => c.number)).toContain(old.number);

    const list = await partyCases(client.actor);
    expect(list.openCount).toBe(1);
    expect(list.items[0]).toMatchObject({ number: booking.number, open: true, badge: { label: 'Събираме данни' } });
    expect(list.items[0].sub).toContain('подаден днес');

    const v = (await caseView(client.actor, booking.number))!;
    expect(v).toMatchObject({ side: 'client', status: 'collecting', canWithdraw: true, positionPending: false });
    expect(v.deadline).toMatchObject({ label: 'Срок за изпълнителя', text: `Срок до 2${NB}септември, 12:00` });
    expect(v.parties[0]).toMatchObject({ party: 'client', filer: 'Подаде сигнала' });
    expect(v.parties[1].waiting).toContain(`Поискахме позиция на 31${NB}август в 12:00`);
    expect(v.money).toMatchObject({ label: 'платени и задържани от платформата' });

    const pv = (await caseView(partner.actor, booking.number))!;
    expect(pv).toMatchObject({ side: 'partner', canWithdraw: false, positionPending: true });
    expect(await caseView((await createClient()).actor, booking.number)).toBeNull();

    await submitStatement(partner.actor, { disputeId: d.id, body: 'Бяхме там в 15:30.' });
    const after = (await caseView(client.actor, booking.number))!;
    expect(after).toMatchObject({ status: 'awaiting_decision', canWithdraw: false, deadline: null, badge: { label: 'Чака решение' } });
    expect(after.timeline.map(t => t.title)).toContain(`${partner.partner.businessName} отговори`);
  });

  it('a partner case withdrawn by its filer', async () => {
    const { partner, booking } = await paidBooking();
    const d = await openByPartner(partner.actor, { bookingId: booking.id, reason: 'client_unresponsive', description: 'Няма отговор.' });
    const v = (await caseView(partner.actor, booking.number))!;
    expect(v).toMatchObject({ canWithdraw: true, deadline: { label: 'Срок за клиента' } });
    expect(v.money?.note).toBe('Сигналът не засяга сумата — изплащането следва обичайния график.');
    await withdraw(partner.actor, { disputeId: d.id });
    const w = (await caseView(partner.actor, booking.number))!;
    expect(w).toMatchObject({ status: 'withdrawn', open: false, canWithdraw: false, money: null, badge: { label: 'Оттеглен' } });
    expect(w.timeline.at(-1)!.title).toBe('Сигналът е оттеглен');
  });
});
