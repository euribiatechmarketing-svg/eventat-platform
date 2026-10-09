// ‹Свали PDF› (SCREENS §4 invoice page): the invoice as a printable page that
// opens the browser's print dialog (save as PDF). Only the booking's client,
// the issuing partner, or a team member may open it.
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { booking, invoice, invoiceLine } from '@/db/schema';
import { actorFromUser } from '@/lib/domain/actor';
import { listBookingInvoices } from '@/lib/domain/invoices';
import { invoicePrintHtml } from '@/lib/client-booking/invoice-doc';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await currentUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [row] = await db.select({ inv: invoice, b: booking }).from(invoice).innerJoin(booking, eq(booking.id, invoice.bookingId)).where(eq(invoice.id, id)).limit(1);
  if (!row) return new Response('Not found', { status: 404 });
  const actor = await actorFromUser(u);
  const allowed = (actor.role === 'client' && row.b.clientId === actor.userId)
    || (actor.role === 'partner' && actor.partnerId === row.b.partnerId)
    || (actor.role === 'admin' && !!actor.teamRole);
  if (!allowed) return new Response('Not found', { status: 404 });
  // The client's own view model (lines included); team and partner read the same document.
  const view = actor.role === 'client'
    ? (await listBookingInvoices(actor, row.b.number)).find(i => i.id === id)
    : { ...row.inv, lines: await db.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, id)).orderBy(asc(invoiceLine.position)) };
  if (!view) return new Response('Not found', { status: 404 });
  return new Response(invoicePrintHtml(view, row.b.number), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="faktura-${view.number}.html"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
