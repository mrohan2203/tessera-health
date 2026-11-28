-- Phase 4b: FHIR app tokens, the outbound message queue, and the changes feed.

-- Access tokens for approved FHIR apps. A signed-in user authorises an app the administrator approved;
-- the token acts as that user (and, for patient apps, only on their own record), with the app's scopes.
-- Stored as a peppered hash like session tokens. Revoking the app invalidates every token at once.
create table app.fhir_tokens (
  token_hash bytea primary key,
  app_id text not null,
  user_id text not null references app.users(id),
  scopes text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
grant select, insert on app.fhir_tokens to tessera_app;
grant update (revoked_at) on app.fhir_tokens to tessera_app;

-- Messages that leave the hospital (pager, email, SMS). Bodies are built from tokens and fixed text,
-- never names, MRNs or clinical values; a test scans every row.
create table app.outbox (
  id bigserial primary key,
  channel text not null check (channel in ('pager', 'email', 'sms')),
  to_user text references app.users(id),
  to_role text,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
grant select, insert on app.outbox to tessera_app;
grant update (sent_at) on app.outbox to tessera_app;
grant usage on sequence app.outbox_id_seq to tessera_app;

-- Changes feed: everything written after a moment, still filtered by row-level security and policy
create index records_updated on app.records (updated_at);
create index ops_updated on app.ops (updated_at);
