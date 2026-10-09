// ‹Свали PDF› on /admin/rezervacii/[nomer]: the booking summary as a print-ready A4 page that opens
// the browser's print dialog (save as PDF). No PDF library or embeddable Cyrillic font is in the
// project yet, so the browser renders the PDF.
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { BOOKING_BADGE, bookingRecord } from '@/lib/domain/views-admin-money';
import { date, dateTime, money } from '@/lib/format';
import { now } from '@/lib/clock';

const NUMBER_RE = /^\d{4}-\d{4}-[А-ЯA-Z]{2}$/;
const esc = (s: string | null | undefined) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET(req: Request, { params }: { params: Promise<{ nomer: string }> }) {
  const number = decodeURIComponent((await params).nomer);
  const u = await currentUser();
  if (!u) return NextResponse.redirect(new URL(`/vhod?next=${encodeURIComponent(`/admin/rezervacii/${number}`)}`, req.url));
  if (u.role !== 'admin') return NextResponse.redirect(new URL(u.role === 'partner' ? '/partner' : '/akaunt', req.url));
  const actor = await actorFromUser(u);
  if (!actor.teamRole || !NUMBER_RE.test(number)) return new NextResponse('Not found', { status: 404 });
  const r = await bookingRecord(actor, number);
  if (!r) return new NextResponse('Not found', { status: 404 });
  const b = r.booking, m = r.money;
  const printedAt = await now();
  const paid = m.paidCents + m.refundedCents;
  const row = (l: string, v: string | null | undefined, small?: string | null) =>
    v ? `<tr><td>${esc(l)}</td><td>${esc(v)}${small ? `<small>${esc(small)}</small>` : ''}</td></tr>` : '';
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Резервация ${esc(b.number)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.5 Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #2a2340; background: #fff; }
.doc { max-width: 760px; margin: 24px auto; padding: 0 20px; }
.top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #7f64ae; padding-bottom: 14px; margin-bottom: 22px; }
.top img { height: 30px; }
.top .no { text-align: right; font-size: 12px; color: #6f6a82; }
.top .no b { display: block; font-size: 17px; color: #2a2340; letter-spacing: .02em; }
h1 { font: 700 24px/1.2 Georgia, 'Times New Roman', serif; margin: 0 0 4px; }
.sub { color: #6f6a82; margin: 0 0 20px; }
h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8d8499; margin: 22px 0 6px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 7px 0; border-top: 1px solid #ece7f1; vertical-align: top; }
td:first-child { width: 38%; color: #6f6a82; padding-right: 14px; }
td:last-child { font-weight: 600; }
td small { display: block; font-weight: 400; color: #6f6a82; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
.total td { border-top: 2px solid #2a2340; font-size: 15px; }
.foot { margin-top: 28px; font-size: 11px; color: #8d8499; }
@media print { .doc { margin: 0; padding: 0; } }
</style></head><body><div class="doc">
<div class="top"><img src="/assets/eventat-logo.png" alt="EventAT"><div class="no">Резервация №<b>${esc(b.number)}</b>${esc(BOOKING_BADGE[b.status].label)}</div></div>
<h1>${esc(r.event.name)} на ${esc(date(b.eventDate))}</h1>
<p class="sub">${esc([r.event.venue, r.event.locality].filter(Boolean).join(', '))}</p>
<div class="cols">
<div><h2>Клиент</h2><table>${row('Име', r.client.name, r.client.role)}${row('Имейл', r.client.email)}${row('Телефон', r.client.phone)}</table></div>
<div><h2>Изпълнител</h2><table>${row('Име', r.partner.name, r.partner.role)}${row('Контакт', r.partner.contactName)}${row('Имейл', r.partner.email)}${row('ЕИК', r.partner.eik)}</table></div>
</div>
<h2>Събитието</h2><table>
${row('Събитие', r.event.name, r.event.guests)}${row('Дата и час', r.event.date, r.event.when)}${row('Локация', r.event.venue, r.event.locality)}
${row('Услуга', r.event.service, r.event.serviceSummary)}${row('Анулиране', r.event.policy, r.event.policyNote)}${row('Резервация №', b.number, r.event.origin)}
</table>
<h2>Пари</h2><table>
${row(m.serviceTitle, money(m.amountCents))}${row('Такса резервация', money(m.feeCents))}${row('Платено от клиента', money(paid), m.paidAtLong ? `${m.paidAtLong}${m.card ? ` · ${m.card}` : ''}` : null)}
${m.refundedCents ? row('Върнати', `− ${money(m.refundedCents)}`) : ''}
${m.commission && !['cancelled', 'payment_expired', 'approval_withdrawn'].includes(b.status) ? `${row(`Комисиона (${m.commission.pct})`, `− ${money(m.commission.cents)}`)}<tr class="total"><td>За изплащане</td><td>${esc(money(m.commission.partnerCents))}</td></tr>` : ''}
${row('Задържано до', m.holdUntil, 'денят след събитието')}${row('Партида', m.batchDate, 'първата след събитието')}
</table>
<p class="foot">EventAT · ${esc(dateTime(printedAt))}</p>
</div><script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
