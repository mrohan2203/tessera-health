# Tessera backend plan

The prototype enforces its security rules in the browser. This folder holds the plan and contracts for moving them to a server, so they are enforced rather than simulated:

- **No health data in plain text**
- **Audit logging on every record access**
- **Least-privilege access by default**

## Status

| Phase | What | Status |
|---|---|---|
| 0 · Decisions | Cloud and BAA, identity provider, region, threat model, retention | Open (see below) |
| 1 · Data layer | One store interface for every persisted read and write, demo and live adapters, access map | **Done** |
| 2 · Security core | Auth + MFA, users and roles, care relationships, patients with encrypted identifiers, audit pipeline, break-the-glass | Next |
| 3 · Clinical modules | Observations (vitals and labs), orders and checks, results loop, notes, MAR, care plan, rapid response | |
| 4 · The rest | Front office, billing, insurance, OT, blood bank, portal, FHIR API, notifications | |
| 5 · Hardening | HIPAA risk assessment, pen test, monitoring, backup and DR drills, load test | |

## Phase 1: what changed

- [`tessera/store.js`](../tessera/store.js) is the only code that touches browser storage. `app.js` saves state, keeps the session, appends audit events, resets demo data and passes one-shot messages through it. No module reads or writes `localStorage`/`sessionStorage` directly.
- **Demo adapter:** today's behaviour, unchanged. Synthetic data in this browser, used by the published link and the offline iPhone app.
- **Live adapter (stub):** documents the calls a server-backed adapter makes and refuses clearly until `TESSERA_CONFIG.apiBase` is set. It reports `persistsPHI: false`: in live mode nothing containing health data may be written to browser storage. Asking for `?mode=live` without a configured API falls back to the demo with a notice.
- **Tracing** (`?trace=1`): records which screen, chart tab, action or form reads and writes each collection. [`data-access-map.md`](data-access-map.md) was generated this way from the 73 workflow tests plus the full page sweep (71 collections). Write lists are exact; read lists include reads made by shared helpers on behalf of the screen being rendered. It is the starting list of API resources.
- **Tidied for the API:**
  - Module state (vitals log, care plans, rapid-response events) is now created once at boot instead of by helper functions on every read, so viewing a screen no longer writes.
  - Opening a chart's care plan no longer creates an empty plan.
  - In live mode, either of these would have meant a needless API write.
- **Verified:**
  - **Tracing off:** 73 workflows pass and the sweep matches the previous run (226 pages, 932 actions, 161 forms, 48 dialogs, 0 issues).
  - **Tracing on:** 73 workflows pass and the sweep is clean.
  - **Adapter test:** audit appended and persisted through the store, hash chain intact, session stored, live adapter refusing and not persisting PHI.

### Adapter contract

```js
{
  info: { mode: 'demo' | 'live', persistsPHI: boolean, label: string },
  loadState()            // demo: whole saved state · live: GET /api/bootstrap (server-filtered slice for this user)
  saveState(state)       // demo: whole state · live: no-op; writes go to resource endpoints
  resetState()           // demo only
  loadSession()          // demo: sessionStorage · live: HttpOnly cookie from the identity provider; display copy in memory
  saveSession(session)
  appendAudit(ev, state) // demo: client hash chain · live: display copy only; the server writes the authoritative row
  flash: { get(), set(text) }
}
```

To regenerate the access map after changes:

```bash
python3 -I tools/trace_data_access.py access-map.json   # needs the app on http://localhost:8765
python3 -I tools/access_map_md.py access-map.json backend/data-access-map.md
```

## Target architecture

- **Client:** the existing app. Demo mode stays for the pitch link and offline iPhone demos; live mode talks only to the API.
- **API:** TypeScript on Node (Fastify). The only route to data. Every request is authenticated, authorised and audited.
- **Database:** PostgreSQL with row-level security as a second least-privilege layer; a separate append-only schema for audit.
- **Identity:** OIDC provider federated with the hospital IdP; passkeys/WebAuthn for clinicians, TOTP for patients; SCIM provisioning.
- **Hosting:** HIPAA-eligible cloud under a BAA (for example AWS: RDS Postgres with KMS, ECS Fargate, ALB with WAF, S3 Object Lock for audit digests).
- **AI features** (Ask the twin, ambient notes, Document Intelligence): server-side calls to the Claude API under a BAA; the server builds the fact list so identifiers never leave.

## How the three rules become real

1. **No health data in plain text:**
   - TLS 1.2+ with HSTS; database encryption with managed keys.
   - Field-level envelope encryption for direct identifiers (name, DOB, MRN, phone, address, member ID), searched through a keyed-hash index.
   - No health data in logs or URLs (patient tokens, as now).
   - Live mode keeps health data in memory only and wipes it on sign-out or idle lock.
   - No offline cache on iPhone by default.
   - Encrypted, restore-tested backups.
2. **Audit on every record access:**
   - Middleware writes the audit row in the same transaction as the access, and fails closed.
   - The audit schema is insert-only (no update/delete grants, trigger guard).
   - The hash chain is computed server-side, with a nightly signed digest to write-once storage.
   - Reading the audit log is audited too.
   - The Privacy Sentinel and "Who viewed my record" read from it.
3. **Least privilege by default:**
   - Role plus care relationship, deny by default, checked in the API and again by row-level security.
   - Break-the-glass is a server-issued, time-boxed grant with a reason and a review queue.
   - Admins manage accounts but cannot open charts; two-person rules are enforced server-side.
   - Short sessions with a server-side idle lock and immediate revocation.

## Data model (sketch)

- **Identity and access:** `users`, `roles`, `care_relationships`, `btg_grants`, `sessions`.
- **Clinical:**
  - `patients` (encrypted identifiers), `encounters`, `problems`, `allergies`
  - `observations` (vitals and labs as one time series)
  - `orders`, `med_administrations`, `notes`
  - `care_plans`, `goals`, `tasks`, `rr_events`, `rr_log`
- **Everything else:** the remaining collections map one-to-one; see the access map.
- **Audit:** `audit_log` in its own schema.
- **Twin models** (forecasts, drug levels, anatomy findings) stay client-side computations over API data.

## Testing

- **Workflows:** the 72 workflows run against both adapters, and the page sweep runs against live mode in CI.
- **Access matrix:** a generated test of role × endpoint × care relationship, asserting the server refuses (not just hides).
- **Audit completeness:** every PHI route writes exactly one audit row, plus a nightly chain check.
- **Leak checks:** scans for health data in browser storage, logs, URLs and error messages.

## Open decisions

1. **Cloud and BAA:** AWS (recommended), Azure or Google Cloud.
2. **Identity provider:** managed (Okta or Entra ID, recommended) or self-hosted Keycloak.
3. **iPhone offline in live mode:** online-only (recommended) or an encrypted offline cache.
4. **Demo mode:** keep it permanently for the pitch link (recommended).
