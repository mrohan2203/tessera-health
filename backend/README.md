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
| 3 · Clinical modules | Observations (vitals and labs), orders and checks, results loop, notes, MAR, care plan, rapid response | **Done** (local) |
| 4a · The rest of the app | Front office, ER registration, lab, radiology, blood bank, billing, insurance, OT, quality, admin tools, portal | **Done** (local) |
| 4b · Interfaces | FHIR API, notifications, privacy analytics over the server audit log | **Done** (local) |
| 5a · Hardening | Identity provider, rate limits, single-use codes, write-once audit, key rotation, backup and restore drill, monitoring, security probe, load test, threat model | **Done** (local) |
| 5b · Deployment | AWS (KMS, RDS, S3 Object Lock, WAF, ECS, CloudWatch), BAAs, independent penetration test, formal HIPAA risk analysis | Next |

## Phase 5a: hardening

### Sign-in through the identity provider ([`src/oidc.ts`](src/oidc.ts))

- **Turning it on:** set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` (Okta, Entra ID or any OpenID Connect issuer). The password sign-in then switches off, and the app shows "Sign in with your organisation".
- **The flow:** authorization code with PKCE, a single-use state, and a nonce. The ID token's RS256 signature is checked against the provider's published keys, along with issuer, audience and expiry. The provider must assert MFA (`amr` contains `mfa`).
- **Accounts:** the `preferred_username` claim maps to the Tessera account, which must exist and be active.
- **Audit:** successes and refusals are audited with the reason.
- **Tests:** run against a local mock provider. They cover a good sign-in, state replay, missing MFA, a wrong nonce, a wrong audience, an expired token, an unknown user, a suspended account, and a forged signature.

### Rate limits and single-use codes

- **Limits** ([`src/ratelimit.ts`](src/ratelimit.ts)): token buckets.
  - Sign-in: 20 a minute per address, bursts of 10.
  - API: 600 a minute per session.
  - FHIR: 120 a minute per token.
  - Over the limit the API answers 429 with Retry-After, and audits it once a minute per key.
- **Authenticator codes:** each code works once. The last accepted 30-second step is stored, and that step or any earlier one is refused.
- **Local automation:** both can be switched off with `RATE_LIMITS=0` and `ALLOW_TOTP_REUSE=1`, which the development server in `.claude/launch.json` uses for the browser tests. They are ignored when `NODE_ENV=production`.

### Write-once audit checkpoints ([`src/worm.ts`](src/worm.ts))

- **What a checkpoint holds:** every 5 minutes, and on `npm run audit:checkpoint`, the chain's head (last row number, its hash, the row count) is signed with `AUDIT_SIGNING_KEY_HEX`, a key the database never holds. Each checkpoint also signs the one before it.
- **Where it goes:** a file created exclusively and made read-only (`backend/.worm/` locally). In production, an S3 bucket with Object Lock in compliance mode.
- **What verification catches** (`npm run audit:verify`, and the admin's Verify chain button):
  - someone with schema rights rebuilding the whole chain, which the chain check alone misses;
  - rows removed;
  - a checkpoint missing or forged.
- **Tested** by actually rebuilding the chain inside a rolled-back transaction.

### Keys, backups and recovery

- **Master key rotation** (`NEW_KEK_HEX=… npm run rotate-kek`): re-wraps every patient data key, the organisation key and the authenticator secrets in one transaction, then checks them. No health data is re-encrypted. Restart the API afterwards. With AWS KMS, yearly rotation is automatic; this is for a suspected compromise.
- **Encrypted backups** (`npm run backup`): `pg_dump` of the whole database, encrypted with a fresh key wrapped by the master key, written to `backend/backups/` (git-ignored, mode 600).
- **Restore drill** (`npm run drill`):
  - decrypts the newest backup and restores it into a scratch database;
  - checks that the audit chain verifies, that row counts match the backup's manifest, and that a patient's identifiers decrypt;
  - drops the scratch database and reports the time. The last run took 0.6 s for 23 patients and 27,593 audit rows.

### Monitoring

- `GET /api/health` (liveness) and `GET /api/ready` (database, keys and audit, or 503).
- `GET /api/metrics`: Prometheus text, readable with `METRICS_TOKEN` or an administrator session.
- One JSON log line per request: method, route template, status, milliseconds. Never an id, a query string or a body.
- Tests check that logs and metrics carry no patient ids or health data.

### Security probe and load test

- **`test/probe.test.ts`:**
  - walks all 30 registered routes; every protected route refuses no session, a forged session and a signed-out one;
  - CSRF and origin checks on every write route;
  - IDOR attempts on charts and FHIR;
  - SQL injection, path and script payloads in every parameter;
  - oversized and malformed bodies;
  - security headers and cookie flags on every response.
- **`npm run loadtest -- 40 30`:** 40 users across 9 roles for 30 seconds against the running API.
  - 33,832 requests, about 1,125 a second, 0 server errors.
  - p95 under 90 ms for every kind of request.
  - 145 writes refused as version conflicts between users (expected), and the audit chain intact afterwards across 80,339 rows.

### Threat model

[`SECURITY.md`](SECURITY.md) has the assets, trust boundaries, a STRIDE table mapped to the tests, the HIPAA 164.312 technical safeguards, and the residual risks.

### Fixed along the way

- The admin dashboard re-ran the Privacy Sentinel on every redraw. It is now pre-filtered in SQL, indexed by time and cached for a minute; opening the Sentinel page scans afresh.
- The live audit page could show only the newest 300 events. Its filter and search now run on the server, over the whole log.
- Invalid write requests no longer echo the attacker's collection name back.

### Verified

- **`npm test`: 66 tests**, 11 of them new for Phase 5a.
- **`e2e/live_test.py`:** all checks pass, including that searching the audit log reaches the whole server log.
- **`e2e/run_live_usecases.py`:** 67 of 73 pass, with the same 6 demo-only failures as before.
- **Demo mode unchanged:** 73 workflows pass and the sweep is clean.
- **Backup drill and checkpoint verification:** both pass.

## Phase 4b: interfaces

### FHIR R4 read API (`/fhir/r4`)

- **Resources:**
  - `Patient`: read by id, or search by MRN through the blind index.
  - `Observation`: vitals by LOINC, including the blood-pressure panel; labs with LOINC, reference range and interpretation.
  - `Condition`: ICD-10 codes from the problem list.
  - `AllergyIntolerance` and `MedicationRequest`.
  - `DocumentReference`: signed notes.
  - The CapabilityStatement at `/fhir/r4/metadata` is public. Mappings are in [`src/fhir.ts`](src/fhir.ts).
- **Access, the same rules as the app:** the role, care relationships, row-level security and projection apply. A pharmacist gets no problem list; front desk and billing get no FHIR at all. Every read writes an audit row naming the app, and the response is sent only after that row is committed.
- **Apps:** a signed-in user connects an app the administrator approved (`POST /api/fhir/authorize`), in the style of SMART on FHIR.
  - Patient apps (`patient/*.read`) can be connected only by the patient, and read only that patient.
  - Clinician apps (`user/...`) act as the clinician, narrowed to the app's scopes.
  - Tokens last an hour and are stored hashed.
  - Revoking the app in Data exchange invalidates its tokens at once.

### Notifications

- **Changes feed** (`GET /api/changes?since=`): what changed for this caller since a moment, with the same filtering as the census. The app polls it every 15 seconds, so a doctor's note appears on the nurse's open chart without a reload.
  - An item with unsaved local changes is left alone.
  - The screen isn't redrawn while someone is typing.
- **Outbox** (`app.outbox`): messages that leave the hospital, by pager, email or SMS.
  - Triggers: critical lab release (to the ordering doctor), critical results, break-the-glass (privacy office), bed requests (front desk), role and support-access requests (admins), appointment reminders (patient).
  - Messages are built from tokens and fixed text only; a test scans every message for names, MRNs, dates of birth, phone numbers and clinical values.
  - Admins see the queue on the Audit log page. Sending is a separate worker, not built yet.

### Privacy Sentinel on the audit log ([`src/sentinel.ts`](src/sentinel.ts))

- **Rules over the last 30 days of the real audit log:**
  - repeated blocked attempts;
  - after-hours access by non-clinical roles;
  - VIP records opened through emergency or pharmacy-wide access;
  - every break-the-glass (high risk on a VIP record);
  - staff opening a relative's record, from HR links;
  - one person opening 15 or more charts in an hour.
- Alerts carry tokens and evidence rows, never names. The privacy officer names a patient only with `POST /api/privacy/reveal` and a written reason, and the reveal is audited.

### Fixed along the way

- **FHIR responses before the audit commit:** the FHIR handlers sent their response before the audit row was committed, so a failed audit insert could still have released data. They now respond only after the commit, as every other route does.
- **Sign-out finishing late:** sign-out waits for pending saves before telling the server. If the tab was reloaded or closed first, the server session stayed alive until the idle timeout. The page now leaves a small flag in the tab's session storage (no health data), and the next load finishes the sign-out.

### Verified

- **`npm test`: 55 tests**, 8 of them new for Phase 4b: the CapabilityStatement, the US Core shapes and one audit row per read, FHIR access rules, a patient app and its revocation, clinician app scopes, the changes feed, outbox content scanned for identity, and the Sentinel rules with an audited reveal.
- **`e2e/live_test.py`:**
  - A second user's open screen picks up the change.
  - The Sentinel flags real blocked attempts.
  - The outbox is visible to the admin.
  - Every page for every role is on the API.
- **`e2e/run_live_usecases.py`:** 67 of 73 pass; the remaining 6 exercise demo-only screens and seeded demo history.
- **Demo mode unchanged:** 73 workflows pass and the sweep is clean.

### Not done

- **Phase 4 leftovers:** bulk `$export`, SMART's full OAuth authorization-code flow with a consent screen, write access over FHIR, and the outbox sending worker.
- **Phase 2 items:** done in Phase 5a, except AWS, which is Phase 5b.

## Phase 4a: every module on the API

In live mode, every screen for every role now reads and writes through the API. A crawl of every menu page for all 20 accounts finds none left on local data.

### What changed

- **One policy for everything** ([`src/policy.ts`](src/policy.ts)): for each of 67 collections, the roles that may read it, the roles that may write it, and how it links to a patient. Deny by default.
- **Where records live:** patient-linked records stay in `app.records`, encrypted per patient. Operational records (blood stock, incidents, assets, configuration, role requests, tenants, personal to-do lists) are in `app.ops`, encrypted under an organisation key wrapped by the master key. Both keep every version and allow no deletes.
- **Hospital-wide roles work from their job's slice instead of a care relationship:**
  - Front desk, billing and insurance get demographics.
  - Lab and pathology get a header.
  - Radiology gets a header plus allergies and kidney function.
  - Quality gets de-identified tokens with diagnoses and age.
  - Executives, administrators and the platform team get no patients.
  - Each patient sent is audited.
  - Chart updates are cut to the same projection, so a clinical change never reaches the front desk. The front desk never sees the safety answer in social needs, and its writes can't erase what it can't see.
- **Registration** (`POST /api/patients/register`): front desk, plus ER doctors and nurses for unknown arrivals.
  - Identifiers are encrypted under a new key.
  - The duplicate check matches date of birth by keyed hash, then compares names in memory.
  - MRNs come from a server sequence.
- **Care relationships follow the patient:**
  - Admission, transfer, an emergency-board entry or a theatre booking recompute them, so the receiving unit gains access and the old unit loses it.
  - An approved role change re-derives that person's relationships and ends their sessions.
- **Quality** names patients only through `POST /api/reveal`, with a stated purpose; each name revealed is audited.

### Rules added ([`src/records.ts`](src/records.ts))

- **Appointments:** no double-booking, checked against every appointment, including ones the caller can't see. The API decrypts them in memory for the check and returns none.
- **Lab:**
  - Steps only go forward.
  - A value in the critical range must be flagged, and only a pathologist releases a critical result.
  - Released results can't change, and doctors can't edit lab results.
- **Radiology:** contrast with eGFR under 30 is blocked unless a radiologist overrides.
- **Blood bank:** an issue needs a second verifier who isn't you, and never an expired unit.
- **Role changes:**
  - A request is made under your own name.
  - Nobody decides a request they made or one about their own role.
  - Approval is the only way an account's role changes.
- **Accounts:** administrators suspend and reactivate, never themselves; suspension ends sessions at once.
- **Configuration:**
  - The allergy check can't be turned off.
  - Idle timeout is 1–30 minutes and break-the-glass lasts 1–12 hours.
  - Quality can change only alert settings.
- **Platform support access:** requested by the platform team, approved only by the tenant administrator.
- **Incidents:** anyone can report; quality and admin manage status.
- **Personal lists:** to-dos and read markers belong to their owner and are sent only to them.

### Fixed along the way

- The running API cached the organisation key forever. It now re-checks the stored key, so a replaced key (rotation, or a development reseed) is picked up instead of failing to decrypt.
- The app now records the blood-issue verifier on the record. Before, it was only in the audit text, which the server can't check.

### Verified

- **`npm test`: 47 tests**, 15 of them new for Phase 4: role slices, the social-needs safety projection, double-booking, lab release, contrast, blood issue, role-change separation of duties and re-derived access, suspension, configuration limits, support access, personal lists, registration and duplicate check, admission granting and removing access, quality reveal, and ciphertext-only storage.
- **`e2e/run_live_usecases.py`: 67 of 73 app workflows pass in live mode.** The 6 that don't:
  - 5 exercise demo-only screens: demo sign-in, demo storage, and a care-plan test that rewrites a result's history locally, which the server rightly refuses.
  - 1 is the Privacy Sentinel, which in live mode must analyse the server's audit log (Phase 4b).
- **`e2e/live_test.py`:** every menu page for all 20 accounts is on the API, and the front desk gets demographics only.
- **Demo mode unchanged:** 73 workflows pass, and the sweep shows 226 pages, 932 actions, 161 forms, 48 dialogs and 0 issues.

### Still open

- From Phase 2: Okta or Entra ID, AWS deployment, rate limiting, authenticator-code replay, and write-once audit storage.

## Phase 3: clinical records

The clinical half of the chart now lives on the server: orders, results, notes, lab orders, the eMAR, pharmacist verification, the vitals flowsheet, care plans, rapid-response and code-blue records, medication reconciliation and chart updates (current vitals, problems, allergies, weight, code status).

### How it works

- **Storage:** each item is one row in `app.records`, encrypted under its patient's data key. Every version is kept in `app.record_versions`, also encrypted. The API role has no delete right: nothing in the clinical record is ever removed.
- **Reads:** records come with the census and with each chart, filtered by role. A pharmacist gets medication orders, verification, the eMAR and reconciliation. A patient gets signed notes, released labs and active medicines. Row-level security applies to records exactly as it does to patients.
- **Writes:** in live mode the app sends only the items that changed, each with the version it was based on (`POST /api/records`). Each item is authorised, checked, encrypted and audited in its own transaction.
- **Refusals and conflicts:** a refused write is explained on screen, and that patient's records are reloaded from the server, so nobody keeps looking at something the server rejected. A stale version is refused as a conflict instead of overwriting someone else's change.
- **Sign-out:** waits for pending saves, and the next sign-in waits for the sign-out. Both share one cookie, so a slow save can't land under the wrong person.

### Rules the server enforces ([`src/records.ts`](src/records.ts))

- **Orders:**
  - Only doctors place or sign them.
  - A penicillin-class or sulfonamide drug for a patient with that allergy can't be signed without a doctor's override reason, recorded on the order or on the care-plan medicine it came from.
  - A signed order can't be edited.
  - Pharmacists can only verify or reject; nurses can't change orders.
- **Notes:** a draft belongs to its author. A signed note never changes; addenda can only be added.
- **Results:** the value can't change and the trail is append-only. Results themselves come from the lab and imaging systems.
- **eMAR:** nurses only; an entry can't be changed once charted, and a held or refused dose needs a reason.
- **Verification:** pharmacists only, once per order.
- **Vitals:** append-only and range-checked, so a heart rate of 400 is refused.
- **Care plans:**
  - A doctor starts the plan; nurses can update tasks but not goals or medicines.
  - A blocked medicine needs a doctor's override before it can be ordered.
- **Rapid-response records:**
  - The log is append-only, and a closed event takes no new entries.
  - A drug against a recorded allergy needs an override reason.
  - Vitals in the log are range-checked.
- **Chart fields:** current vitals, weight and height can be changed by doctors and nurses; problems and medicines by doctors only; allergies by doctors and nurses; code status by doctors only. Bed moves, status and registration details are refused until Phase 4.
- **Patients:** read-only in this API.

### Fixed along the way

The audit chain could break under concurrent writes. Row numbers were assigned before the chain lock, so two requests could commit in one order and link in the other. Numbers are now assigned after the lock (`migrations/006_audit_order.sql`). A new test runs 50 concurrent audited transactions and checks the chain and the numbering.

### Verified

- **`npm test`: 32 tests.**
  - Every rule above, both allowed and refused.
  - Version conflicts.
  - Writes outside the care relationship refused and audited; billing and patients can't write.
  - Records stored only as ciphertext, every version kept, no delete right.
  - Audit chain under concurrency.
- **`python3 e2e/run_live_usecases.py`:** the 73 app workflows run in live mode against the API. 49 pass. The 24 that can't pass yet are listed in the script with the reason for each: demo sign-in screens, the demo storage check, and Phase 4 modules whose state is not on the API yet. Anything else failing is a regression.
- **`python3 e2e/live_test.py`:**
  - Sign-in, census, charts, search, break-the-glass and the audit log.
  - A note survives a reload and reaches the nurse.
  - An edit to a signed note is refused and rolled back on screen.
  - Every menu page for all 20 accounts.
- **Demo mode unchanged:** 73 workflows pass, and the sweep shows 226 pages, 932 actions, 161 forms, 48 dialogs and 0 issues.

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
- **Other modules:** done in Phase 4a.
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
