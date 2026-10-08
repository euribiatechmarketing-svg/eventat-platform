// Upload metadata and private-file access (SPEC §14).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { SYSTEM } from '@/lib/domain/actor';
import { canAccess, imageSize, recordUpload, validateUpload } from '@/lib/domain/media';
import { getOrCreate, send } from '@/lib/domain/messaging';
import { createAdmin, createBookingRow, createClient } from '../helpers/factories';
import { NOW, expectLedgerClean, failure, listedPartner } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

function png(w: number, h: number) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w: number, h: number) {
  // SOI, an APP0 segment, then SOF0 with height and width.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

describe('validation (§14)', () => {
  it('reads PNG and JPEG sizes from the header', () => {
    expect(imageSize(png(1600, 900))).toEqual({ width: 1600, height: 900 });
    expect(imageSize(jpeg(400, 380))).toEqual({ width: 400, height: 380 });
    expect(imageSize(Buffer.from('not an image'))).toBeNull();
  });

  it('checks type, size, uploader and the avatar minimum', async () => {
    const { actor: client } = await createClient();
    const { actor: partner } = await listedPartner();
    const ok = { kind: 'request_attachment' as const, mime: 'image/jpeg', sizeBytes: 1_000_000 };
    await validateUpload(client, ok);
    expect(await failure(validateUpload(client, { ...ok, mime: 'image/gif' }))).toContain('upload_type');
    expect(await failure(validateUpload(client, { ...ok, sizeBytes: 5 * 1024 * 1024 + 1 }))).toContain('upload_size');
    expect(await failure(validateUpload(partner, ok))).toContain('upload_forbidden');
    expect(await failure(validateUpload(partner, { kind: 'partner_avatar', mime: 'image/png', sizeBytes: 10, width: 399, height: 800 }))).toContain('upload_dimensions');
    await validateUpload(partner, { kind: 'partner_avatar', mime: 'image/png', sizeBytes: 10, width: 400, height: 400 });
    await validateUpload(partner, { kind: 'bank_proof', mime: 'application/pdf', sizeBytes: 10 });
    expect(await failure(validateUpload(client, { kind: 'review_photo', mime: 'application/pdf', sizeBytes: 10 }))).toContain('upload_type');
    const row = await recordUpload(client, { kind: 'review_photo', storageKey: 'public/review_photo/x.jpg', mime: 'image/jpeg', sizeBytes: 1000 });
    expect(row).toMatchObject({ isPublic: true, kind: 'review_photo' });
    const sysRow = await recordUpload(SYSTEM, { kind: 'invoice_pdf', storageKey: 'private/invoice/x.pdf', mime: 'application/pdf', sizeBytes: 1000 });
    expect(sysRow).toMatchObject({ isPublic: false, ownerUserId: null });
  });
});

describe('private files (`/api/files/[id]`)', () => {
  it('message attachments: the two parties and the team; bank proofs: the partner and the team', async () => {
    const pr = await listedPartner();
    const cl = await createClient();
    const stranger = await createClient();
    const b = await createBookingRow({ client: cl.user, partner: pr, eventDate: '2026-06-14' });
    const att = await recordUpload(cl.actor, { kind: 'message_attachment', storageKey: 'private/m/1.pdf', mime: 'application/pdf', sizeBytes: 1000 });
    const c = await getOrCreate(cl.actor, { number: b.number });
    await send(cl.actor, { conversationId: c.id, body: 'Ето правилата', attachmentMediaId: att.id });
    const { actor: support } = await createAdmin('support');
    expect(await canAccess(cl.actor, att.id)).toBe(true);
    expect(await canAccess(pr.actor, att.id)).toBe(true);
    expect(await canAccess(support, att.id)).toBe(true);
    expect(await canAccess(stranger.actor, att.id)).toBe(false);
    expect(await canAccess(null, att.id)).toBe(false);

    const proof = await recordUpload(pr.actor, { kind: 'bank_proof', storageKey: 'private/b/1.pdf', mime: 'application/pdf', sizeBytes: 1000 });
    expect(await canAccess(pr.actor, proof.id)).toBe(true);
    expect(await canAccess(cl.actor, proof.id)).toBe(false);
    const other = await listedPartner();
    expect(await canAccess(other.actor, proof.id)).toBe(false);

    const reqPhoto = await recordUpload(cl.actor, { kind: 'request_attachment', storageKey: 'private/r/1.jpg', mime: 'image/jpeg', sizeBytes: 1000 });
    await db.insert(s.requestAttachment).values({ requestId: b.request.id, mediaId: reqPhoto.id });
    expect(await canAccess(pr.actor, reqPhoto.id)).toBe(true);
    expect(await canAccess(other.actor, reqPhoto.id)).toBe(false);
    const pub = await recordUpload(pr.actor, { kind: 'gallery', storageKey: 'public/g/1.jpg', mime: 'image/jpeg', sizeBytes: 1000 });
    expect(await canAccess(null, pub.id)).toBe(true);
  });
});
