// Client invoices (SPEC §9). One invoice for every succeeded charge (deposit
// and balance separately), issued through EventAT in the partner's name
// (‹Документът е издаден през EventAT от името на изпълнителя.›), numbered
// per issuer with no gaps: invoice_sequence is incremented with
// INSERT … ON CONFLICT DO UPDATE … RETURNING inside the charge-success
// transaction, so a rolled-back payment never consumes a number.
// Credit notes (refunds) belong to the refunds module; commission invoices to payouts.
//
// VAT: the legal content must be confirmed before launch (D41). Until then a
// VAT-registered issuer's amount is treated as VAT-inclusive at 20 %; for
// everyone else VAT is 0 and no VAT line prints.
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { booking, category, charge, city, clientInvoiceProfile, invoice, invoiceLine, invoiceSequence, partner, service, user } from '@/db/schema';
import { now } from '@/lib/clock';
import { date, money, sofiaDate } from '@/lib/format';
import type { AnyActor } from './actor';
import { audit } from './audit';
import { LifecycleError, assertClientActor, cardLabel, locationOf, mail, packageNameOf, withTx } from './bookings';

export type InvoiceRow = typeof invoice.$inferSelect;

/** Standard Bulgarian VAT, used only for VAT-registered issuers (D41: to be confirmed). */
export const VAT_RATE_BP = 2_000;

/** 412 → ‹0000000412› (10 digits, SPEC §9 Numbering). */
export function formatInvoiceNumber(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1 || n > 9_999_999_999) throw new Error(`Invoice number out of range: ${n}`);
  return String(n).padStart(10, '0');
}

/** The next number of an issuer's sequence, inside the caller's transaction (row-locked until commit: no gaps, no duplicates). */
export async function nextInvoiceNumber(tx: Queryable, issuerKey: string): Promise<string> {
  const [r] = await tx.insert(invoiceSequence).values({ issuerKey, lastNumber: 1 })
    .onConflictDoUpdate({ target: invoiceSequence.issuerKey, set: { lastNumber: sql`${invoiceSequence.lastNumber} + 1` } })
    .returning({ n: invoiceSequence.lastNumber });
  return formatInvoiceNumber(r.n);
}

/** ‹Карта Visa •••• 4242› / ‹Банков превод›. */
function paymentNote(c: typeof charge.$inferSelect): string {
  if (c.method === 'bank_transfer') return 'Банков превод';
  const card = cardLabel(c.cardBrand, c.cardLast4);
  return card ? `Карта ${card}` : 'Карта';
}

/**
 * Issue the client invoice for a succeeded charge, in the partner's name, with
 * the issuer and recipient snapshotted (the client's ‹Данни за фактура› at the
 * moment of payment). Idempotent per charge: a second call returns the first invoice.
 */
export async function issueClientInvoice(tx: Tx, chargeId: string): Promise<InvoiceRow> {
  const [existing] = await tx.select().from(invoice).where(and(eq(invoice.chargeId, chargeId), eq(invoice.type, 'invoice'))).limit(1);
  if (existing) return existing;
  const [c] = await tx.select().from(charge).where(eq(charge.id, chargeId)).limit(1);
  if (!c || !['succeeded', 'partially_refunded', 'refunded'].includes(c.status) || !c.succeededAt) {
    throw new LifecycleError('invalid_state', 'Only a succeeded charge is invoiced');
  }
  const [b] = await tx.select().from(booking).where(eq(booking.id, c.bookingId)).limit(1);
  const [p] = await tx.select().from(partner).where(eq(partner.id, b.partnerId)).limit(1);
  const [pCity] = p.cityId ? await tx.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)).limit(1) : [];
  const [bCity] = b.cityId ? await tx.select({ name: city.name }).from(city).where(eq(city.id, b.cityId)).limit(1) : [];
  const [svc] = b.serviceId ? await tx.select({ categoryId: service.categoryId }).from(service).where(eq(service.id, b.serviceId)).limit(1) : [];
  const [cat] = await tx.select({ name: category.name }).from(category).where(eq(category.id, svc?.categoryId ?? p.primaryCategoryId ?? '00000000-0000-0000-0000-000000000000')).limit(1);
  const [u] = await tx.select({ name: user.name, email: user.email, phone: user.phone }).from(user).where(eq(user.id, b.clientId)).limit(1);
  const [ip] = await tx.select().from(clientInvoiceProfile).where(eq(clientInvoiceProfile.userId, b.clientId)).limit(1);

  const total = c.amountCents;
  const vatRate = p.vatRegistered ? VAT_RATE_BP : 0;
  const subtotal = vatRate ? Math.floor((total * 10_000 + Math.floor((10_000 + vatRate) / 2)) / (10_000 + vatRate)) : total;
  const paidOn = sofiaDate(c.succeededAt);
  const number = await nextInvoiceNumber(tx, p.id);
  const company = ip?.recipientType === 'company';
  const [inv] = await tx.insert(invoice).values({
    type: 'invoice', issuerType: 'partner', issuerKey: p.id, number, partnerId: p.id, bookingId: b.id, chargeId: c.id,
    issuerLegalName: p.legalName ?? p.businessName, issuerEik: p.eik, issuerVatNumber: p.vatRegistered ? p.vatNumber : null,
    issuerAddress: p.registeredAddress, issuerManager: p.managerName, issuerEmail: p.notificationEmail, issuerCity: pCity?.name ?? null,
    recipientType: company ? 'company' : 'individual',
    recipientName: ip?.name ?? u.name, recipientCompany: company ? ip!.companyName : null, recipientEik: company ? ip!.eik : null,
    recipientMol: company ? ip!.mol : null, recipientAddress: ip?.address ?? null, recipientEmail: u.email, recipientPhone: u.phone,
    issuedOn: paidOn, paidOn, place: pCity?.name ?? '', currency: 'EUR',
    subtotalCents: subtotal, vatCents: total - subtotal, totalCents: total, paymentNote: paymentNote(c), status: 'issued',
    createdAt: await now(),
  }).returning();
  await tx.insert(invoiceLine).values({
    invoiceId: inv.id, position: 1,
    description: [b.serviceTitle, cat?.name].filter(Boolean).join(' · '),
    detail: `${date(b.eventDate)} · ${locationOf(b, bCity?.name)} · ${b.guests} гости`,
    quantity: 1, unitPriceCents: subtotal, totalCents: subtotal, vatRateBp: vatRate,
  });
  return inv;
}

