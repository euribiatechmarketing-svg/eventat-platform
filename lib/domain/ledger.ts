// The double-entry ledger (SPEC §7.5). Every money movement is one
// ledger_transaction whose ledger_entry lines balance. Lines carry the
// booking and partner dimensions. The ledger mirrors what the payment
// provider holds and pays; it never moves money itself.
//
// Accounts and their normal side:
//   provider_held       asset      money the provider holds for bookings
//   client_funds        liability  client money not yet earned by the partner
//   partner_payable     liability  released to the partner, not paid out
//   partner_receivable  asset      owed by the partner
//   commission_revenue  income     EventAT's commission
//   platform_cash       asset      EventAT's own balance at the provider (application fees)
//
// Balance enforcement is twofold: postTransaction() validates before writing,
// and a deferred constraint trigger (db/sql/010_ledger.sql) rejects any
// unbalanced transaction at COMMIT, whoever wrote it. The ledger is append-only.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Queryable } from '@/db';
import { ledgerAccount, ledgerEntry, ledgerTransaction, type LedgerAccount, type LedgerTxnKind } from '@/db/schema';
import { now } from '@/lib/clock';

export type { LedgerAccount, LedgerTxnKind };
export const LEDGER_ACCOUNTS = ledgerAccount.enumValues;

/** Which side increases each account. Balances are reported on this side (positive = normal). */
export const NORMAL_SIDE: Record<LedgerAccount, 'debit' | 'credit'> = {
  provider_held: 'debit',
  client_funds: 'credit',
  partner_payable: 'credit',
  partner_receivable: 'debit',
  commission_revenue: 'credit',
  platform_cash: 'debit',
};

/** One line: exactly one of debit / credit, a positive integer number of cents. */
export type LedgerLine = {
  account: LedgerAccount;
  debit?: number;
  credit?: number;
  /** Defaults to the transaction's partnerId; pass null to leave the dimension empty. */
  partnerId?: string | null;
  /** Defaults to the transaction's bookingId; pass null to leave the dimension empty. */
  bookingId?: string | null;
};

export type PostTransactionArgs = {
  kind: LedgerTxnKind;
  bookingId?: string | null;
  partnerId?: string | null;
  chargeId?: string | null;
  refundId?: string | null;
  payoutItemId?: string | null;
  description?: string;
  /** Business time of the movement; default now(). */
  occurredAt?: Date;
  createdBy?: string | null;
  lines: LedgerLine[];
};

