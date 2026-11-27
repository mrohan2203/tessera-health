# Tessera Health — pitch prototype

A clickable hospital management system prototype for pitching. It uses synthetic data only and isn't for clinical use.
Nothing is real-time. All changes stay in the viewer's browser (localStorage). Use **Reset demo data** on the sign-in screen to start over.

## Run locally

```bash
cd tessera && python3 -m http.server 8765
```

Then open http://localhost:8765.

## Demo accounts

Every account uses the same demo password: `Tessera-Pitch-ffb43d`
The sign-in screen groups one-click demo buttons by area. They still go through the MFA step.

| Username | Role | What they can reach |
|---|---|---|
| elena.cardio | Physician, Cardiology | Cardiology patients + consults: Ambient Doctor, telemedicine, CPOE, ICU, handover, pathways, discharge |
| samuel.gmed | Physician, General Medicine | General Medicine patients + consults |
| farid.er | Physician, Emergency | ER board (ESI), unknown-patient registration and identity merge, admit requests |
| caroline.surgery | Physician, General Surgery | OT suite with WHO checklist gating, surgical consents |
| grace.rn | Nurse, Cardiac ICU | Unit board, eMAR with barcode scan, ICU board, handover, unit infection control |
| jamal.periop | Nurse, Peri-op & day care | OT suite, PACU, day care bays |
| nadia.pharm | Pharmacist | Verification, inventory, controlled-substance counts, discharge meds |
| ben.lab | Lab scientist | Lab worklist (collect → receive → result), blood bank |
| hannah.path | Pathologist | Verifies abnormal results, phones criticals |
| victor.rad | Radiologist | RIS worklist, contrast safety check, structured reports. No chart access |
| sofia.frontdesk | Front desk | OPD queue, registration with duplicate check, appointments, bed board, reminders. No clinical details |
| marcus.billing | Billing | Accounts, claims, itemized charges, discharge billing step |
| rita.insurance | Insurance desk | Prior auth, payer queries, claim attachments. Document names only |
| tomas.quality | Quality | HEDIS, care gaps (de-identified), infection control, incidents |
| catherine.ceo | Executive | Command center, analytics, finance. Aggregates only; small counts suppressed |
| dana.admin / leo.admin | Admin | Users, two-person role changes, audit chain, access review, assets, staffing. No chart access |
| radha.patient | Patient (portal) | Own visits, results, meds, bills, and who viewed her record |
| ruth.peds | Physician (suspended) | Sign-in blocked |

## A 10-minute pitch path

1. **Front desk (sofia.frontdesk):** register "Radha Bhat", DOB 1960-09-12. The duplicate check catches the existing Radha Bhatt.
2. **ER (farid.er):** identify "Unknown Male · Trauma-0412" (the alias merges into one record), then admit Prakash Rangan to the Cardiac ICU.
3. **Front desk:** on the bed board, assign the ICU bed.
4. **Radiology (victor.rad):** the CT chest for Lalitha Varma is blocked by her eGFR of 28. Read the CT head and sign the subdural hematoma finding as critical.
5. **Lab (ben.lab → hannah.path):** a potassium of 6.4 is held, then verified, phoned and opened as a closed-loop result.
6. **Ambient Doctor (elena.cardio):** record consent, press **Start listening** and role-play the visit (switch the speaker buttons as you talk), then **End capture and draft note**. Claude drafts the SOAP note, codes and orders; sign it and the orders go to CPOE and the codes to billing. On the published link, speech goes through claude.ai dictation and drafting through Claude; each asks permission the first time. Locally, Chrome's speech recognition is used and the draft is rule-based. **Role-play only: never use real patients.**
7. **OT (jamal.periop):** surgery can't start until sign-in and time-out are checked.
8. **Insurance (rita.insurance):** attach documents, submit and approve. The discharge billing step unblocks.
9. **Patient (radha.patient):** "Who viewed my record" lists every staff access with its purpose.
10. **Admin (dana.admin):** Verify chain on the audit log.

## New in this batch