/** `client-invoice` for an invoice (after payment, and on ‹Изпрати по имейл›). */
export async function sendInvoiceEmail(tx: Tx, invoiceId: string, dedupeKey: string): Promise<boolean> {
  const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
  if (!inv?.bookingId) return false;
  const [b] = await tx.select().from(booking).where(eq(booking.id, inv.bookingId)).limit(1);
  const [u] = await tx.select({ email: user.email }).from(user).where(eq(user.id, b.clientId)).limit(1);
  const [p] = await tx.select({ primaryCategoryId: partner.primaryCategoryId }).from(partner).where(eq(partner.id, b.partnerId)).limit(1);
  const [cat] = p?.primaryCategoryId ? await tx.select({ name: category.name }).from(category).where(eq(category.id, p.primaryCategoryId)).limit(1) : [];
  return mail(tx, {
    key: 'client-invoice', to: u.email, toUserId: b.clientId, dedupeKey,
    vars: {
      bookingId: b.number, bookingNo: b.number, invoiceNo: inv.number, issuedOn: date(inv.issuedOn),
      partnerLegalName: inv.issuerLegalName ?? '', partnerEik: inv.issuerEik ?? '',
      recipientName: inv.recipientType === 'company' ? (inv.recipientCompany ?? inv.recipientName ?? '') : (inv.recipientName ?? ''),
      packageName: packageNameOf(b.serviceTitle), partnerCategory: cat?.name ?? '', amount: money(inv.totalCents),
      paymentMethod: (inv.paymentNote ?? '').replace(/^Карта\s+/, ''),
    },
  });
}

export type InvoiceView = InvoiceRow & { lines: (typeof invoiceLine.$inferSelect)[] };

/** /akaunt/rezervacii/[nomer]/faktura: the invoices (and credit notes) of the client's own booking. */
export async function listBookingInvoices(actor: AnyActor, number: string, q: Queryable = db): Promise<InvoiceView[]> {
  assertClientActor(actor);
  const [b] = await q.select({ id: booking.id, clientId: booking.clientId }).from(booking).where(eq(booking.number, number)).limit(1);
  if (!b || b.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const invs = await q.select().from(invoice).where(eq(invoice.bookingId, b.id)).orderBy(asc(invoice.createdAt));
  const out: InvoiceView[] = [];
  for (const inv of invs) {
    out.push({ ...inv, lines: await q.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, inv.id)).orderBy(asc(invoiceLine.position)) });
  }
  return out;
}

/** ‹Изпрати по имейл› → `client-invoice` again (toast ‹Изпратихме документа на имейла ви›). Default: the latest invoice. */
export async function resend(actor: AnyActor, input: { number: string; invoiceNumber?: string }, tx?: Tx): Promise<void> {
  assertClientActor(actor);
  return withTx(tx, async t => {
    const invs = await listBookingInvoices(actor, input.number, t);
    const pick = input.invoiceNumber ? invs.find(i => i.number === input.invoiceNumber) : invs.filter(i => i.type === 'invoice').at(-1);
    if (!pick) throw new LifecycleError('not_found', 'No invoice');
    const at = await now();
    await sendInvoiceEmail(t, pick.id, `invoice:${pick.id}:resend:${at.getTime()}`);
    await audit(t, { actor, action: 'invoice.resent', entity: 'invoice', entityId: pick.id, data: { number: pick.number } });
  });
}
export const resendInvoice = resend;
