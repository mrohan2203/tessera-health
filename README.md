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
await import('/tests/usecases.js?' + Date.now()).then((m) => m.run())   // 68 end-to-end workflows
await import('/tests/sweep.js?' + Date.now()).then((m) => m.run())      // every page, action, form and dialog
```

## Credits

3D anatomy: BodyParts3D, © The Database Center for Life Science, licensed under [CC Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Meshes were simplified and repacked by [`tools/build_anatomy.py`](tools/build_anatomy.py) (all 2,234 structures kept, 6.68M → 1.6M triangles) and are drawn by a small WebGL viewer in [`tessera/m-anatomy.js`](tessera/m-anatomy.js).
