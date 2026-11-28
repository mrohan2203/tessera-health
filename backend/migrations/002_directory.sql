-- Hospital-wide search for break-the-glass: exact match on a blind index (keyed hash), returning
-- only a minimal, non-identifying header. Runs as owner so it can see rows outside the caller's care,
-- which is why it returns no name, MRN, date of birth or clinical content.
create function app.patients_directory(idx bytea) returns table (id text, token text, age int, sex text, dept text, unit text)
language sql stable security definer set search_path = app as $$
  select id, token, age, sex, dept, unit from app.patients where name_idx = idx or mrn_idx = idx
$$;
revoke all on function app.patients_directory(bytea) from public;
grant execute on function app.patients_directory(bytea) to tessera_app;
