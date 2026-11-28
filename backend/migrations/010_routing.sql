-- After an approved role change, the API re-derives that person's care relationships. It needs only
-- each patient's routing fields (department, consults, unit, boards), never identity or clinical data.
create function app.patients_routing() returns table (id text, dept text, consults text[], unit text, on_er boolean, in_ot boolean)
language sql stable security definer set search_path = app as $$
  select p.id, p.dept, p.consults, p.unit,
    exists (select 1 from app.records r where r.coll = 'er' and r.patient_id = p.id),
    exists (select 1 from app.records r where r.coll = 'ot' and r.patient_id = p.id)
  from app.patients p
$$;
revoke all on function app.patients_routing() from public;
grant execute on function app.patients_routing() to tessera_app;