| Feature | Where | Try it |
|---|---|---|
| Notifications | Bell in the top bar, every role | Each role sees only its own work: criticals, signatures, payer queries, break-the-glass reviews… |
| Global search | Top bar or Ctrl/⌘+K | As elena.cardio search "vihaan" (marked restricted). As tomas.quality, patient search is not offered. Every patient search is logged. |
| OP case sheet | Physician › Clinic | Type a systolic of 184 and watch the flag; signing updates vitals and the problem list |
| Prescriptions | Physician › Clinic | Amoxicillin for Anita Deshmukh triggers an allergy override; oxycodone requires EPCS confirmation; approve a refill requested in the patient portal |
| Risk assessments | Physician and nurse › Inpatient | Morse, Braden and Padua scores update live; a Padua of 4 or more with no anticoagulant offers a VTE prophylaxis order |
| Medication reconciliation | Physician and pharmacist | Admission and discharge reconciliation; the pharmacist verifies |
| Discharge summary | Discharge › "Write summary" | Can't be signed until discharge medicines are reconciled (Joint Commission NPSG.03.06.01); instructions then appear in the patient portal |
| Clinical timeline | Chart › Timeline tab | Every source in one chronological view, filterable |
| Document intelligence | Physician › Records | Load the "DOB typo" sample: it is quarantined until a person confirms the match. Filed items are labeled as outside records |
| Data exchange (FHIR) | Admin › Configuration | Replaces Olir One's India-only ABDM module: FHIR R4, SMART apps, USCDI coverage, bulk export |
| Hospital configuration | Admin › Configuration | Idle timeout, break-the-glass length, safety-check toggles (the allergy check can't be turned off), order sets used in CPOE, retention schedule |

## Remaining Olir One modules

| Module | Who | What to try |
|---|---|---|
| Doctor Live | Physicians | Patients ranked by an explained attention score (NEWS2, open criticals, unsigned orders, urgent tasks, ER waits) |
| My work | Every staff role | Everything waiting on you from every module, plus personal to-dos |
| Encounters | Physicians, front desk | All visit types in one list; the front desk sees no diagnoses |
| Credentials & privileges | Admin | License, DEA, board and life-support expiry; procedure privileges. An expired DEA registration blocks controlled prescriptions |
| Consent management | Physicians; patients in the portal | Templates, required risk checklist, witness and interpreter, drawn e-signature; revocation flows to research, ambient recording and OT |
| Blood bank donors & processing | Lab | Donor eligibility, donation → seven infectious-disease tests → release; a reactive test discards the unit and defers the donor |
| Hospital map (digital twin) | Admin, executive, front desk | Floor-by-floor occupancy and equipment status, counts only |
| My vault | Patient | Share chosen records with a time-limited code; opens appear in "Who viewed my record" |
| Research & cohorts | Quality | IRB studies, cohort counts with small-cell suppression, Safe Harbor extracts; research opt-outs always excluded |
| Platform administration | noah.platform | Tenants, KMS key rotation, restore tests, support access approved by the tenant admin (Hospital configuration) |

## New modules (beyond Olir One)

| Module | Problem it solves | Try it |
|---|---|---|
| Privacy Sentinel | Snooping is usually found only after a complaint | As jamal.periop open three Cardiac ICU charts (blocked), then as dana.admin open Privacy Sentinel and run the HIPAA breach risk assessment |
| Alert burden | Alert fatigue is a safety risk nobody measures | As tomas.quality or dana.admin: the duplicate-therapy alert is overridden 84% of the time with no harm prevented; make it passive in one click |
| Social needs | CMS now requires social-needs screening (SDOH-1/2), but referrals rarely close the loop | Screen a patient as samuel.gmed, refer, then follow up as sofia.frontdesk. Safety answers stay with the care team |
| Good faith estimates | No Surprises Act estimates are usually built by hand | As marcus.billing create and deliver an estimate; radha.patient sees it under Bills; bills $400+ over the estimate are flagged as dispute-eligible |
| Capacity forecast | Bed boards show now, not tomorrow | As catherine.ceo move the "what if the ER sends more" slider and read the drivers behind each number |
| Family updates | Families phone the unit for status; staff can't share details | radha.patient's spouse is listed; when jamal.periop completes her OT case, a status-only message goes out automatically |
| Patient digital twin | Risk lives in a dozen tabs; nobody sees the whole patient or what a change would do | As elena.cardio open Harish Malhotra › Twin: eight views on an hourly timeline to +72 h (press Play). Anatomy 3D: 2,234 BodyParts3D structures (bones, cartilage, ligaments, muscles, arteries, veins, nerves, organs) with layers, explode, x-ray, isolate, search, and the record mapped onto exact structures (click “Coronary arteries” to isolate 52 branches; select any structure for its FMA ID, size and what in the record points to it). Overview: organ-level body map, simulated bedside monitor (ECG changes with projected potassium; AF is irregular), nine computed scores, five risks including stroke, and what-if levers with doses and timing (try vitamin K 1 mg vs 10 mg, or restarting warfarin at +24 h). Forecast: potassium, INR, creatinine, glucose, NEWS2 and heart rate with 80% bands and every threshold crossed. Drug levels: one-compartment PK on the ward schedule, CrCl-adjusted (meropenem time above MIC). Physiology, Medications (drug-to-organ map, renal dosing, interactions), Scenarios (save and compare) and Sources (inputs, confidence, models, what it never reads). Simulations are audited and order nothing |
| Hospital digital twin | Bed boards are lists, not a building | As catherine.ceo open Hospital map: floors, zones and numbered beds by occupancy and NEWS2, with equipment alerts. No patient names |

## Testing

Two suites run in the browser against the local server (http://localhost:8765). Run each from a clean state: "Reset demo data" on the sign-in screen.

```js
// 1. Sweep: every account, every page, every button, every form and dialog
await import('/tests/sweep.js?' + Date.now()).then((m) => m.run())
// 2. Use cases: 66 real workflows across all roles, each with an expected outcome
await import('/tests/usecases.js?' + Date.now()).then((m) => m.run())
```

Last run: sweep 237 pages, 1,095 actions, 162 forms, 38 dialogs, 0 issues (desktop); use cases 66/66 passed.

## Files

- `data.js`, `data2.js`: synthetic seed data
- `app.js`: core (sign-in, MFA, access policy, audit chain, chart, CPOE, eMAR, pharmacy, billing, HEDIS, admin)
- `m-clinical.js`: Ambient Doctor, telemedicine, ER, ICU, beds, handover, pathways, discharge, OT, day care
- `m-diagnostics.js`: lab, radiology, blood bank
- `m-frontdesk.js`: OPD queue, registration, appointments, engagement, insurance desk, patient portal
- `m-ops.js`: command center, analytics, finance, assets, staffing, infection control, incidents, itemized billing
- `data3.js`: home medication lists, synthetic outside records, order sets, configuration defaults
- `m-records.js`: OP case sheet, prescriptions, risk assessments, medication reconciliation, discharge summary, timeline, document intelligence
- `m-platform.js`: notifications, global search, hospital configuration, data exchange, order sets in CPOE
- `m-homes.js`: role home visuals
- `data4.js`: credentials, donors, consent templates, floors, studies, tenants, privacy and alert history, social-needs partners, prices
- `m-more.js`: Doctor Live, My work, encounters, credentials, consents, blood donors and processing, hospital map, vault, research, platform
- `m-novel.js`: Privacy Sentinel, alert burden, social needs, good faith estimates, capacity forecast, family updates
