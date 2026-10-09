// Security: the D55 email change (‹Имейл› on /akaunt/nastroyki → the code sent to the new address).
//  - email-change-attempts-race (F4 / S1): the 5-attempts-per-code limit counted failures in
//    audit_log outside any lock and wrote them only after the attempt, so parallel guesses all
//    passed it; and every ‹Запази промените› with an address started a fresh code (and a fresh 5)
//    with no cooldown or limit. A hit bound someone else's unregistered address, confirmed, to the
//    attacker's account.
//  - email-change-no-reauth (S2, the part that needs no new copy): a confirmed change now ends the
//    account's other sessions and remembered devices.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { confirmEmailChange } from '@/lib/domain/clients';
import { requestEmailChangeCode, saveSettings, type SettingsInput } from '@/lib/domain/views-auth-account';
import { LIMITS } from '@/lib/domain/throttle';
import { createClient } from '../helpers/factories';
import { NOW, emails, failure } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(() => setTestNow(null));

const VICTIM = 'unregistered.victim@example.com';
const wrong = (code: string, i: number) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0');
const emailOf = async (userId: string) => (await db.select().from(s.user).where(eq(s.user.id, userId)))[0];

async function addSession(userId: string) {
  const id = `s_${Math.random().toString(36).slice(2)}`;
  await db.insert(s.session).values({ id, token: id, userId, expiresAt: new Date('2030-01-01') });
  return id;
}

function settings(email: string, o: Partial<SettingsInput> = {}): SettingsInput {
  return { name: 'Мария Димитрова', phone: '+359888000000', email, cityId: null, marketing: false, twoFactor: false, prefs: [], ...o };
}

describe('D55 email change', () => {
  it('parallel guesses get 5 attempts per code in total, not 5 each (F4)', async () => {
    const { actor, user } = await createClient();
    const { code } = await requestEmailChangeCode(actor, VICTIM);
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => failure(confirmEmailChange(actor, { code: wrong(code, i) }))));
    expect(results.filter(r => r.includes('invalid_code'))).toHaveLength(5);
    expect(results.filter(r => r.includes('too_many_attempts'))).toHaveLength(25);
    // The right code no longer works either: a new one is needed.
    expect(await failure(confirmEmailChange(actor, { code }))).toContain('too_many_attempts');
    expect((await emailOf(user.id)).email).toBe(user.email);
  });

  it('a wrong code counts, a sixth try needs a new code (D49)', async () => {
    const { actor, user } = await createClient();
    const { code } = await requestEmailChangeCode(actor, 'new.address@example.com');
    for (let i = 0; i < 4; i++) expect(await failure(confirmEmailChange(actor, { code: wrong(code, i) }))).toContain('invalid_code');
    await confirmEmailChange(actor, { code }); // the fifth try
    expect((await emailOf(user.id)).email).toBe('new.address@example.com');

    const other = await createClient();
    const second = await requestEmailChangeCode(other.actor, 'second.address@example.com');
    for (let i = 0; i < 5; i++) await failure(confirmEmailChange(other.actor, { code: wrong(second.code, i) }));
    expect(await failure(confirmEmailChange(other.actor, { code: second.code }))).toContain('too_many_attempts');
  });

  it('a new code needs the 60 s cooldown and counts towards the hourly limit; the old code stops working (S1)', async () => {
    const { actor, user } = await createClient();
    const first = await requestEmailChangeCode(actor, VICTIM);
    expect(await failure(requestEmailChangeCode(actor, 'another.victim@example.com'))).toContain('too_soon');
    expect(await failure(saveSettings(actor, settings('another.victim@example.com')))).toContain('too_soon');
    // The same address again (‹Запази промените› twice): the code already sent stays, no new email.
    expect(await saveSettings(actor, settings(VICTIM))).toEqual({ emailChange: VICTIM });
    expect(await emails('client-verify-code', user.id)).toHaveLength(1);

    advanceTestNow(61_000);
    const second = await requestEmailChangeCode(actor, 'another.victim@example.com');
    expect(await failure(confirmEmailChange(actor, { code: first.code }))).toContain('invalid_code');
    expect(await db.select().from(s.emailChangeRequest)
      .where(and(eq(s.emailChangeRequest.userId, user.id), eq(s.emailChangeRequest.id, second.requestId)))).toHaveLength(1);

    // At most LIMITS.codeSend codes an hour, however long the wait between them.
    for (let i = 2; i < LIMITS.codeSend.max; i++) { advanceTestNow(61_000); await requestEmailChangeCode(actor, `victim.${i}@example.com`); }
    advanceTestNow(61_000);
    expect(await failure(requestEmailChangeCode(actor, 'one.more@example.com'))).toContain('too_many_requests');
    expect(await emails('client-verify-code', user.id)).toHaveLength(LIMITS.codeSend.max);
  });

  it('a confirmed change ends the other sessions and remembered devices (S2)', async () => {
    const { actor, user } = await createClient();
    const here = await addSession(user.id);
    await addSession(user.id);
    const other = await createClient();
    const otherSession = await addSession(other.user.id);
    await db.insert(s.verification).values([
      { id: 'td-1', identifier: 'trust-device-aaa', value: user.id, expiresAt: new Date('2030-01-01') },
      { id: 'td-2', identifier: 'trust-device-bbb', value: other.user.id, expiresAt: new Date('2030-01-01') },
    ]);
    const { code } = await requestEmailChangeCode(actor, 'moved@example.com');
    await confirmEmailChange(actor, { code, keepSessionId: here });
    expect((await db.select().from(s.session).where(eq(s.session.userId, user.id))).map(x => x.id)).toEqual([here]);
    expect((await db.select().from(s.session).where(eq(s.session.userId, other.user.id))).map(x => x.id)).toEqual([otherSession]);
    expect((await db.select().from(s.verification).where(like(s.verification.identifier, 'trust-device-%'))).map(v => v.value)).toEqual([other.user.id]);
  });
});
