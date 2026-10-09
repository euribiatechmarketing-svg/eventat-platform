// ‹Фактура› (client/invoice.html → SCREENS §4 /akaunt/rezervacii/[nomer]/faktura?f=).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Crumbs } from '@/components/client-booking/parts';
import { SubmitButton } from '@/components/client-booking/SubmitButton';
import { ToastLink } from '@/components/client-booking/ToastLink';
import { listBookingInvoices } from '@/lib/domain/invoices';
import { bookingExtras } from '@/lib/domain/views-client-booking';
import { invoiceDocHtml, invoiceKind } from '@/lib/client-booking/invoice-doc';
import { numberParam, one, orNotFound, requireClient } from '@/lib/client-booking/guard';
import { resendInvoiceAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Фактура' };

export default async function InvoicePage({ params, searchParams }: {
  params: Promise<{ nomer: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { nomer } = await params;
  const sp = await searchParams;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const f = one(sp.f);
  const { actor } = await requireClient(`/akaunt/rezervacii/${n}/faktura${f ? `?f=${encodeURIComponent(f)}` : ''}`);
  const invs = await orNotFound(listBookingInvoices(actor, number));
  if (!invs.length) redirect(`/akaunt/rezervacii/${n}`);
  const inv = invs.find(i => i.number === f) ?? invs.filter(i => i.type === 'invoice').at(-1) ?? invs.at(-1)!;
  const x = await bookingExtras(actor, number);

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: 'Моите резервации', href: '/akaunt/rezervacii' }, { label: `${invoiceKind(inv)} № ${inv.number}` }]} />
      <div className="h-row">
        <div>
          <h1 className="h-page">{invoiceKind(inv)}</h1>
          <p className="h-sub">Резервация № {number} · {x.partner.name}</p>
        </div>
        <div className="h-right">
          <ToastLink className="btn btn--primary btn--sm" href={`/api/invoices/${inv.id}`} message="Файлът се изтегля" newTab>Свали PDF</ToastLink>
          <form action={resendInvoiceAction}>
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="invoice" value={inv.number} />
            <SubmitButton className="btn btn--outline btn--sm">Изпрати по имейл</SubmitButton>
          </form>
        </div>
      </div>

      {invs.length > 1 && (
        <nav className="tab-bar" style={{ marginBottom: 18 }}>
          {invs.map(i => (
            <Link key={i.id} className={`tab-bar-item${i.id === inv.id ? ' is-active' : ''}`} href={`/akaunt/rezervacii/${n}/faktura?f=${i.number}`} aria-current={i.id === inv.id ? 'page' : undefined}>
              {invoiceKind(i)} № {i.number}
            </Link>
          ))}
        </nav>
      )}

      <div dangerouslySetInnerHTML={{ __html: invoiceDocHtml(inv) }} />
    </div>
  );
}
