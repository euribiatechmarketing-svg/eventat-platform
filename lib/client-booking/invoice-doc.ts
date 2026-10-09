import 'server-only';
// The invoice document (client/invoice.html `.inv-doc`) as one HTML string, so
// the page and the printable file (/api/invoices/[id], ‹Свали PDF›) show the
// very same document. Every value is escaped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InvoiceView } from '@/lib/domain/invoices';
import { phoneDisplay } from '@/lib/domain/bookings';
import { numericDate } from '@/lib/domain/views-client-booking';
import { moneyShort } from '@/lib/format';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (s: string) => esc(s).replace(/(\d[\d  .,:–-]*\d|\d)/g, '<span class="num">$1</span>');

export const invoiceKind = (inv: Pick<InvoiceView, 'type'>) => (inv.type === 'credit_note' ? 'Кредитно известие' : 'Фактура');

export function invoiceDocHtml(inv: InvoiceView): string {
  const company = inv.recipientType === 'company';
  const issuer = [
    inv.issuerEik ? `ЕИК <b>${esc(inv.issuerEik)}</b>` : '',
    inv.issuerVatNumber ? `ДДС № <b>${esc(inv.issuerVatNumber)}</b>` : '',
    esc(inv.issuerAddress ?? (inv.issuerCity ? `гр. ${inv.issuerCity}` : '')),
    [inv.issuerManager ? `Управител: ${esc(inv.issuerManager)}` : '', esc(inv.issuerEmail ?? '')].filter(Boolean).join(' · '),
  ].filter(Boolean).join('<br />');
  const recipient = company
    ? [
      inv.recipientEik ? `ЕИК <b>${esc(inv.recipientEik)}</b>` : '',
      inv.recipientMol ? `МОЛ: ${esc(inv.recipientMol)}` : '',
      esc(inv.recipientAddress ?? ''),
      esc(inv.recipientEmail ?? ''),
    ].filter(Boolean).join('<br />')
    : [
      esc(inv.recipientAddress ?? ''),
      esc(inv.recipientEmail ?? ''),
      inv.recipientPhone ? `<b>${esc(phoneDisplay(inv.recipientPhone))}</b>` : '',
    ].filter(Boolean).join('<br />');
  const lines = inv.lines.map(l => `
            <tr>
              <td class="inv-c-no">${l.position}</td>
              <td>
                <div class="inv-item-n">${esc(l.description)}</div>
                ${l.detail ? `<div class="inv-item-d">${esc(l.detail)}</div>` : ''}
              </td>
              <td class="inv-c-q" data-l="Количество"><span class="inv-fig">${l.quantity}</span></td>
              <td class="inv-c-p" data-l="Ед. цена"><span class="inv-fig">${esc(moneyShort(l.unitPriceCents))}</span></td>
              <td class="inv-c-s" data-l="Сума"><span class="inv-fig">${esc(moneyShort(l.totalCents))}</span></td>
            </tr>`).join('');
  const paid = inv.type === 'invoice' && inv.paidOn;
  return `
      <article class="inv-doc">
        <div class="inv-top">
          <div>
            <img class="inv-logo" src="/assets/eventat-logo.png" alt="EventAT" />
            <div class="inv-issuer-line">Документът е издаден през EventAT от името на изпълнителя.</div>
          </div>
          <div class="inv-id">
            <div class="inv-kind">${invoiceKind(inv)}</div>
            <div class="inv-no">№ ${esc(inv.number)}</div>
            ${paid ? '<span class="badge badge--success badge--dot">Платена</span>' : ''}
          </div>
        </div>
        <div class="inv-meta">
          <div class="inv-meta-cell"><div class="inv-meta-l">Дата на издаване</div><div class="inv-meta-v">${numericDate(inv.issuedOn)}</div></div>
          <div class="inv-meta-cell"><div class="inv-meta-l">Дата на плащане</div><div class="inv-meta-v">${inv.paidOn ? numericDate(inv.paidOn) : '—'}</div></div>
          <div class="inv-meta-cell"><div class="inv-meta-l">Място на издаване</div><div class="inv-meta-v">${esc(inv.place || '—')}</div></div>
          <div class="inv-meta-cell"><div class="inv-meta-l">Валута</div><div class="inv-meta-v">${esc(inv.currency)}</div></div>
        </div>
        <div class="inv-parties">
          <div class="inv-party">
            <div class="inv-party-l">Издател</div>
            <div class="inv-party-n">${esc(inv.issuerLegalName ?? '')}</div>
            <div class="inv-party-d">${issuer}</div>
          </div>
          <div class="inv-party">
            <div class="inv-party-l">Получател</div>
            <div class="inv-party-n">${esc(company ? inv.recipientCompany ?? inv.recipientName : inv.recipientName)}</div>
            <div class="inv-party-d">${recipient}</div>
          </div>
        </div>
        <div class="cb-inv-scroll">
        <table class="inv-tbl">
          <thead>
            <tr>
              <th class="inv-c-no" scope="col">№</th>
              <th scope="col">Описание</th>
              <th class="inv-c-q" scope="col">Количество</th>
              <th class="inv-c-p" scope="col">Ед. цена</th>
              <th class="inv-c-s" scope="col">Сума</th>
            </tr>
          </thead>
          <tbody>${lines}
          </tbody>
        </table>
        </div>
        <div class="inv-close">
          ${paid ? `<div class="inv-paid">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>
            <div>
              <div class="inv-paid-t">Платена на ${numericDate(inv.paidOn!)} през платформата</div>
              <div class="inv-paid-d">${esc(inv.paymentNote ?? '')}${inv.paymentNote ? '. ' : ''}Сумата се превежда на изпълнителя след провеждането на събитието.</div>
            </div>
          </div>` : '<div style="flex:1"></div>'}
          <div class="inv-sums">
            <div class="inv-sum-row"><span>Сума по услуги</span><b>${esc(moneyShort(inv.subtotalCents))}</b></div>
            ${inv.vatCents > 0 ? `<div class="inv-sum-row"><span>ДДС</span><b>${esc(moneyShort(inv.vatCents))}</b></div>` : ''}
            <div class="inv-total"><span>Общо по фактурата</span><b>${esc(moneyShort(inv.totalCents))}</b></div>
          </div>
        </div>
        <div class="inv-foot">Фактурата е издадена по електронен път и е валидна без подпис и печат.</div>
      </article>`;
}