export class LedgerError extends Error {
  constructor(message: string) { super(message); this.name = 'LedgerError'; }
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** Pure validation of a posting's lines: ≥ 2 lines, one positive side each, Σ debit = Σ credit. */
export function validateLines(lines: LedgerLine[]): { debit: number; credit: number } {
  if (lines.length < 2) throw new LedgerError('A posting needs at least two lines');
  let debit = 0, credit = 0;
  for (const [i, l] of lines.entries()) {
    if (!LEDGER_ACCOUNTS.includes(l.account)) throw new LedgerError(`Line ${i}: unknown account ${String(l.account)}`);
    const hasD = l.debit !== undefined && l.debit !== 0, hasC = l.credit !== undefined && l.credit !== 0;
    if (hasD === hasC) throw new LedgerError(`Line ${i} (${l.account}): exactly one of debit / credit must be set`);
    const amount = hasD ? l.debit : l.credit;
    if (!isCents(amount)) throw new LedgerError(`Line ${i} (${l.account}): amount must be a positive integer number of cents, got ${amount}`);
    if (hasD) debit += amount; else credit += amount;
  }
  if (debit !== credit) throw new LedgerError(`Unbalanced posting: debit ${debit} ≠ credit ${credit}`);
  return { debit, credit };
}

/**
 * Write one balanced posting inside the caller's transaction. After writing it
 * checks the per-booking `client_funds ≥ 0` and per-partner `partner_payable ≥ 0`
 * invariants for the dimensions it touched, so a bad posting fails the whole
 * business transaction.
 */
export async function postTransaction(tx: Queryable, a: PostTransactionArgs): Promise<{ id: string }> {
  validateLines(a.lines);
  const [t] = await tx.insert(ledgerTransaction).values({
    kind: a.kind,
    bookingId: a.bookingId ?? null,
    chargeId: a.chargeId ?? null,
    refundId: a.refundId ?? null,
    payoutItemId: a.payoutItemId ?? null,
    occurredAt: a.occurredAt ?? (await now()),
    description: a.description ?? '',
    createdBy: a.createdBy ?? null,
  }).returning({ id: ledgerTransaction.id });
  const rows = a.lines.map(l => ({
    transactionId: t.id,
    account: l.account,
    partnerId: l.partnerId === undefined ? (a.partnerId ?? null) : l.partnerId,
    bookingId: l.bookingId === undefined ? (a.bookingId ?? null) : l.bookingId,
    debitCents: l.debit ?? 0,
    creditCents: l.credit ?? 0,
  }));
  await tx.insert(ledgerEntry).values(rows);

  const bookings = [...new Set(rows.filter(r => r.account === 'client_funds' && r.bookingId).map(r => r.bookingId!))];
  const partners = [...new Set(rows.filter(r => r.account === 'partner_payable' && r.partnerId).map(r => r.partnerId!))];
  const negFunds = bookings.length ? await negativeClientFunds(tx, bookings) : [];
  if (negFunds.length) throw new LedgerError(`client_funds would go negative for booking ${negFunds[0].bookingId} (${negFunds[0].balance})`);
  const negPayable = partners.length ? await negativePartnerPayable(tx, partners) : [];
  if (negPayable.length) throw new LedgerError(`partner_payable would go negative for partner ${negPayable[0].partnerId} (${negPayable[0].balance})`);
  return t;
}

/** Signed balance expression on the account's normal side. */
const normalBalance = sql<number>`coalesce(sum(case when ${ledgerEntry.account} in ('provider_held', 'partner_receivable', 'platform_cash')
  then ${ledgerEntry.debitCents} - ${ledgerEntry.creditCents}
  else ${ledgerEntry.creditCents} - ${ledgerEntry.debitCents} end), 0)::bigint`.mapWith(Number);

/** Balance of one account (normal side), optionally restricted to a booking and/or partner dimension. */
export async function accountBalance(tx: Queryable, account: LedgerAccount, dims: { bookingId?: string; partnerId?: string } = {}): Promise<number> {
  const conds = [eq(ledgerEntry.account, account)];
  if (dims.bookingId) conds.push(eq(ledgerEntry.bookingId, dims.bookingId));
  if (dims.partnerId) conds.push(eq(ledgerEntry.partnerId, dims.partnerId));
  const [r] = await tx.select({ balance: normalBalance }).from(ledgerEntry).where(and(...conds));
  return r?.balance ?? 0;
}

async function balancesBy(tx: Queryable, dim: 'bookingId' | 'partnerId', id: string): Promise<Record<LedgerAccount, number>> {
  const rows = await tx.select({ account: ledgerEntry.account, balance: normalBalance }).from(ledgerEntry)
    .where(eq(ledgerEntry[dim], id)).groupBy(ledgerEntry.account);
  const out = Object.fromEntries(LEDGER_ACCOUNTS.map(a => [a, 0])) as Record<LedgerAccount, number>;
  for (const r of rows) out[r.account] = r.balance;
  return out;
}

/** Every account's balance on one booking's lines. `client_funds` = money still held for it. */
export const bookingBalances = (tx: Queryable, bookingId: string) => balancesBy(tx, 'bookingId', bookingId);

/** Every account's balance on one partner's lines. `partner_payable` = released, not yet paid out. */
export const partnerBalances = (tx: Queryable, partnerId: string) => balancesBy(tx, 'partnerId', partnerId);

// ── Invariants (SPEC §7.5), callable from tests and admin checks ──────────

/** Transactions whose entries do not balance (or have fewer than two lines). Should always be empty. */
export async function unbalancedTransactions(tx: Queryable): Promise<{ transactionId: string; debit: number; credit: number; lines: number }[]> {
  const rows = await tx.execute<{ id: string; debit: string; credit: string; lines: string }>(sql`
    select t.id, coalesce(sum(e.debit_cents), 0) as debit, coalesce(sum(e.credit_cents), 0) as credit, count(e.id) as lines
    from ledger_transaction t left join ledger_entry e on e.transaction_id = t.id
    group by t.id
    having coalesce(sum(e.debit_cents), 0) <> coalesce(sum(e.credit_cents), 0) or count(e.id) < 2`);
  return rows.map(r => ({ transactionId: r.id, debit: Number(r.debit), credit: Number(r.credit), lines: Number(r.lines) }));
}

/** Bookings whose client_funds balance is negative (all bookings, or just `bookingIds`). */
export async function negativeClientFunds(tx: Queryable, bookingIds?: string[]): Promise<{ bookingId: string; balance: number }[]> {
  const conds = [eq(ledgerEntry.account, 'client_funds'), sql`${ledgerEntry.bookingId} is not null`];
  if (bookingIds) conds.push(inArray(ledgerEntry.bookingId, bookingIds));
  const rows = await tx.select({ bookingId: ledgerEntry.bookingId, balance: normalBalance }).from(ledgerEntry)
    .where(and(...conds)).groupBy(ledgerEntry.bookingId).having(sql`${normalBalance} < 0`);
  return rows.map(r => ({ bookingId: r.bookingId!, balance: r.balance }));
}

/** Partners whose partner_payable balance is negative (all partners, or just `partnerIds`). */
export async function negativePartnerPayable(tx: Queryable, partnerIds?: string[]): Promise<{ partnerId: string; balance: number }[]> {
  const conds = [eq(ledgerEntry.account, 'partner_payable'), sql`${ledgerEntry.partnerId} is not null`];
  if (partnerIds) conds.push(inArray(ledgerEntry.partnerId, partnerIds));
  const rows = await tx.select({ partnerId: ledgerEntry.partnerId, balance: normalBalance }).from(ledgerEntry)
    .where(and(...conds)).groupBy(ledgerEntry.partnerId).having(sql`${normalBalance} < 0`);
  return rows.map(r => ({ partnerId: r.partnerId!, balance: r.balance }));
}

/** Σ provider_held: must equal what the provider reports for the platform plus its connected accounts. */
export const providerHeldTotal = (tx: Queryable) => accountBalance(tx, 'provider_held');

/** Every SPEC §7.5 invariant; returns human-readable violations (empty = healthy). */
export async function checkLedgerInvariants(tx: Queryable, opts: { providerReportedCents?: number } = {}): Promise<string[]> {
  const out: string[] = [];
  for (const u of await unbalancedTransactions(tx)) out.push(`transaction ${u.transactionId} unbalanced: debit ${u.debit}, credit ${u.credit}, ${u.lines} lines`);
  for (const b of await negativeClientFunds(tx)) out.push(`booking ${b.bookingId}: client_funds ${b.balance} < 0`);
  for (const p of await negativePartnerPayable(tx)) out.push(`partner ${p.partnerId}: partner_payable ${p.balance} < 0`);
  if (opts.providerReportedCents !== undefined) {
    const held = await providerHeldTotal(tx);
    if (held !== opts.providerReportedCents) out.push(`provider_held ${held} ≠ provider reported ${opts.providerReportedCents}`);
  }
  return out;
}

export async function assertLedgerInvariants(tx: Queryable, opts?: { providerReportedCents?: number }): Promise<void> {
  const v = await checkLedgerInvariants(tx, opts);
  if (v.length) throw new LedgerError(`Ledger invariants violated:\n${v.join('\n')}`);
}
