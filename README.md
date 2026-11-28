# Tessera Health

A clickable hospital management system (HMS) prototype for pitching, with a native iOS app.
One patient record, 20 role-based accounts, and about 45 modules covering clinical care, diagnostics,
front office, revenue cycle, quality, leadership, administration and a patient portal.

> **Synthetic data only. Not for clinical use.** Nothing is real-time. All changes stay on the
> viewer's device (browser localStorage), and **Reset demo data** on the entry screen starts over.

## What's in the repo

| Folder | What it is |
|---|---|
| [`tessera/`](tessera) | The web app: plain HTML, CSS and JavaScript, no build step or dependencies |
| [`ios/`](ios) | SwiftUI + WKWebView shell that bundles the web app into an offline iPhone/iPad app |

## Run the web app

```bash
cd tessera && python3 -m http.server 8765
```

Open http://localhost:8765 and tap any demo account, then **Approve**. Narrow the window (or open it
on a phone) to get the mobile layout: bottom tab bar, "Needs you" cards and card-style tables.

## Run the iOS app

Requires Xcode 15 or later (iOS 17 deployment target).

1. Open `ios/TesseraHealth.xcodeproj`.
2. Pick a simulator and press Run (⌘R).

A build phase copies `tessera/` into the app on every build, so web changes show up on the next run.
To install on a real iPhone or share through TestFlight, see [ios/README.md](ios/README.md).

## Design principles

- **Least privilege by default.** Each role sees only what its job needs. Billing, admins and
  radiologists can't open charts, and leadership sees aggregates only.
- **Every record access is audited** in an append-only, hash-chained log that can be verified.
- **No PHI in plaintext where it isn't needed.** Audit logs, quality lists and privacy alerts show
  patient tokens until a stated purpose is logged.
- **Break-the-glass** for out-of-scope emergencies, with a reason and an after-the-fact review.
- **Two-person rules** for role changes and blood issue. Nobody approves their own request.
- **Vitals and lab history:** a nursing flowsheet (72 hours of charted sets, nurses and doctors can chart new ones, audited and fed straight into NEWS2 and the twin) and prior values for every numeric lab, with sparklines, “↑ from 5.7 yesterday” deltas and a full trend view. Patients see their own trends in the portal.
- **My health twin (patient portal):** the patient's own twin in plain language: how each part of the body is doing and why, vital signs and test results over time with what each test means, the goals the care team set, what each medicine is for, and questions to ask. Forecasts and risk scores stay with the care team.
- **Rapid response and code blue:** called from the Vitals tab when NEWS2 reaches 5. A live, timed record with CPR-cycle and adrenaline timers, one-tap interventions, rhythm checks and shocks, drug buttons chosen from the record and run through the allergy and potassium check, reversible causes (Hs and Ts) pre-flagged from labs and problems, team arrival times, and vitals that also update the chart. DNR/DNI blocks CPR until a documented reversal. Closing drafts a note from the log; signing files it and adds a post-event review to the care plan.
- **Care plan:** goals and tasks per organ system drafted from the record and accepted by a clinician. Goals track a lab or vital target live (met, improving, worsening); tasks have an owner and a due time and close themselves when the evidence arrives (a repeat lab, an acknowledged critical result, signed med reconciliation, vitals on schedule). Planned drugs are checked against allergies with cross-reactivity, potassium, anticoagulants, duplicates and kidney function; a blocked drug needs a doctor's documented override before it can go to orders.
- **Patient twins list:** everyone in your care ranked critical, watch or stable from their digital twin, with NEWS2 and the most abnormal lab as sparklines, what changed in the last 24 hours, the next forecast danger and organ-system dots. Care team only, audited with patient tokens.
- **Ask the twin:** questions about a patient (“What changed in the last 24 hours?”, “Which medications raise potassium?”) answered only from a numbered list of facts drawn from the record, with every claim cited and linked back to the chart. Claude answers on the published link; built-in rules answer offline. Identifiers and free-text notes are never sent, and every question is audited.
- **Digital twins** of the patient and of the hospital (floors, zones and beds). The patient twin has a **3D anatomy** of 2,234 separately addressable structures (bones, cartilage, ligaments and tendons, 428 muscles, 639 arteries, 404 veins, nerves, brain, heart valves, organs). The patient's record lights up the exact structures it affects, such as 52 coronary branches, liver segments, renal artery branches and retinas. It runs hour by hour to +72 h, with a simulated bedside monitor, lab forecasts with uncertainty bands, drug-level pharmacokinetics and what-if scenarios with doses. Simulations are audited and change nothing.
- **Safety gates** such as allergy checks, controlled-drug confirmation, WHO surgical checklist and
  closed-loop critical results.

