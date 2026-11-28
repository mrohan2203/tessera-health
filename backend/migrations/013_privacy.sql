-- The privacy officer works from tokens. Revealing an identity is a separate, audited API step; these
-- functions give the API only what that step needs.
create function app.patients_by_token(t text) returns table (id text) language sql stable security definer set search_path = app as $$
  select id from app.patients where token = t
$$;
create function app.patient_identity(pid text) returns table (dek_wrapped bytea, name_enc bytea, mrn_enc bytea) language sql stable security definer set search_path = app as $$
  select dek_wrapped, name_enc, mrn_enc from app.patients where id = pid
$$;
revoke all on function app.patients_by_token(text), app.patient_identity(text) from public;
grant execute on function app.patients_by_token(text), app.patient_identity(text) to tessera_app;
