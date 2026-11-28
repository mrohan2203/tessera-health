-- Fix: the row number was assigned (column default) before the chain lock was taken, so two concurrent
-- writers could commit numbers in one order and links in the other, breaking audit.verify(). The number
-- is now taken after the lock, so number order and chain order always agree.
create or replace function audit.chain() returns trigger language plpgsql security definer set search_path = audit, public as $$
declare p text;
begin
  perform pg_advisory_xact_lock(7151771);          -- one writer at a time keeps the chain linear
  new.seq := nextval('audit.log_seq_seq');
  select hash into p from audit.log order by seq desc limit 1;
  new.prev_hash := coalesce(p, repeat('0', 64));
  new.ts := clock_timestamp();
  new.hash := audit.row_digest(new);
  return new;
end $$;
-- The trigger now assigns every number, so the column default would only leave gaps.
alter table audit.log alter column seq drop default;
