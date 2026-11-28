# Tessera security: threat model and safeguards

This is a working threat model for the Tessera API and the app's live mode. It is not the formal HIPAA security risk analysis (45 CFR 164.308(a)(1)(ii)(A)), which the covered entity must perform and document with its own people, systems and vendors. It is a starting point for that analysis.

## What we protect

| Asset | Where it lives | Protection |
|---|---|---|
| Patient identifiers and clinical records | `app.patients`, `app.records` | AES-256-GCM under a per-patient data key; data keys wrapped by the master key (KMS) |
| Operational records (blood stock, incidents, configuration, privacy cases) | `app.ops` | AES-256-GCM under an organisation key wrapped by the master key |
| Audit log | `audit.log` + write-once checkpoints | Append-only (grants + triggers), hash-chained, head signed every 5 minutes into write-once storage |
| Credentials | `app.users`, `app.sessions`, `app.fhir_tokens` | scrypt passwords; authenticator secrets encrypted; session and app tokens stored only as peppered SHA-256 |
| Keys | `.env` locally; AWS KMS and Secrets Manager in production | Never in the database in usable form; never logged or printed |
| Backups | `backend/backups/` locally; S3 Object Lock in production | Encrypted with a fresh key wrapped by the master key |

## Trust boundaries

1. **Browser ↔ API:** the HttpOnly, SameSite=Strict session cookie, the CSRF header on writes, CORS for the app origin only, and security headers on every response.
2. **Outside apps ↔ FHIR API:** Bearer tokens issued only for apps the administrator approved, only when a signed-in user authorises them. Read-only, scope-limited, and revoked with the app.
3. **API ↔ database:** the API runs as `tessera_app`, which has no DDL, no delete and insert-only audit rights. Row-level security re-checks patient access below the API.
4. **API ↔ identity provider:** OpenID Connect authorization code with PKCE, state and nonce. The ID token is verified against the provider's keys, and the provider must assert MFA.
5. **Hospital ↔ outside world (pager, email, SMS):** messages are built from tokens and fixed text only.

## STRIDE

| Threat | Example | Controls | Tested by |
|---|---|---|---|
| **Spoofing** | Stolen password | MFA (authenticator, or IdP-asserted); lockout after 5 failures; sign-in rate limit per address; each code works once | `security.test.ts`, `hardening.test.ts` |
| | Forged session or app token | Random 256-bit tokens, stored hashed; pre-MFA token opens nothing and is rotated; idle lock after 15 minutes, enforced by the server | `security.test.ts`, `probe.test.ts` |
| | Forged identity-provider response | Signature against the published keys; issuer, audience, expiry, nonce, state single-use; PKCE | `hardening.test.ts` (mock provider) |
| **Tampering** | Editing an audit row | No update/delete/truncate grants; triggers refuse even the owner; hash chain | `security.test.ts` |
| | Rebuilding the whole chain with schema rights | Signed checkpoints in write-once storage; key held outside the database | `hardening.test.ts` |
| | Changing a signed note, a charted dose, a released lab | Server-side rules per record type; versions kept; no deletes | `records.test.ts`, `phase4.test.ts` |
| | Lost update between two users | Optimistic concurrency (versions); conflict returns the stored copy | `records.test.ts`, load test |
| **Repudiation** | "I never opened that chart" | Audit row in the same transaction as every access; responses sent only after the commit; FHIR reads name the app | `security.test.ts`, `phase4b.test.ts` |
| **Information disclosure** | Plaintext health data in the database, a backup, logs or metrics | Field encryption; encrypted backups; logs and metrics use route templates only | `security.test.ts`, `hardening.test.ts` |
| | A role seeing more than its job needs | Policy per collection; projections per role; row-level security; quality is de-identified | `security.test.ts`, `phase4.test.ts` |
| | Changing an id to reach another patient (IDOR) | Row-level security and care checks on every route, FHIR included | `probe.test.ts` |
| | Patient identity leaving in a pager/SMS | Outbox built from tokens; every message scanned in tests | `phase4b.test.ts` |
| | Error messages leaking internals | Generic 500 message; no reflection of bad input; injection probes | `probe.test.ts` |
| **Denial of service** | Flooding sign-in or the API | Token-bucket limits (auth per address, API per session, FHIR per token); 512 KB body limit; at most 50 writes per call | `hardening.test.ts`, `probe.test.ts` |
| | Flooding the audit log via refusals | Rate-limit events audited at most once a minute per key | `hardening.test.ts` |
| | Expensive Privacy Sentinel scans | SQL pre-filter, time index, one-minute cache | load and live tests |
| **Elevation of privilege** | Granting yourself a role | Role changes only through a request decided by another administrator; sessions end on change | `phase4.test.ts` |
| | Turning off a safety check | The allergy check cannot be disabled; configuration is bounded | `phase4.test.ts` |
| | Self-approved platform access | The tenant administrator approves; the platform team gets no patient data | `phase4.test.ts` |
| | Break-the-glass abuse | Justification of at least 20 characters, 4-hour grant, privacy-office message, single review, Sentinel alert (high if VIP) | `security.test.ts`, `phase4b.test.ts` |

## HIPAA Security Rule, technical safeguards (164.312)

| Standard | How Tessera meets it |
|---|---|
| (a)(1) Access control: unique user identification | One account per person; identity-provider subject mapped to the account |
| (a)(1) Emergency access procedure | Break-the-glass, time-limited, justified, reviewed |
| (a)(1) Automatic logoff | 15-minute idle lock enforced by the server; 12-hour session limit |
| (a)(1) Encryption and decryption | Envelope encryption of identifiers, clinical and operational records, backups |
| (b) Audit controls | Every access and refusal audited in-transaction; append-only, hash-chained, signed write-once checkpoints; Privacy Sentinel |
| (c)(1) Integrity | Server-side clinical rules, immutable signed and charted items, versions, no deletes, audit chain |
| (d) Person or entity authentication | Password and authenticator (single-use codes), or the IdP with asserted MFA |
| (e)(1) Transmission security | HTTPS with HSTS in production (TLS terminated at the load balancer); Secure cookies when `NODE_ENV=production` |

## Residual risks and open items

- **A full SMART on FHIR consent screen** (authorization code with user consent per app) is not built; tokens are issued to the signed-in user directly.
- **Rate limits are per instance.** Several instances need a shared store or the AWS WAF rate rule.
- **The local master key is a file.** Production must use AWS KMS with key policies limiting who can decrypt, and CloudTrail on KMS use.
- **Write-once storage is a local directory.** Production needs an S3 bucket with Object Lock (compliance mode) and a retention of at least 6 years.
- **The outbox is not delivered yet.** The delivery worker must keep the "no identity" rule and use a BAA-covered provider.
- **No independent penetration test yet.** `probe.test.ts` is an automated check, not a substitute.
- **Insider with database superuser and the signing key** could still forge history. Keep the signing key in a separate account and service (KMS asymmetric key or Secrets Manager with a separate principal), and alert on checkpoint gaps.
- **Business associate agreements** are needed with AWS, the identity provider and the messaging provider before live data.
- **Workforce, physical and administrative safeguards** (training, sanctions, contingency plan, device controls) are the covered entity's programme, not code.
