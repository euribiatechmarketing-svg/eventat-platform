// Security: the email outbox never shows a usable credential (outbox-secrets-any-team-role,
// outbox-live-credentials-any-team-role). Before the fix any team role could open
// /admin/imeyli?izgled=izprateni, find a team invite or a password-reset email and read its link:
// a support member could become an admin, or reset any account's password.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { emailOutbox } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { invite } from '@/lib/domain/team';
import { emailPreview, outboxList, outboxShowsCredentials } from '@/lib/domain/views-admin-money';
import { deliver, sendEmail } from '@/lib/email/send';
import { MASK, maskLink } from '@/lib/email/secrets';
import { createAdmin } from '../helpers/factories';
import { NOW } from '../helpers/catalogue';

const RESET_TOKEN = 'Q7bX2kLmN9pRsT4vWyZa1c3e';
const RESET_URL = `http://localhost:3000/api/auth/reset-password/${RESET_TOKEN}?callbackURL=%2Fvhod%2Fnova-parola`;

const row = async (id: string) => (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];

// Production behaviour by default; the demo/staging exception has its own test below.
beforeEach(() => { setTestNow(NOW); vi.stubEnv('ALLOW_TIME_TRAVEL', 'false'); });
afterEach(() => { setTestNow(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('one-time links and codes are masked wherever the team can look', () => {
  it('maskLink keeps the page and hides the token, and fails closed', () => {
    expect(maskLink('/admin/pokana/8H3kq0R9b2Zw1xY7cVnM4pLs6tUe5iJa0oGf2dKh3sA')).toBe(`/admin/pokana/${MASK}`);
    expect(maskLink('/akaunt/iztrivane?token=8H3kq0R9b2Zw1xY7cVnM4pLs')).toBe(`/akaunt/iztrivane?token=${MASK}`);
    expect(maskLink('/partner/nastroyki/iztrivane?token=abc')).toBe(`/partner/nastroyki/iztrivane?token=${MASK}`);
    expect(maskLink(RESET_URL)).toBe(`http://localhost:3000/api/auth/reset-password/${MASK}?callbackURL=${MASK}`);
    expect(maskLink('/x/short')).toBe(MASK);
  });

  it('a support member cannot read the outbox; an admin sees the team invite without its token', async () => {
    const { actor: owner } = await createAdmin('admin', { name: 'Моника Ковачева' });
    const { actor: support } = await createAdmin('support');
    const { token } = await invite(owner, { email: 'nov.admin@eventat.bg', role: 'admin' });
    const [m] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, 'nov.admin@eventat.bg'));

    // The stored copy never holds the link.
    for (const field of [m.subject, m.html, m.text]) expect(field).not.toContain(token);
    expect(m.html).toContain(`/admin/pokana/${MASK}`);

    // The attack: support lists the outbox and opens the message.
    await expect(outboxList(support, { q: 'team-invite' })).rejects.toThrow(/Forbidden/);
    expect(await emailPreview(support, 'team-invite', m.id)).toBeNull();

    // The owner may browse it, masked.
    const list = await outboxList(owner, { q: 'nov.admin@eventat.bg' });
    expect(list.rows.map(r => r.id)).toContain(m.id);
    const p = await emailPreview(owner, 'team-invite', m.id);
    expect(p?.kind).toBe('sent');
    expect(p?.kind === 'sent' && p.html).not.toContain(token);
  });

  it('a password-reset link and a verification code stay out of the stored subject, html and text', async () => {
    const { actor: owner } = await createAdmin('admin');
    const resetId = (await sendEmail({ key: 'client-password-link', to: 'victim@example.com', vars: { url: RESET_URL, email: 'victim@example.com' } }))!;
    const codeId = (await sendEmail({ key: 'client-verify-code', to: 'victim@example.com', vars: { code: '482913', email: 'victim@example.com' } }))!;
    const reset = await row(resetId), code = await row(codeId);
    for (const f of [reset.subject, reset.html, reset.text]) expect(f).not.toContain(RESET_TOKEN);
    for (const f of [code.subject, code.html, code.text]) expect(f).not.toContain('482913');
    const list = await outboxList(owner, { q: 'victim@example.com' });
    expect(list.rows.map(r => r.subject).join(' ')).not.toContain('482913');
    const p = await emailPreview(owner, 'client-password-link', resetId);
    expect(p?.kind === 'sent' && p.html).not.toContain(RESET_TOKEN);
  });

  it('a row stored before masking existed is still shown masked', async () => {
    const { actor: owner } = await createAdmin('admin');
    const [legacy] = await db.insert(emailOutbox).values({
      templateKey: 'client-verify-code', toEmail: 'old@example.com', audience: 'client', status: 'sent',
      subject: 'Код за потвърждение на имейла: 771204', html: '<body><b>771204</b></body>', text: '771204',
      vars: { code: '771204', email: 'old@example.com' },
    }).returning();
    const list = await outboxList(owner, { q: 'old@example.com' });
    expect(list.rows[0].subject).not.toContain('771204');
    const p = await emailPreview(owner, 'client-verify-code', legacy.id);
    expect(p?.kind === 'sent' && `${p.subject} ${p.html}`).not.toContain('771204');
  });

  it('a real transport gets the live message; afterwards the outbox keeps only the masked variables', async () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'postmark');
    const bodies: { Subject: string; HtmlBody: string; TextBody: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ MessageID: 'pm-1' }), { status: 200 });
    }));
    const id = (await sendEmail({ key: 'client-password-link', to: 'victim@example.com', vars: { url: RESET_URL, email: 'victim@example.com' } }))!;
    await deliver(id); // already delivered by sendEmail outside a transaction: nothing more
    expect(bodies).toHaveLength(1);
    expect(bodies[0].HtmlBody).toContain(RESET_TOKEN);
    expect(bodies[0].TextBody).toContain(RESET_TOKEN);
    const m = await row(id);
    expect(m.status).toBe('sent');
    expect(JSON.stringify(m.vars)).not.toContain(RESET_TOKEN);
    expect(m.html).not.toContain(RESET_TOKEN);
  });
  it('demo/staging (demo clock on, no email can leave): the team reads the code, so a tester can finish sign-up', async () => {
    expect(outboxShowsCredentials({ ALLOW_TIME_TRAVEL: 'true', EMAIL_TRANSPORT: 'outbox' })).toBe(true);
    expect(outboxShowsCredentials({ ALLOW_TIME_TRAVEL: 'true', EMAIL_TRANSPORT: 'postmark' })).toBe(false);
    expect(outboxShowsCredentials({ EMAIL_TRANSPORT: 'outbox' })).toBe(false);
    vi.stubEnv('ALLOW_TIME_TRAVEL', 'true'); vi.stubEnv('EMAIL_TRANSPORT', 'outbox');
    const { actor } = await createAdmin('admin');
    const id = await sendEmail({ key: 'client-verify-code', to: 'tester@example.com', vars: { code: '735102', email: 'tester@example.com' } });
    const list = await outboxList(actor, { q: 'tester@example.com' });
    expect(list.rows[0].subject).toContain('735102');
    const prev = await emailPreview(actor, 'client-verify-code', id);
    expect(prev && prev.kind === 'sent' && prev.html).toContain('735102');
    // what is stored stays masked all the same
    expect((await row(id!)).subject).not.toContain('735102');
  });
});
