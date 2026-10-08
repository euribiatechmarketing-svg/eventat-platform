// Renders an EmailContent to inbox-safe HTML (tables + inline styles, 600 px)
// and a plain-text alternative. Mirrors the prototype's emails/email.html.
import type { Audience, EmailContent } from './types';

const C = {
  bg: '#f4f0f5', card: '#ffffff', line: '#ece7f1', ink: '#2a2340', body: '#3d3654',
  muted: '#8d8499', brand: '#7f64ae', link: '#664d92',
};

const WHY: Record<Audience, string> = {
  client: 'Получавате този имейл, защото имате профил в EventAT.',
  partner: 'Получавате този имейл, защото сте партньор в EventAT.',
  team: 'Получавате този имейл, защото сте в екипа на EventAT.',
};
const SETTINGS: Record<Audience, string> = {
  client: '/akaunt/nastroyki', partner: '/partner/nastroyki', team: '/admin/nastroyki',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Keep a number with its thousands and with the unit after it. */
function tie(s: string): string {
  return s.replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ').replace(/(\d) (?=[€%а-яА-Я])/g, '$1 ');
}
const t = (s: string) => esc(tie(s));

function abs(appUrl: string, href: string): string {
  return /^https?:/.test(href) ? href : appUrl.replace(/\/$/, '') + (href.startsWith('/') ? href : '/' + href);
}

export function renderEmail(m: EmailContent, audience: Audience, optional: boolean, appUrl: string): { html: string; text: string } {
  const font = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
  const serif = "Constantia,'Cormorant Garamond',Georgia,serif";
  const details = m.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0 24px;font-size:14px;">${m.details
        .map(([k, v], i, a) => `<tr><td style="padding:10px 16px 10px 0;border-top:1px solid ${C.line};${i === a.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}color:${C.muted};width:42%;vertical-align:top;">${t(k)}</td><td style="padding:10px 0;border-top:1px solid ${C.line};${i === a.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}color:${C.ink};font-weight:600;vertical-align:top;">${t(v)}</td></tr>`)
        .join('')}</table>`
    : '';
  const cta = m.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0;"><tr><td style="background:${C.brand};border-radius:10px;"><a href="${esc(abs(appUrl, m.cta.href))}" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;font-family:${font};">${t(m.cta.label)}</a></td></tr></table>`
    : '';
  const note = m.note ? `<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:${C.muted};">${t(m.note)}</p>` : '';
  const foot = `${WHY[audience]} ${optional
    ? `Може да го изключите от <a href="${esc(abs(appUrl, SETTINGS[audience]))}" style="color:${C.link};text-decoration:none;">настройките за известия</a>.`
    : 'Това е служебно съобщение и не може да бъде изключено.'}<br>Въпроси: <a href="mailto:help@eventat.bg" style="color:${C.link};text-decoration:none;">help@eventat.bg</a> · EventAT`;

  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${t(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:16px;font-family:${font};">
<tr><td style="padding:28px 40px 0;"><img src="${esc(abs(appUrl, '/assets/eventat-logo.png'))}" alt="EventAT" height="30" style="display:block;height:30px;border:0;"></td></tr>
<tr><td style="padding:26px 40px 34px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:${C.brand};">${t(m.trigger)}</div>
<h1 style="font-family:${serif};font-weight:700;font-size:27px;line-height:1.2;color:${C.ink};margin:8px 0 16px;">${t(m.heading).replace(/(\d+)/g, `<span style="font-family:Spectral,Georgia,serif;">$1</span>`)}</h1>
${m.paragraphs.map(p => `<p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${C.body};">${t(p)}</p>`).join('')}
${details}${cta}${note}
</td></tr></table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;"><tr><td style="padding:18px 40px 0;font-family:${font};font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">${foot}</td></tr></table>
</td></tr></table></body></html>`;

  const text = [
    m.heading, '',
    ...m.paragraphs.flatMap(p => [p, '']),
    ...(m.details?.map(([k, v]) => `${k}: ${v}`) ?? []),
    ...(m.details?.length ? [''] : []),
    ...(m.cta ? [`${m.cta.label}: ${abs(appUrl, m.cta.href)}`, ''] : []),
    ...(m.note ? [m.note, ''] : []),
    '—', WHY[audience], 'Въпроси: help@eventat.bg',
  ].join('\n');
  return { html, text };
}
