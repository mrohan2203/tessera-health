-- Minimal, non-identifying header for the break-the-glass screen (the same fields search returns).
create function app.patient_header(pid text) returns table (id text, token text, age int, sex text, dept text, unit text)
language sql stable security definer set search_path = app as $$
  select id, token, age, sex, dept, unit from app.patients where id = pid
$$;
revoke all on function app.patient_header(text) from public;
grant execute on function app.patient_header(text) to tessera_app;
