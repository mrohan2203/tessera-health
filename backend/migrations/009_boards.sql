-- Whether a patient is on the emergency board or has a theatre booking, for recomputing care
-- relationships. Reveals two booleans, nothing else.
create function app.patient_boards(pid text) returns table (on_er boolean, in_ot boolean)
language sql stable security definer set search_path = app as $$
  select exists (select 1 from app.records where coll = 'er' and patient_id = pid), exists (select 1 from app.records where coll = 'ot' and patient_id = pid)
$$;
revoke all on function app.patient_boards(text) from public;
grant execute on function app.patient_boards(text) to tessera_app;
