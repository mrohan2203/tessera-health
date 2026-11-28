-- The privacy reviewer works from pseudonymous tokens and has no care relationship, so row-level
-- security hides the patient row. This returns only the token.
create function app.patient_token(pid text) returns text language sql stable security definer set search_path = app as $$
  select token from app.patients where id = pid
$$;
revoke all on function app.patient_token(text) from public;
grant execute on function app.patient_token(text) to tessera_app;
