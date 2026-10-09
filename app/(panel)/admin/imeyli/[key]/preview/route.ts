// /admin/imeyli/[key]/preview — one email drawn the way it lands in an inbox (prototype emails/email.html?e=):
// the envelope (subject, from, to, preheader) above the 600 px message. A template renders with its sample
// variables (lib/email/templates/samples.ts); ?id=<outbox id> shows the message that actually went out
// (manage_team_settings only, with any one-time link or code masked — lib/domain emailPreview()).
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { emailPreview, OUTBOX_STATUS } from '@/lib/domain/views-admin-money';
import { dateTime } from '@/lib/format';
import type { Audience } from '@/lib/email/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Keep a number with its thousands and the word after it (text only). */
const tie = (s: string) => s.replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ').replace(/(\d) (?=[€%а-яА-Я])/g, '$1 ');
const t = (s: string) => esc(tie(s));
const nums = (s: string) => t(s).replace(/\d+/g, '<span class="num">$&</span>');

const WHY: Record<Audience, string> = {
  client: 'Получавате този имейл, защото имате профил в EventAT.',
  partner: 'Получавате този имейл, защото сте партньор в EventAT.',
  team: 'Получавате този имейл, защото сте в екипа на EventAT.',
};
const SETTINGS: Record<Audience, string> = { client: '/akaunt/nastroyki', partner: '/partner/nastroyki', team: '/admin/nastroyki' };

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: #eeecf3; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #2a2340; -webkit-font-smoothing: antialiased; }
.inbox { max-width: 680px; margin: 0 auto; padding: 28px 20px 40px; }
.env { background: #fff; border: 1px solid #e7e7ec; border-radius: 14px; padding: 16px 20px; margin-bottom: 18px; }
.env-subj { font-size: 17px; font-weight: 600; color: #2a2340; }
.env-row { display: flex; gap: 10px; margin-top: 8px; font-size: 12.5px; color: #6f6a82; }
.env-row b { min-width: 34px; font-weight: 600; color: #8d8499; }
.env-pre { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e7e7ec; font-size: 12.5px; color: #8d8499; }
.env-pre span { color: #b9b1c4; }
.mail { width: 600px; max-width: 100%; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e7e7ec; }
.mail-top { padding: 28px 40px 0; }
.mail-logo { height: 30px; display: block; }
.mail-body { padding: 26px 40px 34px; }
.mail-eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: #7f64ae; }
.mail-h { font-family: Constantia, 'Cormorant Garamond', Georgia, serif; font-weight: 700; font-size: 27px; line-height: 1.2; color: #2a2340; margin: 8px 0 16px; text-wrap: balance; }
.mail-h .num { font-family: Spectral, Constantia, Georgia, serif; }
.mail p { font-size: 15px; line-height: 1.65; margin: 0 0 14px; color: #3d3654; text-wrap: pretty; }
.mail-tbl { width: 100%; border-collapse: collapse; margin: 20px 0 24px; font-size: 14px; }
.mail-tbl td { padding: 10px 0; border-top: 1px solid #e7e7ec; vertical-align: top; }
.mail-tbl tr:last-child td { border-bottom: 1px solid #e7e7ec; }
.mail-tbl td:first-child { color: #8d8499; width: 42%; padding-right: 16px; }
.mail-tbl td:last-child { color: #2a2340; font-weight: 600; font-variant-numeric: lining-nums tabular-nums; }
.mail-btn { display: inline-block; background: #7f64ae; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 13px 26px; border-radius: 10px; }
.mail-note { margin-top: 22px !important; font-size: 13px !important; color: #8d8499 !important; }
.mail-foot { width: 600px; max-width: 100%; margin: 18px auto 0; padding: 0 40px; font-size: 12px; line-height: 1.6; color: #8d8499; text-align: center; text-wrap: balance; }
.mail-foot a { color: #664d92; text-decoration: none; }
.sent { max-width: 640px; margin: 0 auto; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: #f4f0f5; color: #4a4555; }
.badge--success { background: #ecfaf2; color: #0f6a3d; } .badge--warning { background: #fdf6e6; color: #784f06; } .badge--danger { background: #fdedee; color: #7e1d28; }
@media (max-width: 640px) { .inbox { padding: 16px 10px 28px; } .mail-top { padding: 22px 22px 0; } .mail-body { padding: 20px 22px 26px; } .mail-foot { padding: 0 12px; } }
`;

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const u = await currentUser();
  if (!u) return NextResponse.redirect(new URL(`/vhod?next=${encodeURIComponent(`/admin/imeyli/${key}`)}`, req.url));
  if (u.role !== 'admin') return NextResponse.redirect(new URL(u.role === 'partner' ? '/partner' : '/akaunt', req.url));
  const actor = await actorFromUser(u);
  if (!actor.teamRole) return new NextResponse('Not found', { status: 404 });
  const id = new URL(req.url).searchParams.get('id');
  const p = await emailPreview(actor, key, id);
  if (!p) return new NextResponse('<!doctype html><meta charset="utf-8"><div style="padding:60px 20px;text-align:center;color:#8d8499;font-family:sans-serif">Няма такъв имейл.</div>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const from = esc(process.env.EMAIL_FROM ?? 'EventAT <no-reply@eventat.bg>');
  let body: string;
  if (p.kind === 'sample') {
    const m = p.content;
    body = `<div class="env"><div class="env-subj">${t(m.subject)}</div>
<div class="env-row"><b>От</b><span>${from}</span></div><div class="env-row"><b>До</b><span>${esc(p.to)}</span></div>
<div class="env-pre"><span>Преглед в пощата:</span> ${t(m.preheader)}</div></div>
<div class="mail"><div class="mail-top"><img class="mail-logo" src="/assets/eventat-logo.png" alt="EventAT"></div><div class="mail-body">
<div class="mail-eyebrow">${t(m.trigger)}</div><h1 class="mail-h">${nums(m.heading)}</h1>
${m.paragraphs.map(x => `<p>${t(x)}</p>`).join('')}
${m.details?.length ? `<table class="mail-tbl">${m.details.map(([k, v]) => `<tr><td>${t(k)}</td><td>${t(v)}</td></tr>`).join('')}</table>` : ''}
${m.cta ? `<a class="mail-btn" href="${esc(m.cta.href)}">${t(m.cta.label)}</a>` : ''}
${m.note ? `<p class="mail-note">${t(m.note)}</p>` : ''}
</div></div>
<div class="mail-foot">${WHY[p.audience]} ${p.optional ? `Може да го изключите от <a href="${SETTINGS[p.audience]}">настройките за известия</a>.` : 'Това е служебно съобщение и не може да бъде изключено.'}<br>Въпроси: <a href="mailto:help@eventat.bg">help@eventat.bg</a> · EventAT</div>`;
  } else {
    const inner = /<body[^>]*>([\s\S]*)<\/body>/i.exec(p.html)?.[1] ?? p.html;
    const st = OUTBOX_STATUS[p.status] ?? OUTBOX_STATUS.queued;
    body = `<div class="env"><div class="env-subj">${esc(p.subject)}</div>
<div class="env-row"><b>От</b><span>${from}</span></div><div class="env-row"><b>До</b><span>${esc(p.to)}</span></div>
<div class="env-pre"><span>${esc(dateTime(p.at))}</span> <span class="badge ${st.cls.replace(' badge--dot', '')}">${esc(st.label)}</span></div></div>
<div class="sent">${inner}</div>`;
  }
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EventAT · ${esc(p.kind === 'sample' ? p.content.subject : p.subject)}</title><base target="_top">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&family=Spectral:wght@700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body><div class="inbox">${body}</div></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
