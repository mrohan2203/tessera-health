# Tessera backend plan

The prototype enforces its security rules in the browser. This folder holds the plan and contracts for moving them to a server, so they are enforced rather than simulated:

- **No health data in plain text**
- **Audit logging on every record access**
- **Least-privilege access by default**

## Status

| Phase | What | Status |
|---|---|---|
| 0 · Decisions | Cloud and BAA, identity provider, region, threat model, retention | Partly decided (see below) |
| 1 · Data layer | One store interface for every persisted read and write, demo and live adapters, access map | **Done** |
| 2 · Security core | Auth + MFA, users and roles, care relationships, patients with encrypted identifiers, audit pipeline, break-the-glass | **Done** (local; cloud deployment pending) |
| 3 · Clinical modules | Observations (vitals and labs), orders and checks, results loop, notes, MAR, care plan, rapid response | Next |
| 4 · The rest | Front office, billing, insurance, OT, blood bank, portal, FHIR API, notifications | |
| 5 · Hardening | HIPAA risk assessment, pen test, monitoring, backup and DR drills, load test | |

## Phase 2: the security core

A Node 22 API (Fastify, TypeScript run directly with `--experimental-strip-types`) over Postgres 15. The app's **live mode** uses it for sign-in, patient lists, charts, break-the-glass and the audit log.

### Run it locally

You need Homebrew `postgresql@15` and Node 22.6 or later.

```bash
cd backend && npm install
node scripts/genenv.mjs      # writes .env with random keys and passwords (git-ignored, mode 600)
npm run db:start             # project-local Postgres in backend/.pgdata on port 54329
npm run migrate && npm run seed
npm run dev                  # API on http://localhost:8787
npm test                     # the security suite (needs the database, not the running API)
```

Then serve `tessera/` on port 8765 and open `http://localhost:8765/?mode=live&api=http://localhost:8787`. The seed gives every account a random password and an authenticator secret, written only to `backend/.dev-credentials.json` (git-ignored). `npm run totp -- <username>` prints the current 6-digit code, standing in for the authenticator app.

### How each rule is enforced

**No health data in plain text**
- Each patient has their own data key (AES-256-GCM). It is stored only wrapped by a master key, and the master key sits in AWS KMS in production (`LocalKms` locally, behind the same interface).
- Encrypted: name, date of birth, MRN, phone, member ID, payer and the clinical record.
- Search uses keyed hashes (HMAC-SHA256 blind indexes) of the MRN and the full name, so exact-match search works without plaintext.
- Authenticator secrets are encrypted. Passwords are scrypt hashes. Session cookies are stored only as peppered SHA-256 hashes.
- A portal account's name is the patient's name, so it lives only in the encrypted record.
- The audit log carries pseudonymous tokens, never names or MRNs.

**Audit logging on every record access**
- Every route that touches health data writes its audit row in the same transaction as the read. If the audit insert fails, the request fails: no access without a record.
- Denials, sign-in failures, lockouts, idle timeouts and reads of the audit log itself are recorded too.
- `audit.log` is append-only. The API's database role can only insert and select, and triggers refuse update, delete and truncate even for the table owner.
- Each row's SHA-256 hash covers the previous row's hash. `audit.verify()` walks the chain and names the first broken row.

**Least privilege by default**
- Sign-in is a password plus an authenticator code (RFC 6238 TOTP). The pre-MFA token is a separate session stage that opens nothing and is rotated on success.
- Five failures lock the account for 15 minutes. Sessions lock after 15 idle minutes, enforced by the server, and expire after 12 hours.
- The cookie is HttpOnly and SameSite=Strict (and Secure in production). Writes need an `X-Tessera` header, and only the app's origin is allowed (CORS).
- Charts open only for doctors, nurses and pharmacists with a care relationship, and the relationship rules match the app's.
- Row-level security in Postgres is a second check under the API: with no identity set the API's role sees no patients at all.
- Pharmacists get a medication profile, not the chart. A patient sees only their own record.
- Break-the-glass is for doctors and nurses only. It needs a reason and at least 20 characters of justification, lasts 4 hours and is audited. Admin or quality staff review each grant once, and nobody can review their own.

### API

| Route | Who | What |
|---|---|---|
| `POST /api/auth/password`, `/mfa`, `/logout` | anyone | Two-step sign-in, sign-out |
| `GET /api/me` | signed in | Your account |
| `GET /api/bootstrap` | signed in | The census your worklists run on: every record you may open, one audit row each |
| `GET /api/patients`, `/api/patients/:id` | clinical roles, patient | List; chart (one audit row per view) |
| `GET /api/search?q=` | doctor, nurse | Exact MRN or full name via blind index; returns no identity |
| `POST /api/patients/:id/btg` | doctor, nurse | Break-the-glass grant |
| `GET /api/btg`, `POST /api/btg/:id/review` | admin, quality | Review grants |
| `GET /api/audit`, `/api/audit/verify` | admin, quality | Read and verify the log |

### Verified

- **`npm test`: 19 tests.**
  - Sign-in: two steps, the pre-MFA token opens nothing, lockout, identical answers for unknown users, CSRF and origin checks, idle lock, sign-out.
  - The full access matrix: every user × every patient, for both lists and charts.
  - Pharmacist projection, and the portal seeing only its own record.
  - Row-level security tested directly, plus no DDL, update or delete rights for the API role.
  - One audit row per chart view, denials audited, append-only even for the owner, tampering detected.
  - No plaintext identifiers anywhere in the database.
  - The break-the-glass lifecycle including expiry and single review.
  - The census and blind-index search.
- **Live mode, end to end in a headless browser:**
  - Wrong password and wrong code refused; the suspended account refused.
  - Nothing about patients in browser storage, and sign-out clears patients from memory.
  - The list matches the database, charts and every tab open, and search outside care withholds identity.
  - Break-the-glass opens the chart; the admin reads and verifies the server's audit chain and reviews the grant.
  - The portal shows only its own record.
  - Every menu page for all 20 accounts opens with no page errors.
- **Demo mode unchanged:** 73 workflows pass, and the sweep shows 226 pages, 932 actions, 161 forms, 48 dialogs, 0 issues.

### Not done yet, on purpose or for later

- **Identity provider:** Okta or Entra ID is not wired. Local passwords and TOTP stand in for it; the session, roles and every check stay the same when OIDC replaces the sign-in step.
- **Cloud:** AWS is not wired either: no KMS, RDS, deployment or HTTPS yet (`PRODUCTION=1` turns on Secure cookies and HSTS).
- **Hardening:**
  - Authenticator codes can be reused within their 30-second window.
  - Lockout is per account; there is no per-IP rate limit yet.
  - Copying the audit log to write-once storage (S3 Object Lock) is still to do, which matters because someone with DDL rights could rebuild the whole chain.
- **Other modules:** in live mode they still show synthetic demo data, limited to the patients the server sent. Modules that need records a role isn't sent (front-desk bed board and social needs, insurance cases) show "not connected yet" until Phase 3.
- **iPhone:** the app still runs the demo offline. Live mode will be online-only, with `TESSERA_CONFIG.apiBase` set at build time.

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

Decided:
1. **Cloud and BAA:** AWS.
2. **Identity provider:** managed (Okta or Entra ID).
3. **iPhone in live mode:** online-only.
4. **Demo mode:** kept permanently for the pitch link.

Still open: region, the threat model and retention periods.