/** The `:root { … }` custom properties of a stylesheet (app.css holds --app-line and --app-bg). */
const rootVars = (css: string) => /:root\s*\{[^}]*\}/.exec(css)?.[0] ?? '';

/** A standalone, printable page around the document (‹Свали PDF›): the browser's print dialog saves it as PDF. */
export function invoicePrintHtml(inv: InvoiceView, bookingNumber: string): string {
  const root = process.cwd();
  const read = (f: string) => { try { return readFileSync(join(root, 'styles', f), 'utf8'); } catch { return ''; } };
  const css = read('m-client-booking.css');
  const between = (from: string, to: string) => { const i = css.indexOf(from); return i < 0 ? '' : css.slice(i, css.indexOf(to, i)); };
  const invCss = between('/* ---------- client/invoice.html', '/* ====')
    + between('/* ---------- invoice on smaller screens', '/* ---------- end of the invoice');
  const title = `${invoiceKind(inv)} № ${inv.number} · ${bookingNumber}`;
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Spectral:wght@500;700&display=swap" rel="stylesheet" />
<style>
${read('tokens.css')}
${rootVars(read('app.css'))}
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.badge--dot::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge--success { background: var(--success-50); color: var(--success-700); }
.num { font-family: var(--font-num); }
body { margin: 0; padding: 32px; background: #fff; font-family: var(--font-ui); color: var(--text); }
${invCss}
.inv-doc { box-shadow: none; max-width: 1000px; margin: 0 auto; }
@page { size: A4; margin: 12mm; }
@media (max-width: 640px) { body { padding: 12px; } }
@media print { body { padding: 0; } .inv-doc { border: none; border-radius: 0; } }
</style>
</head>
<body>
${invoiceDocHtml(inv)}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script>
</body>
</html>`;
}

export { num as numHtml };
