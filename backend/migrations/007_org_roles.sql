-- Phase 4: non-clinical roles and operational data.
-- 1. Front desk, billing, insurance, lab, pathology, radiology and quality work across the hospital,
--    not from a care relationship. Row-level security lets them reach patient rows; the API then
--    sends each role only its projection (demographics, a header, or tokens for quality) and only the
--    record types its policy allows.
-- 2. Operational records (blood stock, incidents, assets, configuration, role requests...) live in
--    app.ops, encrypted under an organisation data key, versioned, with full history and no deletes.

drop policy patients_visible on app.patients;
create policy patients_visible on app.patients for select to tessera_app using (
  exists (select 1 from app.care_relationships c where c.patient_id = patients.id and c.user_id = current_setting('app.user_id', true))
  or exists (select 1 from app.btg_grants g where g.patient_id = patients.id and g.user_id = current_setting('app.user_id', true) and g.expires_at > now())
  or (current_setting('app.role', true) = 'patient' and patients.id = current_setting('app.patient_id', true))
  or current_setting('app.role', true) in ('pharmacist', 'receptionist', 'billing', 'insurance', 'lab', 'pathologist', 'radiologist', 'quality')
);

drop policy records_visible on app.records;
create policy records_visible on app.records for all to tessera_app using (
  exists (select 1 from app.care_relationships c where c.patient_id = records.patient_id and c.user_id = current_setting('app.user_id', true))
  or exists (select 1 from app.btg_grants g where g.patient_id = records.patient_id and g.user_id = current_setting('app.user_id', true) and g.expires_at > now())
  or (current_setting('app.role', true) = 'patient' and records.patient_id = current_setting('app.patient_id', true))
  or current_setting('app.role', true) in ('pharmacist', 'receptionist', 'billing', 'insurance', 'lab', 'pathologist', 'radiologist', 'quality')
) with check (
  exists (select 1 from app.care_relationships c where c.patient_id = records.patient_id and c.user_id = current_setting('app.user_id', true))
  or exists (select 1 from app.btg_grants g where g.patient_id = records.patient_id and g.user_id = current_setting('app.user_id', true) and g.expires_at > now())
  or (current_setting('app.role', true) = 'patient' and records.patient_id = current_setting('app.patient_id', true))
  or current_setting('app.role', true) in ('pharmacist', 'receptionist', 'billing', 'insurance', 'lab', 'pathologist', 'radiologist', 'quality')
);

create table app.keys (name text primary key, wrapped bytea not null);

create table app.ops (
  coll text not null, key text not null,
  version int not null default 1,
  body_enc bytea not null,
  created_by text not null references app.users(id), created_at timestamptz not null default now(),
  updated_by text not null references app.users(id), updated_at timestamptz not null default now(),
  primary key (coll, key)
);
create table app.ops_versions (
  coll text not null, key text not null, version int not null, body_enc bytea not null,
  written_by text not null, written_at timestamptz not null default now(),
  primary key (coll, key, version)
);
create function app.ops_history() returns trigger language plpgsql security definer set search_path = app as $$
begin
  insert into app.ops_versions (coll, key, version, body_enc, written_by) values (new.coll, new.key, new.version, new.body_enc, new.updated_by);
  return new;
end $$;
create trigger ops_history after insert or update on app.ops for each row execute function app.ops_history();

-- New patients (registration, unknown ER arrivals) are created through the API
grant insert on app.patients to tessera_app;
grant update (name_enc, dob_enc, mrn_enc, phone_enc, member_id_enc, payer_enc, name_idx, mrn_idx, age, sex, dept, unit, bed, status, attending) on app.patients to tessera_app;
create policy patients_insert on app.patients for insert to tessera_app with check (current_setting('app.role', true) in ('receptionist', 'doctor', 'nurse'));
create policy patients_update on app.patients for update to tessera_app using (
  current_setting('app.role', true) in ('receptionist', 'nurse', 'doctor')
  and (current_setting('app.role', true) = 'receptionist'
       or exists (select 1 from app.care_relationships c where c.patient_id = patients.id and c.user_id = current_setting('app.user_id', true)))
);
grant insert on app.care_relationships to tessera_app;
alter table app.patients add column dob_idx bytea;  -- keyed hash of name + date of birth, for duplicate checks
grant update (dob_idx) on app.patients to tessera_app;

-- Accounts: administrators suspend and reactivate; approved role requests change role and scope
grant update (status, role, dept, unit, title) on app.users to tessera_app;

grant select on app.keys to tessera_app;
grant select, insert on app.ops to tessera_app;
grant update (version, body_enc, updated_by, updated_at) on app.ops to tessera_app;
