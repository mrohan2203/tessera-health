-- Phase 3: clinical records. One row per clinical item, encrypted under the patient's data key and
-- versioned (optimistic concurrency). Same row-level security as the patient: care relationship,
-- active break-the-glass grant, the patient themself, or a pharmacist. No delete grant: nothing in
-- the clinical record is ever removed.
create table app.records (
  coll text not null,
  key text not null,
  patient_id text not null references app.patients(id),
  version int not null default 1,
  body_enc bytea not null,
  created_by text not null references app.users(id),
  created_at timestamptz not null default now(),
  updated_by text not null references app.users(id),
  updated_at timestamptz not null default now(),
  primary key (coll, key)
);
create index records_patient on app.records (patient_id);

-- Every version is kept (the record's history), also encrypted.
create table app.record_versions (
  coll text not null, key text not null, version int not null,
  patient_id text not null, body_enc bytea not null,
  written_by text not null, written_at timestamptz not null default now(),
  primary key (coll, key, version)
);

create function app.record_history() returns trigger language plpgsql security definer set search_path = app as $$
begin
  insert into app.record_versions (coll, key, version, patient_id, body_enc, written_by) values (new.coll, new.key, new.version, new.patient_id, new.body_enc, new.updated_by);
  return new;
end $$;
create trigger records_history after insert or update on app.records for each row execute function app.record_history();

alter table app.records enable row level security;
create policy records_visible on app.records for all to tessera_app using (
  exists (select 1 from app.care_relationships c where c.patient_id = records.patient_id and c.user_id = current_setting('app.user_id', true))
  or exists (select 1 from app.btg_grants g where g.patient_id = records.patient_id and g.user_id = current_setting('app.user_id', true) and g.expires_at > now())
  or (current_setting('app.role', true) = 'patient' and records.patient_id = current_setting('app.patient_id', true))
  or current_setting('app.role', true) = 'pharmacist'
) with check (
  exists (select 1 from app.care_relationships c where c.patient_id = records.patient_id and c.user_id = current_setting('app.user_id', true))
  or exists (select 1 from app.btg_grants g where g.patient_id = records.patient_id and g.user_id = current_setting('app.user_id', true) and g.expires_at > now())
  or current_setting('app.role', true) = 'pharmacist'
);

grant select, insert on app.records to tessera_app;
grant update (version, body_enc, updated_by, updated_at) on app.records to tessera_app;
