-- Phase 5: sign-in through an identity provider. A sign-in in progress (state, nonce, PKCE verifier)
-- lives here for 10 minutes, so it works across API instances. The verifier is encrypted.
create table app.oidc_pending (
  state_hash bytea primary key,
  nonce text not null,
  verifier_enc bytea not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on app.oidc_pending to tessera_app;
