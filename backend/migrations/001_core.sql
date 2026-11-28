-- Tessera Phase 2: security core.
-- Runs as tessera_owner. The API connects as tessera_app, which has no DDL rights, sees patients only
-- through row-level security, and can only INSERT into or SELECT from the audit log.

create schema if not exists app;
create schema if not exists audit;

-- ---------- People and access ----------
create table app.users (
  id text primary key,
  username text not null unique,
  name text not null,
  role text not null,
  dept text, unit text, title text,
  patient_id text,                         -- portal accounts: the one record they may see
  status text not null default 'active' check (status in ('active', 'suspended')),
  password_hash text not null,             -- scrypt
  totp_secret_enc bytea not null,          -- authenticator secret, encrypted with the KEK
  failed_logins int not null default 0,
  locked_until timestamptz
);

create table app.patients (
  id text primary key,
  token text not null unique,              -- pseudonymous token used in audit and analytics
  dek_wrapped bytea not null,              -- per-patient data key, wrapped by the KEK (AWS KMS in production)
  name_enc bytea not null, dob_enc bytea not null, mrn_enc bytea not null,
  phone_enc bytea, member_id_enc bytea, payer_enc bytea,
  clinical_enc bytea not null,             -- problems, allergies, vitals, medications, labs, weight, height
  name_idx bytea not null, mrn_idx bytea not null,   -- keyed hashes (HMAC-SHA256) for exact-match search
  age int, sex text, dept text, consults text[] not null default '{}',
  unit text, bed text, status text, code text, attending text
);

create table app.care_relationships (
  user_id text not null references app.users(id),
  patient_id text not null references app.patients(id),
  kind text not null,                      -- attending-dept, consult, unit, er, ot
  primary key (user_id, patient_id, kind)
);

create table app.btg_grants (
  id bigserial primary key,
  user_id text not null references app.users(id),
  patient_id text not null references app.patients(id),
  reason text not null,
  justification text not null check (length(justification) >= 20),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reviewed_by text references app.users(id),
  reviewed_at timestamptz,
  review_outcome text check (review_outcome in ('appropriate', 'inappropriate'))
);

create table app.sessions (
  id_hash bytea primary key,               -- SHA-256 of the cookie token plus a server pepper; the token itself is never stored
  user_id text not null references app.users(id),
  stage text not null check (stage in ('password', 'active')),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text, ua text
);

-- ---------- Audit: append-only and hash-chained ----------
create table audit.log (
  seq bigserial primary key,
  ts timestamptz not null default clock_timestamp(),
  actor text not null, role text not null, action text not null,
  resource text not null default '', patient_token text not null default '',
  purpose text not null default '', outcome text not null default 'success',
  detail text not null default '', ip text not null default '',
  prev_hash text not null default '', hash text not null default ''
);

create function audit.row_digest(r audit.log) returns text language sql stable as $$
  select encode(public.digest(concat_ws('|', r.prev_hash, r.seq, to_char(r.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    r.actor, r.role, r.action, r.resource, r.patient_token, r.purpose, r.outcome, r.detail, r.ip), 'sha256'), 'hex')
$$;

create function audit.chain() returns trigger language plpgsql security definer set search_path = audit, public as $$
declare p text;
begin
  perform pg_advisory_xact_lock(7151771);          -- one writer at a time keeps the chain linear
  select hash into p from audit.log order by seq desc limit 1;
  new.prev_hash := coalesce(p, repeat('0', 64));
  new.ts := clock_timestamp();
  new.hash := audit.row_digest(new);
  return new;
end $$;
create trigger audit_chain before insert on audit.log for each row execute function audit.chain();

create function audit.refuse() returns trigger language plpgsql as $$
begin raise exception 'audit.log is append-only (% refused)', tg_op; end $$;
create trigger audit_no_update before update or delete on audit.log for each row execute function audit.refuse();
create trigger audit_no_truncate before truncate on audit.log for each statement execute function audit.refuse();

create function audit.verify() returns table (ok boolean, checked bigint, broken_at bigint)
language plpgsql stable security definer set search_path = audit, public as $$
declare r audit.log; prev text := repeat('0', 64); n bigint := 0;
begin
  for r in select * from audit.log order by seq loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> audit.row_digest(r) then
      return query select false, n, r.seq; return;
    end if;
    prev := r.hash;
  end loop;
  return query select true, n, null::bigint;
end $$;

-- Existence check for break-the-glass that reveals nothing about the record.
create function app.patient_exists(pid text) returns boolean language sql stable security definer set search_path = app as $$
  select exists (select 1 from app.patients where id = pid)
$$;

-- ---------- Row-level security: the second least-privilege layer ----------
alter table app.patients enable row level security;
create policy patients_visible on app.patients for select to tessera_app using (
  exists (select 1 from app.care_relationships c where c.patient_id = patients.id and c.user_id = current_setting('app.user_id', true))
  or exists (select 1 from app.btg_grants g where g.patient_id = patients.id and g.user_id = current_setting('app.user_id', true) and g.expires_at > now())
  or (current_setting('app.role', true) = 'patient' and patients.id = current_setting('app.patient_id', true))
  or current_setting('app.role', true) = 'pharmacist'   -- medication profiles only; the API projects the fields
);

-- ---------- Grants ----------
grant usage on schema app, audit to tessera_app;
grant select, update (failed_logins, locked_until) on app.users to tessera_app;
grant select on app.patients, app.care_relationships to tessera_app;
grant select, insert on app.btg_grants to tessera_app;
grant update (reviewed_by, reviewed_at, review_outcome) on app.btg_grants to tessera_app;
grant usage on sequence app.btg_grants_id_seq to tessera_app;
grant select, insert, update (last_seen, revoked_at, stage, expires_at) on app.sessions to tessera_app;
grant select, insert on audit.log to tessera_app;
grant usage on sequence audit.log_seq_seq to tessera_app;
grant execute on function audit.verify(), app.patient_exists(text) to tessera_app;
revoke update, delete, truncate on audit.log from tessera_app, public;
