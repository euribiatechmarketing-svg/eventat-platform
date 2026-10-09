// Security: uploads need a reason, have a quota, and leftovers are removed (unbounded-unlinked-uploads).
// Before the fix any signed-in client could store unlimited 5 MB files as "dispute evidence" or
// "review photos" with no dispute or booking behind them, and review photos were public at once:
// EventAT's domain as free image hosting.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { authThrottle, media, partnerPhoto, requestAttachment, user } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { canAccess, purgeUnlinkedMedia, upload } from '@/lib/domain/media';
import { publish } from '@/lib/domain/reviews';
import { LIMITS } from '@/lib/domain/throttle';
import { getSetting } from '@/lib/domain/settings';
import { deleteFile } from '@/lib/storage';
import { createBookingRow, createClient, createPartner } from '../helpers/factories';
import { NOW, failure, mediaRow } from '../helpers/catalogue';

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'a.jpg', { type: 'image/jpeg' });
const stored: string[] = [];
const keep = <T extends { storageKey: string }>(m: T) => { stored.push(m.storageKey); return m; };
const ownedBy = (userId: string) => db.select().from(media).where(eq(media.ownerUserId, userId));
const fileOf = (key: string) => join(process.cwd(), key.startsWith('private/') ? '.data' : 'public', 'uploads', key);

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); for (const k of stored) await deleteFile(k); });

describe('an upload needs a reason', () => {
  it('no evidence without a booking that can carry a dispute, no review photo without a reviewable booking', async () => {
    const { actor, user: u } = await createClient();
    expect(await failure(upload(actor, { kind: 'dispute_evidence', file: jpeg() }))).toContain('not_disputable');
    expect(await failure(upload(actor, { kind: 'review_photo', file: jpeg() }))).toContain('not_reviewable');
    expect(await ownedBy(u.id)).toHaveLength(0);

    const p = await createPartner();
    await createBookingRow({ client: u, partner: p, status: 'confirmed' });
    keep(await upload(actor, { kind: 'dispute_evidence', file: jpeg() }));
    expect(await failure(upload(p.actor, { kind: 'review_photo', file: jpeg() }))).toContain('upload_forbidden');
    keep(await upload(p.actor, { kind: 'dispute_evidence', file: jpeg() })); // the partner of that booking
  });

  it('a review photo is private until the published review shows it', async () => {
    const { actor, user: u } = await createClient();
    const p = await createPartner();
    const b = await createBookingRow({ client: u, partner: p, eventDate: '2025-05-17', status: 'completed' });
    const photo = keep(await upload(actor, { kind: 'review_photo', file: jpeg() }));
    expect(photo.isPublic).toBe(false);
    expect(photo.storageKey.startsWith('private/')).toBe(true);
    expect(await canAccess(null, photo.id)).toBe(false);
    await publish(actor, {
      bookingId: b.booking.id, ratingOverall: 5, ratingCommunication: 5, ratingAccuracy: 5, ratingQuality: 5, ratingValue: 5,
      body: 'Всичко мина безупречно. Пристигна навреме, техниката беше на ниво, а плейлистът — точно по вкуса на гостите.',
      photoMediaIds: [photo.id],
    });
    expect(await canAccess(null, photo.id)).toBe(true);
    // No more reviewable bookings: no more review photos.
    expect(await failure(upload(actor, { kind: 'review_photo', file: jpeg() }))).toContain('not_reviewable');
  });

  it('a full gallery takes no more files (checked before anything is stored)', async () => {
    const p = await createPartner();
    const max = await getSetting('partner.gallery_max');
    for (let i = 0; i < max; i++) {
      const m = await mediaRow(p.user.id, 'gallery');
      await db.insert(partnerPhoto).values({ partnerId: p.partner.id, mediaId: m.id, position: i });
    }
    expect(await failure(upload(p.actor, { kind: 'gallery', file: jpeg() }))).toContain('gallery_full');
    expect(await ownedBy(p.user.id)).toHaveLength(max);
  });
});

describe('quota', () => {
  it('stops a user past the hourly quota before storing', async () => {
    const { actor, user: u } = await createClient();
    await db.insert(authThrottle).values({ key: `uploadHour:${u.id.toLowerCase()}`, hits: LIMITS.uploadHour.max, windowStart: sql`now()` });
    expect(await failure(upload(actor, { kind: 'user_avatar', file: jpeg() }))).toContain('upload_quota');
    expect(await ownedBy(u.id)).toHaveLength(0);
  });
});

describe('leftover uploads', () => {
  it('a day-old upload nothing links to is deleted, file and row; linked ones and the current avatar stay', async () => {
    const { actor, user: u } = await createClient();
    const p = await createPartner();
    const r = await createBookingRow({ client: u, partner: p, status: 'confirmed' });
    const orphan = keep(await upload(actor, { kind: 'request_attachment', file: jpeg() }));
    const linked = keep(await upload(actor, { kind: 'request_attachment', file: jpeg() }));
    await db.insert(requestAttachment).values({ requestId: r.request.id, mediaId: linked.id, position: 0 });
    const avatar = keep(await upload(actor, { kind: 'user_avatar', file: jpeg() }));
    await db.update(user).set({ image: `/uploads/${avatar.storageKey}` }).where(eq(user.id, u.id));
    const fresh = keep(await upload(actor, { kind: 'request_attachment', file: jpeg() }));
    await db.update(media).set({ createdAt: sql`now() - interval '2 days'` }).where(sql`${media.id} in (${orphan.id}, ${linked.id}, ${avatar.id})`);

    expect(existsSync(fileOf(orphan.storageKey))).toBe(true);
    expect(await purgeUnlinkedMedia()).toBeGreaterThanOrEqual(1);
    const left = (await ownedBy(u.id)).map(m => m.id);
    expect(left).not.toContain(orphan.id);
    expect(left).toEqual(expect.arrayContaining([linked.id, avatar.id, fresh.id]));
    expect(existsSync(fileOf(orphan.storageKey))).toBe(false);
    expect(existsSync(fileOf(linked.storageKey))).toBe(true);
  });
});
