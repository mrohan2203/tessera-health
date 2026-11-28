-- Phase 4 support: stable ordering, MRN numbering, and the cross-record schedule check.
alter table app.records add column ord bigserial;
alter table app.ops add column ord bigserial;
create sequence app.mrn_seq start 200000;
grant usage on sequence app.mrn_seq to tessera_app;
grant usage on sequence app.records_ord_seq, app.ops_ord_seq to tessera_app;

-- Double-booking checks need every appointment, including ones for patients outside the caller's
-- view. This returns only appointments, still encrypted; the API decrypts them in memory for the
-- check and sends none of them to the caller.
create function app.appointments_for_check() returns table (key text, patient_id text, body_enc bytea, dek_wrapped bytea)
language sql stable security definer set search_path = app as $$
  select r.key, r.patient_id, r.body_enc, p.dek_wrapped from app.records r join app.patients p on p.id = r.patient_id where r.coll = 'appts'
$$;
revoke all on function app.appointments_for_check() from public;
grant execute on function app.appointments_for_check() to tessera_app;

-- Care relationships follow admission, transfer and discharge (recomputed by the API)
grant delete on app.care_relationships to tessera_app;
