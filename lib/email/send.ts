import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import { emailOutbox, notificationPreference } from '@/db/schema';
import { hasSecrets, liveCopy, redactVars, storedCopy } from './secrets';
import { TEMPLATES } from './templates';
import { now } from '@/lib/clock';

export type SendArgs = {
  key: string;
  to: string;
  toUserId?: string | null;
  vars: Record<string, unknown>;
  /** Same dedupeKey = sent once (timers and webhooks may fire twice). */
  dedupeKey?: string;
};

/**
 * Queue an automatic email. Inside a transaction, pass `tx` so the email is
 * only recorded if the business change commits; delivery happens after commit
 * via deliverQueued() (the cron tick also retries anything left queued).
 */
export async function sendEmail(args: SendArgs, tx?: Tx): Promise<string | null> {
  const tpl = TEMPLATES[args.key];
  if (!tpl) throw new Error(`Unknown email template: ${args.key}`);
  const q = tx ?? db;

  let status: 'queued' | 'suppressed' = 'queued';
  if (tpl.optional && args.toUserId) {
    const pref = await q.select().from(notificationPreference)
      .where(and(
        eq(notificationPreference.userId, args.toUserId),
        eq(notificationPreference.key, tpl.preference ?? tpl.key),
        eq(notificationPreference.channel, 'email'),
      ))
      .limit(1);
    if (pref[0] && !pref[0].enabled) status = 'suppressed';
  }

  // A credential (one-time link or code) is masked in the stored copy: the team browses the outbox
  // (Админ → Имейли), and only the recipient's inbox may hold it. `vars` keeps the real values
  // until delivery renders the live message; a real transport then masks them too.
  const { subject, html, text } = storedCopy(tpl, args.vars);
  const rows = await q.insert(emailOutbox).values({
    templateKey: tpl.key, toEmail: args.to, toUserId: args.toUserId ?? null, audience: tpl.audience,
    subject, html, text, vars: args.vars, status, dedupeKey: args.dedupeKey ?? null,
    createdAt: await now(), // business time: the demo's shifted clock reads the same in the log as on screen
  }).onConflictDoNothing().returning({ id: emailOutbox.id });
  const id = rows[0]?.id ?? null;
  if (id && !tx && status === 'queued') await deliver(id);
  return id;
}

/** Try to deliver one queued email through the configured transport. */
export async function deliver(id: string): Promise<void> {
  const [m] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)).limit(1);
  if (!m || m.status !== 'queued') return;
  const transport = process.env.EMAIL_TRANSPORT ?? 'outbox';
  const from = process.env.EMAIL_FROM ?? 'EventAT <no-reply@eventat.bg>';
  const replyTo = process.env.EMAIL_REPLY_TO ?? 'help@eventat.bg';
  const tpl = TEMPLATES[m.templateKey];
  const vars = (m.vars ?? {}) as Record<string, unknown>;
  const secret = hasSecrets(tpl);
  // The live message (credentials included) exists only on its way to the transport.
  const live = secret ? liveCopy(tpl, vars) : { subject: m.subject, html: m.html, text: m.text };
  // Once a real transport has the message (or gave up on it), the outbox forgets the credential.
  // The `outbox` transport (development) records only: there the outbox is the mailbox.
  const scrub = (done: boolean) => (secret && done && transport !== 'outbox' ? { vars: redactVars(tpl, vars) } : {});
  try {
    let providerMessageId: string | null = null;
    if (transport === 'postmark') {
      const r = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN ?? '' },
        body: JSON.stringify({ From: from, To: m.toEmail, ReplyTo: replyTo, Subject: live.subject, HtmlBody: live.html, TextBody: live.text, MessageStream: 'outbound', Tag: m.templateKey }),
      });
      const j = await r.json() as { MessageID?: string; Message?: string; ErrorCode?: number };
      if (!r.ok || j.ErrorCode) throw new Error(j.Message ?? `Postmark ${r.status}`);
      providerMessageId = j.MessageID ?? null;
    } else if (transport === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.toEmail], reply_to: replyTo, subject: live.subject, html: live.html, text: live.text, tags: [{ name: 'template', value: m.templateKey.replace(/[^a-zA-Z0-9_-]/g, '_') }] }),
      });
      const j = await r.json() as { id?: string; message?: string };
      if (!r.ok) throw new Error(j.message ?? `Resend ${r.status}`);
      providerMessageId = j.id ?? null;
    } // 'outbox': recorded only — Админ → Имейли shows it.
    await db.update(emailOutbox).set({ status: 'sent', provider: transport, providerMessageId, sentAt: await now(), attempts: m.attempts + 1, ...scrub(true) }).where(eq(emailOutbox.id, id));
  } catch (e) {
    const attempts = m.attempts + 1;
    await db.update(emailOutbox).set({ attempts, error: String(e), status: attempts >= 5 ? 'failed' : 'queued', ...scrub(attempts >= 5) }).where(eq(emailOutbox.id, id));
  }
}

/** Deliver everything still queued (called after transactions and by the cron tick). */
export async function deliverQueued(limit = 50): Promise<number> {
  const rows = await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.status, 'queued')).limit(limit);
  for (const r of rows) await deliver(r.id);
  return rows.length;
}
