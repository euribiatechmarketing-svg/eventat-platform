// Conversations (SPEC §4.16) and contact masking (§10).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { maskContacts } from '@/lib/domain/catalogue-kit';
import { ensureConversation, getOrCreate, listConversations, markRead, saveDraft, send, thread } from '@/lib/domain/messaging';
import { setPreferences } from '@/lib/domain/clients';
import { createAdmin, createBookingRow, createClient } from '../helpers/factories';
import { NOW, bells, emails, expectLedgerClean, failure, listedPartner, mediaRow, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('§10 masking', () => {
  it('masks phones (≥ 7 digits) and emails, keeping dates, money, times and booking numbers', () => {
    expect(maskContacts('Обадете се на +359 88 412 7730 или 0884127730, или на 088 412 77 30.')).toBe('Обадете се на ••• или •••, или на •••.');
    expect(maskContacts('Пишете на maria.d+wed@gmail.com утре')).toBe('Пишете на ••• утре');
    expect(maskContacts('Сватбата е на 14.06.2026 от 17:00, цена 1 450,00 € и 1 450 €, резервация 2026-0614-ЕА.')).toBe('Сватбата е на 14.06.2026 от 17:00, цена 1 450,00 € и 1 450 €, резервация 2026-0614-ЕА.');
    expect(maskContacts('Гости: 120, зала 2, (02) 987 65 43')).toBe('Гости: 120, зала 2, •••');
    expect(maskContacts('Instagram @studio.melodia')).toBe('Instagram @studio.melodia');
  });
});

async function setup() {
  const pr = await listedPartner({ businessName: 'Студио Мелодия' });
  const cl = await createClient({ name: 'Ивелина Тодорова' });
  const b = await createBookingRow({ client: cl.user, partner: pr, eventDate: '2026-06-28', status: 'awaiting_payment' });
  await db.update(s.clientEvent).set({ title: 'Рожден ден', venueName: 'Вила Екатерина', locality: 'с. Панчарево' }).where(eq(s.clientEvent.id, b.clientEvent.id));
  return { pr, cl, b };
}

describe('conversations', () => {
  it('one per client, partner and event; created from the request or booking by a party only', async () => {
    const { pr, cl, b } = await setup();
    const c1 = await getOrCreate(cl.actor, { number: b.number });
    const c2 = await getOrCreate(pr.actor, { bookingId: b.booking.id });
    expect(c2.id).toBe(c1.id);
    expect(c1).toMatchObject({ clientId: cl.user.id, partnerId: pr.partner.id, clientEventId: b.clientEvent.id, requestId: b.request.id, bookingId: b.booking.id });
    const again = await ensureConversation({ clientId: cl.user.id, partnerId: pr.partner.id, clientEventId: b.clientEvent.id });
    expect(again.id).toBe(c1.id);
    const stranger = await createClient();
    expect(await failure(getOrCreate(stranger.actor, { number: b.number }))).toContain('ForbiddenError');
    const otherPartner = await listedPartner();
    expect(await failure(getOrCreate(otherPartner.actor, { requestId: b.request.id }))).toContain('ForbiddenError');
    // Direct thread with a partner, no event.
    const direct = await getOrCreate(cl.actor, { partnerId: pr.partner.id });
    expect(direct.clientEventId).toBeNull();
    expect((await getOrCreate(cl.actor, { partnerId: pr.partner.id })).id).toBe(direct.id);
  });

  it('sends masked before a confirmed booking, unmasked after; emails and bells the other side', async () => {
    const { pr, cl, b } = await setup();
    const c = await getOrCreate(cl.actor, { number: b.number });
    await saveDraft(cl.actor, { conversationId: c.id, body: 'Чернова' });
    const m = await send(cl.actor, { conversationId: c.id, body: 'Празненството е на 28 юни. Телефонът ми е 0884 127 730.' });
    expect(m).toMatchObject({ senderRole: 'client', body: 'Празненството е на 28 юни. Телефонът ми е •••.', bodyOriginal: 'Празненството е на 28 юни. Телефонът ми е 0884 127 730.' });
    const [conv] = await db.select().from(s.conversation).where(eq(s.conversation.id, c.id));
    expect(conv).toMatchObject({ partnerUnreadCount: 1, clientDraft: null });
    const [mail] = await emails('vendor-new-message', pr.user.id);
    expect(plain(mail.vars)).toEqual({ clientName: 'Ивелина Тодорова', message: 'Празненството е на 28 юни. Телефонът ми е •••.', eventType: 'Рожден ден',
      packageName: 'Цял ден', eventDate: '28 юни 2026', receivedAt: '31 август 2025, 12:00' });
    expect((await bells(pr.user.id))[0]).toMatchObject({ kind: 'vendor-new-message', title: 'Ивелина Тодорова ви писа', href: `/partner/saobshteniya/${c.id}` });

    // The partner reads; the client sees ‹· прочетено›.
    expect(await markRead(pr.actor, { conversationId: c.id })).toBe(1);
    const t = await thread(cl.actor, { conversationId: c.id });
    expect(t.messages.at(-1)).toMatchObject({ mine: true, readMark: true, body: 'Празненството е на 28 юни. Телефонът ми е 0884 127 730.' });
    expect((await thread(pr.actor, { conversationId: c.id })).messages[0].body).toBe('Празненството е на 28 юни. Телефонът ми е •••.');
    const { actor: admin } = await createAdmin('support');
    expect((await thread(admin, { conversationId: c.id })).messages[0].body).toContain('0884 127 730');

    // Once the booking is confirmed (paid) contacts pass.
    await db.update(s.booking).set({ status: 'confirmed' }).where(eq(s.booking.id, b.booking.id));
    advanceTestNow(60_000);
    const r = await send(pr.actor, { conversationId: c.id, body: 'Ще ви звънна на 0884 127 730.' });
    expect(r.body).toBe('Ще ви звънна на 0884 127 730.');
    const [cm] = await emails('client-new-message', cl.user.id);
    expect(plain(cm.vars)).toMatchObject({ partnerName: 'Студио Мелодия', location: 'Вила Екатерина, с. Панчарево', packageName: 'Цял ден' });
    const list = await listConversations(cl.actor);
    expect(list.items[0]).toMatchObject({ otherName: 'Студио Мелодия', unread: 1, contextLink: { label: 'Виж резервацията', href: `/akaunt/rezervacii/${encodeURIComponent(b.number)}` } });
    const plist = await listConversations(pr.actor);
    expect(plist.items[0]).toMatchObject({ badge: 'Потвърдена резервация', otherName: 'Ивелина Тодорова' });
    expect(plist.totals).toEqual({ conversations: 1, unreadMessages: 0 });
    expect((await listConversations(cl.actor, { unreadOnly: true })).items).toHaveLength(1);
    expect((await listConversations(cl.actor, { q: 'мелодия' })).items).toHaveLength(1);
    expect((await listConversations(cl.actor, { q: 'нищо' })).items).toHaveLength(0);
  });

  it('the optional client-new-message can be switched off — the bell still comes (D54)', async () => {
    const { pr, cl, b } = await setup();
    await setPreferences(cl.actor, [{ key: 'client.messages', channel: 'email', enabled: false }]);
    const c = await getOrCreate(pr.actor, { number: b.number });
    await send(pr.actor, { conversationId: c.id, body: 'Имате ли въпроси?' });
    expect((await emails('client-new-message', cl.user.id))[0].status).toBe('suppressed');
    expect((await bells(cl.user.id))[0]).toMatchObject({ kind: 'client-new-message', body: 'Имате ли въпроси?' });
  });

  it('§11.4: a client SMS switch that is on records the SMS (subject + link)', async () => {
    const { pr, cl, b } = await setup();
    await setPreferences(cl.actor, [{ key: 'client.messages', channel: 'sms', enabled: true }]);
    const c = await getOrCreate(pr.actor, { number: b.number });
    const m = await send(pr.actor, { conversationId: c.id, body: 'Ще дойдем в 16:00.' });
    const sms = await db.select().from(s.smsOutbox).where(eq(s.smsOutbox.toUserId, cl.user.id));
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ templateKey: 'client-new-message', toPhone: '+359888000000', status: 'queued', dedupeKey: `message:${m.id}:sms` });
    expect(sms[0].body).toMatch(new RegExp(`^Ново съобщение от Студио Мелодия https?://.+/akaunt/saobshteniya/${c.id}$`));
    // Off by default.
    const other = await setup();
    const c2 = await getOrCreate(other.pr.actor, { number: other.b.number });
    await send(other.pr.actor, { conversationId: c2.id, body: 'Здравейте' });
    expect(await db.select().from(s.smsOutbox).where(eq(s.smsOutbox.toUserId, other.cl.user.id))).toHaveLength(0);
  });

  it('refuses empty, too long, foreign or blocked senders; one attachment of the sender', async () => {
    const { pr, cl, b } = await setup();
    const c = await getOrCreate(cl.actor, { number: b.number });
    expect(await failure(send(cl.actor, { conversationId: c.id, body: '  ' }))).toContain('empty_message');
    expect(await failure(send(cl.actor, { conversationId: c.id, body: 'x'.repeat(4001) }))).toContain('message_too_long');
    const stranger = await createClient();
    expect(await failure(send(stranger.actor, { conversationId: c.id, body: 'Здравейте' }))).toContain('ForbiddenError');
    const att = await mediaRow(cl.user.id, 'message_attachment', { mime: 'application/pdf' });
    const m = await send(cl.actor, { conversationId: c.id, body: '', attachmentMediaId: att.id });
    expect((await thread(pr.actor, { conversationId: c.id })).messages.find(x => x.id === m.id)?.attachments).toHaveLength(1);
    await db.update(s.user).set({ banned: true }).where(eq(s.user.id, cl.user.id));
    expect(await failure(send(cl.actor, { conversationId: c.id, body: 'Здравейте' }))).toContain('blocked');
  });
});
