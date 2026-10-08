import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import { emailOutbox, notificationPreference } from '@/db/schema';
import { renderEmail } from './render';
import { TEMPLATES } from './templates';

export type SendArgs = {
  key: string;
  to: string;
  toUserId?: string | null;
  vars: Record<string, unknown>;
  /** Same dedupeKey = sent once (timers and webhooks may fire twice). */
  dedupeKey?: string;
};

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

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
      .where(and(eq(notificationPreference.userId, args.toUserId), eq(notificationPreference.key, tpl.preference ?? tpl.key)))
      .limit(1);
    if (pref[0] && !pref[0].enabled) status = 'suppressed';
  }

  const content = tpl.render(args.vars);
  const { html, text } = renderEmail(content, tpl.audience, tpl.optional, appUrl());
  const rows = await q.insert(emailOutbox).values({
    templateKey: tpl.key, toEmail: args.to, toUserId: args.toUserId ?? null, audience: tpl.audience,
    subject: content.subject, html, text, vars: args.vars, status, dedupeKey: args.dedupeKey ?? null,
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
  try {
    let providerMessageId: string | null = null;
    if (transport === 'postmark') {
      const r = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN ?? '' },
        body: JSON.stringify({ From: from, To: m.toEmail, ReplyTo: replyTo, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, MessageStream: 'outbound', Tag: m.templateKey }),
      });
      const j = await r.json() as { MessageID?: string; Message?: string; ErrorCode?: number };
      if (!r.ok || j.ErrorCode) throw new Error(j.Message ?? `Postmark ${r.status}`);
      providerMessageId = j.MessageID ?? null;
    } else if (transport === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.toEmail], reply_to: replyTo, subject: m.subject, html: m.html, text: m.text, tags: [{ name: 'template', value: m.templateKey.replace(/[^a-zA-Z0-9_-]/g, '_') }] }),
      });
      const j = await r.json() as { id?: string; message?: string };
      if (!r.ok) throw new Error(j.message ?? `Resend ${r.status}`);
      providerMessageId = j.id ?? null;
    } // 'outbox': recorded only — Админ → Имейли shows it.
    await db.update(emailOutbox).set({ status: 'sent', provider: transport, providerMessageId, sentAt: new Date(), attempts: m.attempts + 1 }).where(eq(emailOutbox.id, id));
  } catch (e) {
    const attempts = m.attempts + 1;
    await db.update(emailOutbox).set({ attempts, error: String(e), status: attempts >= 5 ? 'failed' : 'queued' }).where(eq(emailOutbox.id, id));
  }
}

/** Deliver everything still queued (called after transactions and by the cron tick). */
export async function deliverQueued(limit = 50): Promise<number> {
  const rows = await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.status, 'queued')).limit(limit);
  for (const r of rows) await deliver(r.id);
  return rows.length;
}