## Demo accounts

Every account signs in with one tap on the entry screen. The full list, with what each role can
reach, is in [tessera/README.md](tessera/README.md#demo-accounts).

| Area | Accounts |
|---|---|
| Clinical | Dr. Elena Marsh (cardiology), Dr. Samuel Okafor (general medicine), Dr. Farid Haddad (ER), Dr. Caroline Weiss (surgery), Grace Lin RN (cardiac ICU), Jamal Rivers RN (peri-op), Nadia Kowal PharmD |
| Diagnostics | Ben Okoro (lab), Dr. Hannah Cho (pathology), Dr. Victor Lund (radiology) |
| Front office & revenue | Sofia Alvarez (front desk), Marcus Bell (billing), Rita Gomez (insurance) |
| Quality, leadership & admin | Tomás Reyes (quality), Catherine Moore (CEO), Dana Whitfield and Leo Brandt (admins), Noah Kim (platform) |
| Patient | Radha Bhatt (portal) |

## Tests

Two browser-run suites cover the app. Run them in the browser console at http://localhost:8765 after
**Reset demo data**:

```js
await import('/tests/usecases.js?' + Date.now()).then((m) => m.run())   // 73 end-to-end workflows
await import('/tests/sweep.js?' + Date.now()).then((m) => m.run())      // every page, action, form and dialog
```

## Toward a real backend

The security rules are enforced in the browser today, which is fine for a pitch but not for real patients. [`backend/README.md`](backend/README.md) has the plan for moving them to a server, in five phases. Phase 1 is done: every persisted read and write now goes through one data layer ([`tessera/store.js`](tessera/store.js)) with a demo adapter (today's behaviour) and a live-adapter contract. [`backend/data-access-map.md`](backend/data-access-map.md) lists each data collection with the screens that read and write it.

Phase 2 is done locally: a real API and database in [`backend/`](backend/) with sign-in by password and authenticator code, encrypted identifiers and records, an append-only hash-chained audit log, care relationships checked by the API and again by row-level security, and break-the-glass. The app's live mode (`?mode=live`) uses it for sign-in, patient lists, charts and the audit log. The published link stays in demo mode.

Phase 3 is done locally too. The clinical record (orders, results, notes, lab orders, eMAR, pharmacist verification, vitals, care plans, rapid-response records and medication reconciliation) is stored encrypted on the server, with every version kept. The server enforces the clinical rules: allergy blocks need a doctor's override, signed notes and charted doses can't change, vitals are range-checked, and each role writes only what it may.

Phase 4a puts the rest of the app on the server: front desk, ER registration, lab, radiology, blood bank, billing, insurance, theatre, quality, the admin tools and the portal. Every role gets only the slice of each patient its job needs, and care relationships follow the patient through admission and transfer. The server enforces the cross-department rules: no double-booking, critical labs released only by a pathologist, the contrast check, the two-person blood issue, and separation of duties for role changes. In live mode, every screen for every role now runs on the API.

Phase 4b adds the interfaces:

- **FHIR R4 read API:** Patient, Observation, Condition, AllergyIntolerance, MedicationRequest and DocumentReference. It follows the same access rules as the app and audits every read. Approved apps get tokens that are revoked with the app.
- **Changes feed:** one person's work appears on everyone else's screen.
- **Outbox:** pager, email and SMS messages that never carry patient identity.
- **Privacy Sentinel:** runs on the real audit log.

Phase 5a hardens it:

- **Sign-in:** through Okta, Entra ID or any OpenID Connect provider, with PKCE and MFA asserted by the provider. Authenticator codes work once, and every route is rate limited.
- **Audit log:** its head is signed into write-once storage every 5 minutes, so even a rebuilt chain is caught.
- **Keys and backups:** master key rotation, encrypted backups, and a restore drill that proves the backup works.
- **Monitoring:** health, readiness and metrics, with no health data in logs or metrics.
- **Testing:** a security probe across every route, and a load test (about 1,100 requests a second, p95 under 90 ms).

The threat model is in [`backend/SECURITY.md`](backend/SECURITY.md). Deploying to AWS is next.

## Credits

3D anatomy: BodyParts3D, © The Database Center for Life Science, licensed under [CC Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Meshes were simplified and repacked by [`tools/build_anatomy.py`](tools/build_anatomy.py) (all 2,234 structures kept, 6.68M → 1.6M triangles) and are drawn by a small WebGL viewer in [`tessera/m-anatomy.js`](tessera/m-anatomy.js).
