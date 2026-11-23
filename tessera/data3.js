/* Tessera Health — seed for records & platform modules. Synthetic only. */
(function (SEED) {
  // Home (pre-admission) medication lists for reconciliation
  SEED.homeMeds = {
    P01: ['Telmisartan 40 mg PO daily', 'Atorvastatin 40 mg PO nightly', 'Aspirin 81 mg PO daily', 'Metoprolol tartrate 25 mg PO BID', 'Warfarin 5 mg PO daily', 'Metformin 1000 mg PO BID'],
    P02: ['Amlodipine 10 mg PO daily', 'Rosuvastatin 10 mg PO daily', 'Ibuprofen 400 mg PO PRN (OTC)'],
    P03: ['Omeprazole 20 mg PO daily'],
    P04: ['Furosemide 40 mg PO daily', 'Carvedilol 6.25 mg PO BID', 'Insulin glargine 18 units SC nightly', 'Spironolactone 25 mg PO daily'],
    P08: ['Amlodipine 5 mg PO daily', 'Metformin 500 mg PO BID', 'Naproxen 500 mg PO BID (for knee pain)'],
    P10: [],
    P12: ['Nicotine patch 21 mg/24 h (self-started)'],
    P13: ['Lisinopril 10 mg PO daily']
  };
  SEED.medDecisions = ['Continue', 'Modify', 'Hold', 'Stop'];

  // Common outpatient drugs for the prescription form
  SEED.drugList = ['Amlodipine 5 mg tablet', 'Amlodipine 10 mg tablet', 'Lisinopril 10 mg tablet', 'Losartan 50 mg tablet', 'Metoprolol succinate 25 mg ER tablet', 'Atorvastatin 40 mg tablet', 'Rosuvastatin 20 mg tablet', 'Metformin 500 mg tablet', 'Empagliflozin 10 mg tablet', 'Insulin glargine 100 units/mL pen', 'Albuterol HFA 90 mcg inhaler', 'Budesonide-formoterol 160/4.5 mcg inhaler', 'Amoxicillin 500 mg capsule', 'Amoxicillin-clavulanate 875/125 mg tablet', 'Cephalexin 500 mg capsule', 'Azithromycin 250 mg tablet', 'Omeprazole 20 mg capsule', 'Ondansetron 4 mg ODT', 'Acetaminophen 500 mg tablet', 'Oxycodone 5 mg tablet', 'Enoxaparin 40 mg/0.4 mL syringe'];

  // Synthetic outside records for Document Intelligence (fictional facilities)
  SEED.outsideDocs = [
    { id: 'OD-1', title: 'Discharge summary — Mercy Valley Hospital', kind: 'Discharge summary', source: 'Mercy Valley Hospital (fictional)',
      text: `MERCY VALLEY HOSPITAL — DISCHARGE SUMMARY
Patient: Harish Malhotra    DOB: 03/14/1964    Sex: M
Admitted: 02/03/2025   Discharged: 02/07/2025
Attending: Dr. L. Moreno

DIAGNOSES
1. Acute gout flare, right first MTP joint (M10.071)
2. Atrial fibrillation, on warfarin (I48.91)
3. Chronic kidney disease stage 3a (N18.31)

ALLERGIES
- Penicillin: hives
- Sulfa drugs: rash

DISCHARGE MEDICATIONS
- Allopurinol 100 mg PO daily
- Colchicine 0.6 mg PO daily x 14 days
- Warfarin 5 mg PO daily
- Telmisartan 40 mg PO daily

KEY RESULTS
Uric acid 9.4 mg/dL (high)
Creatinine 1.5 mg/dL (high)
INR 2.6

FOLLOW-UP: Primary care in 2 weeks.` },
    { id: 'OD-2', title: 'Lab report — Bay Diagnostics', kind: 'Lab report', source: 'Bay Diagnostics (fictional reference lab)',
      text: `BAY DIAGNOSTICS — LABORATORY REPORT
Patient: Radha Bhatt    DOB: 09/12/1960
Collected: 10/02/2026   Ordering provider: Dr. S. Okafor

RESULTS
HbA1c 7.9 % (high, ref <5.7)
Creatinine 0.9 mg/dL (ref 0.6-1.1)
eGFR 72 mL/min/1.73m2 (ref >60)
Urine albumin-creatinine ratio 45 mg/g (high, ref <30)
LDL cholesterol 118 mg/dL (high, ref <100)` },
    { id: 'OD-3', title: 'Cardiology letter — Coastal Heart Clinic', kind: 'Consult letter', source: 'Coastal Heart Clinic (fictional)',
      text: `COASTAL HEART CLINIC
Re: Harish Malhotra    DOB: 03/14/1946

Thank you for referring this patient. Echocardiogram shows LVEF 40%.
DIAGNOSES
- Heart failure with mildly reduced ejection fraction (I50.22)
MEDICATIONS
- Sacubitril-valsartan 24/26 mg PO BID
ALLERGIES
- No known drug allergies` }
  ];
  // Simulated network query results (TEFCA-style) by patient
  SEED.hieResults = { P01: ['OD-1'], P08: ['OD-2'] };

  // Order sets (editable in Hospital configuration, used in CPOE)
  SEED.orderSets = [
    { id: 'OS-1', name: 'Chest pain / ACS rule-out', items: [{ type: 'Lab', text: 'Troponin I now and at 3 h' }, { type: 'Lab', text: 'Basic metabolic panel' }, { type: 'Imaging', text: 'XR chest, portable AP' }, { type: 'Medication', text: 'Aspirin 325 mg PO once (chewed)' }, { type: 'Nursing', text: '12-lead ECG within 10 minutes; repeat with pain' }] },
    { id: 'OS-2', name: 'Sepsis hour-1 bundle', items: [{ type: 'Lab', text: 'Lactate now; repeat in 2 h if > 2' }, { type: 'Lab', text: 'Blood cultures x 2 before antibiotics' }, { type: 'Medication', text: 'Piperacillin-tazobactam 4.5 g IV q6h' }, { type: 'Medication', text: 'Lactated Ringer 30 mL/kg IV bolus' }] },
    { id: 'OS-3', name: 'Heart failure exacerbation', items: [{ type: 'Medication', text: 'Furosemide 40 mg IV BID' }, { type: 'Lab', text: 'BMP and magnesium daily' }, { type: 'Nursing', text: 'Daily weights, strict intake/output, 2 g sodium diet' }] }
  ];

  SEED.configDefaults = {
    idleMin: 15, btgHours: 4,
    cds: { allergy: true, interaction: true, duplicate: true, missingDose: true },
    retention: [['Adult medical records', 10], ['Minors (from age 18)', 10], ['Audit logs', 7], ['Ambient audio', 0], ['Incident reports (PSWP)', 10], ['Non-PHI application logs', 1]]
  };

  SEED.interop = {
    base: 'https://fhir.bayview.example/r4',
    uscdi: [['Patient demographics', true], ['Allergies and intolerances', true], ['Problems', true], ['Medications', true], ['Laboratory', true], ['Vital signs', true], ['Clinical notes', true], ['Procedures', true], ['Immunizations', false], ['Care team members', true], ['Goals and health concerns', false], ['Health insurance information', true]],
    apps: [
      { id: 'APP-1', name: 'Bayview Patient App', kind: 'Patient-facing (SMART)', scopes: 'patient/*.read', status: 'Approved' },
      { id: 'APP-2', name: 'Cardiac risk calculator', kind: 'Clinician (SMART EHR launch)', scopes: 'user/Observation.read user/Patient.read', status: 'Approved' },
      { id: 'APP-3', name: 'Third-party wellness app', kind: 'Patient-facing (SMART)', scopes: 'patient/*.read', status: 'Pending security review' }
    ],
    jobs: [
      { id: 'BX-1', kind: 'Bulk FHIR $export to Medicare Advantage plan (HEDIS supplemental data)', resources: 'Patient, Condition, Observation, Encounter', status: 'Completed', when: 'Yesterday 02:00' },
      { id: 'BX-2', kind: 'Payer-to-payer exchange (CMS-0057)', resources: 'Claims, encounters, prior authorizations', status: 'Scheduled', when: 'Tonight 02:00' }
    ]
  };
})(window.TESSERA_SEED);
