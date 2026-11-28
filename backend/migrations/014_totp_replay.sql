-- Phase 5: an authenticator code works once. The last accepted 30-second step is kept per account,
-- and a code from that step or an earlier one is refused.
alter table app.users add column totp_last_step bigint not null default 0;
grant update (totp_last_step) on app.users to tessera_app;
