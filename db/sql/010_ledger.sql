-- Double-entry ledger guards (SPEC §7.5). Idempotent: re-applied by db:reset,
-- the test template and db:migrate.
--
-- 1. Every ledger_transaction balances: Σ debit = Σ credit over its entries,
--    with at least two entries. Checked at COMMIT (deferred constraint
--    triggers), so the lines of one posting can be inserted one by one.
-- 2. The ledger is append-only: corrections are new `adjustment` postings.

create or replace function ledger_check_transaction(txn uuid) returns void
language plpgsql as $$
declare
  d bigint;
  c bigint;
  n integer;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*)
    into d, c, n
    from ledger_entry where transaction_id = txn;
  if n < 2 then
    raise exception 'ledger transaction % has % entries; a posting needs at least two', txn, n
      using errcode = '23514';
  end if;
  if d <> c then
    raise exception 'ledger transaction % is unbalanced: debit % <> credit %', txn, d, c
      using errcode = '23514';
  end if;
end $$;

create or replace function ledger_entry_balanced_trg() returns trigger
language plpgsql as $$
begin
  perform ledger_check_transaction(new.transaction_id);
  return null;
end $$;

create or replace function ledger_transaction_balanced_trg() returns trigger
language plpgsql as $$
begin
  perform ledger_check_transaction(new.id);
  return null;
end $$;

drop trigger if exists ledger_entry_balanced on ledger_entry;
create constraint trigger ledger_entry_balanced
  after insert on ledger_entry
  deferrable initially deferred
  for each row execute function ledger_entry_balanced_trg();

drop trigger if exists ledger_transaction_balanced on ledger_transaction;
create constraint trigger ledger_transaction_balanced
  after insert on ledger_transaction
  deferrable initially deferred
  for each row execute function ledger_transaction_balanced_trg();

create or replace function ledger_append_only_trg() returns trigger
language plpgsql as $$
begin
  raise exception 'the ledger is append-only (% on %): post an adjustment instead', tg_op, tg_table_name
    using errcode = '55000';
end $$;

drop trigger if exists ledger_entry_append_only on ledger_entry;
create trigger ledger_entry_append_only
  before update or delete on ledger_entry
  for each row execute function ledger_append_only_trg();

drop trigger if exists ledger_transaction_append_only on ledger_transaction;
create trigger ledger_transaction_append_only
  before update or delete on ledger_transaction
  for each row execute function ledger_append_only_trg();
