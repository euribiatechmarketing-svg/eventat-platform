-- A partner's manual blocks never overlap (DATA-MODEL §2.7). Needs btree_gist
-- for the uuid equality inside the gist index. Idempotent.
alter table availability_block drop constraint if exists availability_block_no_overlap;
alter table availability_block add constraint availability_block_no_overlap
  exclude using gist (partner_id with =, daterange(start_date, end_date, '[]') with &&);
