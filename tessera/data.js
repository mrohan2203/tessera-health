/* Tessera Health — synthetic seed data for the pitch demo.
   Every person below is fictional. Clinical profiles are modeled on a reference HMS demo, names changed.
   Dates are stored as day offsets from "today" (dOff) and minute offsets (mOff) so the demo never goes stale.
   Demo passwords are stored as SHA-256 hashes only; see README.md for the shared demo password. */
window.TESSERA_SEED = {
  org: { name: "Bayview Regional Medical Center", tenant: "bayview", facility: "Main Campus" },

  departments: { CARD: "Cardiology", GMED: "General Medicine", PEDS: "Pediatrics" },
  units: { CICU: "Cardiac ICU", W4B: "Ward 4B · Med-Surg", PEDW: "Pediatric Ward" },

  // role: admin | doctor | nurse | pharmacist | billing | quality
  users: [
    { id: "U-1001", name: "Dana Whitfield", username: "dana.admin", role: "admin", title: "Tenant administrator", mfa: "Security key", status: "active", lastSignIn: -1 },
    { id: "U-1002", name: "Leo Brandt", username: "leo.admin", role: "admin", title: "Tenant administrator (second approver)", mfa: "Authenticator app", status: "active", lastSignIn: -3 },
    { id: "U-2001", name: "Dr. Elena Marsh", username: "elena.cardio", role: "doctor", dept: "CARD", title: "Attending, Cardiology", mfa: "Security key", status: "active", lastSignIn: 0 },
    { id: "U-2002", name: "Dr. Samuel Okafor", username: "samuel.gmed", role: "doctor", dept: "GMED", title: "Attending, General Medicine", mfa: "Authenticator app", status: "active", lastSignIn: 0 },
    { id: "U-3001", name: "Grace Lin, RN", username: "grace.rn", role: "nurse", unit: "CICU", title: "Charge nurse, Cardiac ICU", mfa: "Badge tap + PIN", status: "active", lastSignIn: 0 },
    { id: "U-4001", name: "Nadia Kowal, PharmD", username: "nadia.pharm", role: "pharmacist", title: "Clinical pharmacist", mfa: "Authenticator app", status: "active", lastSignIn: 0 },
    { id: "U-5001", name: "Marcus Bell", username: "marcus.billing", role: "billing", title: "Revenue cycle specialist", mfa: "Authenticator app", status: "active", lastSignIn: -1 },
    { id: "U-6001", name: "Tomás Reyes", username: "tomas.quality", role: "quality", title: "Quality & HEDIS analyst", mfa: "Authenticator app", status: "active", lastSignIn: -2 },
    { id: "U-2003", name: "Dr. Ruth Adeyemi", username: "ruth.peds", role: "doctor", dept: "PEDS", title: "Attending, Pediatrics", mfa: "Not enrolled", status: "suspended", lastSignIn: -48 }
  ],
  passwordHash: "7aeeb6b5a4403a46b00ef775e0d91d72c60a257609db841378e8eeb1e9e7e241",

  patients: [
    { id: "P01", mrn: "100241", name: "Harish Malhotra", age: 62, sex: "M", dob: "1964-03-14", phone: "4155550142", dept: "CARD", consults: ["GMED"], unit: "CICU", bed: "CICU-3", status: "Admitted", attending: "U-2001",
      payer: "Medicare Part A/B", memberId: "1EG4TE5MK73", code: "Full code", weightKg: 82, heightCm: 172,
      allergies: [{ agent: "Penicillin", reaction: "Hives", severity: "Moderate" }],
      problems: ["Type 2 diabetes mellitus (E11.9)", "Hypertension (I10)", "Coronary artery disease, s/p MI 2023 (I25.2)", "CKD stage 3a (N18.31)", "Atrial fibrillation on warfarin (I48.91)"],
      vitals: { bp: "148/88", hr: 92, rr: 18, temp: 98.4, spo2: 95 },
      meds: [
        { drug: "Telmisartan", dose: "40 mg", route: "PO", freq: "Daily", status: "Pending signature" },
        { drug: "Atorvastatin", dose: "", route: "PO", freq: "Nightly", status: "Pending signature" },
        { drug: "Aspirin", dose: "81 mg", route: "PO", freq: "Daily", status: "Active" },
        { drug: "Metoprolol tartrate", dose: "25 mg", route: "PO", freq: "BID", status: "Active" },
        { drug: "Warfarin", dose: "Held", route: "PO", freq: "Daily", status: "Held — INR 5.8" }
      ],
      labs: [
        { test: "Potassium", loinc: "2823-3", value: "6.1", unit: "mmol/L", ref: "3.5–5.1", flag: "HH", dOff: 0 },
        { test: "Creatinine", loinc: "2160-0", value: "1.6", unit: "mg/dL", ref: "0.7–1.3", flag: "H", dOff: 0 },
        { test: "eGFR", loinc: "33914-3", value: "48", unit: "mL/min/1.73m²", ref: ">60", flag: "L", dOff: 0 },
        { test: "INR", loinc: "6301-6", value: "5.8", unit: "", ref: "2.0–3.0", flag: "HH", dOff: -1 },
        { test: "HbA1c", loinc: "4548-4", value: "8.4", unit: "%", ref: "<7.0", flag: "H", dOff: -12 }
      ] },
    { id: "P02", mrn: "100587", name: "Anita Deshmukh", age: 52, sex: "F", dob: "1974-07-02", phone: "4155550188", dept: "CARD", unit: "W4B", bed: "4B-12", status: "Admitted", attending: "U-2001",
      payer: "Aetna PPO", memberId: "W229184471", code: "Full code", weightKg: 68, heightCm: 160,
      allergies: [{ agent: "Penicillin", reaction: "Anaphylaxis", severity: "Severe" }],
      problems: ["NSTEMI, rule-out (I21.4)", "Hyperlipidemia (E78.5)", "Hypertension (I10)"],
      vitals: { bp: "136/82", hr: 88, rr: 16, temp: 99.1, spo2: 97 },
      meds: [
        { drug: "Amoxicillin", dose: "500 mg", route: "PO", freq: "TID", status: "Pending signature" },
        { drug: "Amlodipine", dose: "10 mg", route: "PO", freq: "Daily", status: "Active" },
        { drug: "Heparin infusion", dose: "per protocol", route: "IV", freq: "Continuous", status: "Active" }
      ],
      labs: [
        { test: "Troponin I", loinc: "10839-9", value: "0.9", unit: "ng/mL", ref: "<0.04", flag: "HH", dOff: 0 },
        { test: "LDL cholesterol", loinc: "13457-7", value: "148", unit: "mg/dL", ref: "<100", flag: "H", dOff: -2 },
        { test: "HbA1c", loinc: "4548-4", value: "5.6", unit: "%", ref: "<5.7", flag: "", dOff: -2 }
      ] },
    { id: "P03", mrn: "101032", name: "Kiran Bhosale", age: 34, sex: "M", dob: "1992-01-21", phone: "5105550117", dept: "GMED", consults: ["SURG"], unit: "W4B", bed: "4B-07", status: "Admitted", attending: "U-2002",
      payer: "Blue Shield of California HMO", memberId: "XEB884120933", code: "Full code", weightKg: 77, heightCm: 178,
      allergies: [],
      problems: ["Sepsis due to perforated appendicitis (A41.9, K35.20)", "s/p laparoscopic appendectomy today", "GERD (K21.9)"],
      vitals: { bp: "102/64", hr: 112, rr: 22, temp: 101.6, spo2: 94 },
      meds: [
        { drug: "Pantoprazole", dose: "40 mg", route: "IV", freq: "Daily", status: "Active" },
        { drug: "Omeprazole", dose: "20 mg", route: "PO", freq: "Daily", status: "Pending signature" },
        { drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV", freq: "q6h", status: "Active" }
      ],
      labs: [
        { test: "Lactate", loinc: "2524-7", value: "4.2", unit: "mmol/L", ref: "0.5–2.2", flag: "HH", dOff: 0 },
        { test: "WBC", loinc: "6690-2", value: "17.8", unit: "10³/µL", ref: "4.5–11.0", flag: "H", dOff: 0 }
      ] },
    { id: "P04", mrn: "100912", name: "Lalitha Varma", age: 69, sex: "F", dob: "1957-05-09", phone: "4085550163", dept: "CARD", unit: "CICU", bed: "CICU-1", status: "Admitted", attending: "U-2001",
      payer: "Medicare Advantage — Humana", memberId: "H41295530", code: "DNR/DNI", weightKg: 71, heightCm: 158,
      allergies: [{ agent: "Sulfonamides", reaction: "Rash", severity: "Mild" }],
      problems: ["Acute on chronic systolic heart failure (I50.23)", "Type 2 diabetes mellitus (E11.9)"],
      vitals: { bp: "118/70", hr: 98, rr: 24, temp: 98.2, spo2: 91 },
      meds: [
        { drug: "Furosemide", dose: "40 mg", route: "IV", freq: "BID", status: "Active" },
        { drug: "Carvedilol", dose: "6.25 mg", route: "PO", freq: "BID", status: "Active" },
        { drug: "Insulin glargine", dose: "18 units", route: "SC", freq: "Nightly", status: "Active" }
      ],
      labs: [
        { test: "BNP", loinc: "30934-4", value: "1840", unit: "pg/mL", ref: "<100", flag: "H", dOff: 0 },
        { test: "Sodium", loinc: "2951-2", value: "131", unit: "mmol/L", ref: "135–145", flag: "L", dOff: 0 },
        { test: "eGFR", loinc: "33914-3", value: "28", unit: "mL/min/1.73m²", ref: ">60", flag: "L", dOff: 0 },
        { test: "HbA1c", loinc: "4548-4", value: "7.6", unit: "%", ref: "<7.0", flag: "H", dOff: -30 }
      ] },
    { id: "P05", mrn: "102214", name: "Suresh Pillai", age: 54, sex: "M", dob: "1972-11-30", phone: "6505550109", dept: "CARD", unit: null, bed: null, status: "Outpatient", attending: "U-2001",
      payer: "UnitedHealthcare Choice Plus", memberId: "UHC90021457", code: "Full code", weightKg: 90, heightCm: 180,
      allergies: [],
      problems: ["Palpitations (R00.2)", "Hypertension (I10)"],
      vitals: { bp: "132/84", hr: 104, rr: 16, temp: 98.6, spo2: 98 },
      meds: [{ drug: "Lisinopril", dose: "10 mg", route: "PO", freq: "Daily", status: "Active" }],
      labs: [{ test: "TSH", loinc: "3016-3", value: "0.9", unit: "mIU/L", ref: "0.4–4.0", flag: "", dOff: -20 }] },
    { id: "P06", mrn: "102398", name: "Kavya Ramesh", age: 31, sex: "F", dob: "1995-08-17", phone: "4155550175", dept: "GMED", unit: null, bed: null, status: "Outpatient", attending: "U-2002",
      payer: "Cigna Open Access", memberId: "U77310245", code: "Full code", weightKg: 59, heightCm: 165,
      allergies: [{ agent: "Latex", reaction: "Contact dermatitis", severity: "Mild" }],
      problems: ["Moderate persistent asthma (J45.40)"],
      vitals: { bp: "114/72", hr: 76, rr: 14, temp: 98.1, spo2: 99 },
      meds: [{ drug: "Budesonide-formoterol", dose: "160/4.5 mcg", route: "Inhaled", freq: "BID", status: "Active" }],
      labs: [] },
    { id: "P07", mrn: "101765", name: "Meera Kulkarni", age: 58, sex: "F", dob: "1968-02-25", phone: "4085550131", dept: "CARD", consults: ["SURG"], unit: null, bed: null, status: "Day surgery", attending: "U-2001",
      payer: "Aetna Medicare Advantage", memberId: "W118804512", code: "Full code", weightKg: 64, heightCm: 157,
      allergies: [{ agent: "Sulfa drugs", reaction: "Stevens-Johnson (2009)", severity: "Severe" }],
      problems: ["CAD, s/p PCI to LAD (Z95.5)", "Symptomatic cholelithiasis (K80.20)", "Hyperlipidemia (E78.5)"],
      vitals: { bp: "126/78", hr: 68, rr: 14, temp: 98.3, spo2: 98 },
      meds: [
        { drug: "Clopidogrel", dose: "75 mg", route: "PO", freq: "Daily", status: "Held 5 days pre-op" },
        { drug: "Rosuvastatin", dose: "20 mg", route: "PO", freq: "Daily", status: "Active" }
      ],
      labs: [{ test: "LDL cholesterol", loinc: "13457-7", value: "72", unit: "mg/dL", ref: "<70", flag: "H", dOff: -40 }] },
    { id: "P08", mrn: "100455", name: "Radha Bhatt", age: 66, sex: "F", dob: "1960-09-12", phone: "6505550194", dept: "SURG", consults: ["GMED"], unit: "PACU", bed: "PACU-1", status: "Admitted", attending: "U-2005",
      payer: "Medicare Part A/B", memberId: "7KP2RW3TX81", code: "Full code", weightKg: 74, heightCm: 155,
      allergies: [],
      problems: ["Hypertension, uncontrolled (I10)", "Type 2 diabetes mellitus (E11.9)", "Primary osteoarthritis, left knee (M17.12)", "s/p left total knee arthroplasty today"],
      vitals: { bp: "152/94", hr: 80, rr: 15, temp: 98.0, spo2: 97 },
      meds: [
        { drug: "Amlodipine", dose: "5 mg", route: "PO", freq: "Daily", status: "Active" },
        { drug: "Metformin", dose: "500 mg", route: "PO", freq: "BID", status: "Active" }
      ],
      labs: [{ test: "HbA1c", loinc: "4548-4", value: "7.2", unit: "%", ref: "<7.0", flag: "H", dOff: -75 }] },
    { id: "P09", mrn: "100118", name: "Gopal Narayanan", age: 76, sex: "M", dob: "1950-04-03", phone: "5105550126", dept: "GMED", unit: null, bed: null, status: "Outpatient", attending: "U-2002",
      payer: "Medicare Part B + Medigap G", memberId: "3QD9MN2RA46", code: "Full code", weightKg: 69, heightCm: 168,
      allergies: [],
      problems: ["Diabetic foot ulcer, right heel (E11.621, L97.419)", "Type 2 diabetes mellitus, poorly controlled (E11.65)", "Peripheral neuropathy (G62.9)"],
      vitals: { bp: "138/80", hr: 74, rr: 16, temp: 98.9, spo2: 96 },
      meds: [
        { drug: "Insulin glargine", dose: "24 units", route: "SC", freq: "Nightly", status: "Active" },
        { drug: "Metformin", dose: "1000 mg", route: "PO", freq: "BID", status: "Active" }
      ],
      labs: [{ test: "HbA1c", loinc: "4548-4", value: "9.6", unit: "%", ref: "<7.0", flag: "H", dOff: -21 }] },
    { id: "P10", mrn: "102655", name: "Vihaan Choudhary", age: 7, sex: "M", dob: "2019-06-20", phone: "4155550157", dept: "PEDS", unit: "PEDW", bed: "PW-2", status: "Admitted", attending: "U-2003",
      payer: "Medi-Cal (Medicaid)", memberId: "91442087A", code: "Full code", weightKg: 23, heightCm: 122,
      allergies: [],
      problems: ["Acute streptococcal pharyngitis (J02.0)", "Dehydration (E86.0)"],
      vitals: { bp: "98/60", hr: 118, rr: 22, temp: 102.4, spo2: 98 },
      meds: [{ drug: "Acetaminophen", dose: "15 mg/kg", route: "PO", freq: "q6h PRN", status: "Active" }],
      labs: [{ test: "Rapid strep antigen", loinc: "78012-2", value: "Positive", unit: "", ref: "Negative", flag: "A", dOff: 0 }] },
    { id: "P11", mrn: "101487", name: "Imran Siddiqui", age: 38, sex: "M", dob: "1988-10-05", phone: "5105550183", dept: "GMED", unit: null, bed: null, status: "Outpatient", attending: "U-2002",
      payer: "Anthem Blue Cross PPO", memberId: "XBC33104876", code: "Full code", weightKg: 96, heightCm: 176,
      allergies: [],
      problems: ["Hypertension (I10)", "Obesity, BMI 31 (E66.9)"],
      vitals: { bp: "146/92", hr: 82, rr: 14, temp: 98.4, spo2: 98 },
      meds: [{ drug: "Losartan", dose: "50 mg", route: "PO", freq: "Daily", status: "Active" }],
      labs: [] },
    { id: "P12", mrn: "100033", name: "Arvind Sethi", age: 58, sex: "M", dob: "1968-12-11", phone: "4085550199", dept: "CARD", unit: "CICU", bed: "CICU-2", status: "Admitted", attending: "U-2001",
      payer: "UnitedHealthcare Medicare Advantage", memberId: "UHC77120934", code: "Full code", weightKg: 88, heightCm: 175,
      allergies: [{ agent: "Latex", reaction: "Urticaria", severity: "Moderate" }],
      problems: ["NSTEMI (I21.4)", "Hyperlipidemia (E78.5)", "Tobacco use (F17.210)"],
      vitals: { bp: "128/76", hr: 72, rr: 16, temp: 98.6, spo2: 97 },
      meds: [
        { drug: "Aspirin", dose: "81 mg", route: "PO", freq: "Daily", status: "Active" },
        { drug: "Metoprolol tartrate", dose: "25 mg", route: "PO", freq: "BID", status: "Active" },
        { drug: "Atorvastatin", dose: "80 mg", route: "PO", freq: "Nightly", status: "Active" }
      ],
      labs: [{ test: "Troponin I", loinc: "10839-9", value: "0.42", unit: "ng/mL", ref: "<0.04", flag: "H", dOff: 0 }] }
  ],

  // Today's clinic (hh:mm local)
  appointments: [
    { patient: "P07", time: "08:30", reason: "Post-PCI review", provider: "U-2001", status: "Completed" },
    { patient: "P05", time: "09:15", reason: "Palpitations, Holter results", provider: "U-2001", status: "In room" },
    { patient: "P01", time: "10:00", reason: "Inpatient consult — CKD and potassium", provider: "U-2002", status: "Scheduled" },
    { patient: "P08", time: "10:30", reason: "BP and diabetes follow-up", provider: "U-2002", status: "Arrived" },
    { patient: "P09", time: "11:00", reason: "Diabetic foot check", provider: "U-2002", status: "Waiting" },
    { patient: "P11", time: "11:45", reason: "Hypertension follow-up", provider: "U-2002", status: "No-show" },
    { patient: "P06", time: "14:00", reason: "Asthma control review", provider: "U-2002", status: "Scheduled" },
    { patient: "P02", time: "15:30", reason: "Cardiology rounds note", provider: "U-2001", status: "Scheduled" }
  ],

  // CPOE. flag: allergy | interaction | duplicate | missing-dose
  orders: [
    { id: "O-501", patient: "P01", type: "Lab", text: "Potassium + 12-lead ECG — STAT, repeat in 2h", priority: "STAT", status: "Active", by: "U-2001" },
    { id: "O-502", patient: "P01", type: "Medication", text: "Telmisartan 40 mg PO daily", priority: "Routine", status: "Pending signature", by: "U-2001",
      flag: { kind: "interaction", text: "ARB with serum potassium 6.1 mmol/L (critical high). Consider holding and rechecking." } },
    { id: "O-503", patient: "P01", type: "Medication", text: "Atorvastatin PO nightly", priority: "Routine", status: "Pending signature", by: "U-2001",
      flag: { kind: "missing-dose", text: "Ordered without a dose. Add a dose before signing." } },
    { id: "O-504", patient: "P02", type: "Medication", text: "Amoxicillin 500 mg PO TID", priority: "Routine", status: "Pending signature", by: "U-2001",
      flag: { kind: "allergy", text: "Documented penicillin allergy (anaphylaxis). Amoxicillin is a penicillin-class antibiotic." } },
    { id: "O-505", patient: "P02", type: "Lab", text: "Lipid panel + HbA1c, fasting", priority: "Routine", status: "Completed", by: "U-2001" },
    { id: "O-506", patient: "P03", type: "Medication", text: "Omeprazole 20 mg PO daily", priority: "Routine", status: "Pending signature", by: "U-2002",
      flag: { kind: "duplicate", text: "Pantoprazole 40 mg IV is already active. Two proton-pump inhibitors." } },
    { id: "O-507", patient: "P03", type: "Imaging", text: "Chest X-ray, PA, portable", priority: "Urgent", status: "Active", by: "U-2002" },
    { id: "O-508", patient: "P04", type: "Medication", text: "Furosemide 40 mg IV BID", priority: "Routine", status: "Signed", by: "U-2001" },
    { id: "O-509", patient: "P12", type: "Medication", text: "Atorvastatin 80 mg PO nightly", priority: "Routine", status: "Signed", by: "U-2001" },
    { id: "O-510", patient: "P03", type: "Medication", text: "Piperacillin-tazobactam 4.5 g IV q6h", priority: "STAT", status: "Signed", by: "U-2002" }
  ],

  // Closed-loop critical results. mOff = minutes ago reported. slaMin = acknowledgement SLA
  results: [
    { id: "R-801", patient: "P01", test: "Potassium", value: "6.1 mmol/L", flag: "HH", ref: "3.5–5.1", lab: "Chemistry", mOff: 52, slaMin: 30, state: "New", trail: [] },
    { id: "R-802", patient: "P02", test: "Troponin I", value: "0.9 ng/mL", flag: "HH", ref: "<0.04", lab: "Chemistry", mOff: 34, slaMin: 30, state: "Acknowledged",
      trail: [{ who: "Dr. Elena Marsh", what: "Acknowledged", mOff: 27 }] },
    { id: "R-803", patient: "P03", test: "Lactate", value: "4.2 mmol/L", flag: "HH", ref: "0.5–2.2", lab: "Blood gas lab", mOff: 96, slaMin: 30, state: "Owned",
      trail: [{ who: "Dr. Samuel Okafor", what: "Acknowledged", mOff: 90 }, { who: "Dr. Samuel Okafor", what: "Took ownership — 30 mL/kg fluids started", mOff: 86 }] },
    { id: "R-804", patient: "P01", test: "INR", value: "5.8", flag: "HH", ref: "2.0–3.0", lab: "Coagulation", mOff: 1110, slaMin: 30, state: "Closed",
      trail: [{ who: "Dr. Elena Marsh", what: "Acknowledged", mOff: 1100 }, { who: "Dr. Elena Marsh", what: "Closed — warfarin held, vitamin K 2.5 mg PO", mOff: 1080 }] },
    { id: "R-805", patient: "P10", test: "Rapid strep antigen", value: "Positive", flag: "A", ref: "Negative", lab: "Microbiology", mOff: 40, slaMin: 60, state: "New", trail: [] }
  ],

  // eMAR schedule for inpatients. time slots for today.
  mar: [
    { patient: "P12", drug: "Aspirin 81 mg PO", times: ["06:00"], barcode: "NDC 0904-7920" },
    { patient: "P12", drug: "Metoprolol tartrate 25 mg PO", times: ["06:00", "18:00"], barcode: "NDC 0378-0018" },
    { patient: "P12", drug: "Atorvastatin 80 mg PO", times: ["22:00"], barcode: "NDC 0071-0158" },
    { patient: "P01", drug: "Aspirin 81 mg PO", times: ["08:00"], barcode: "NDC 0904-7920" },
    { patient: "P01", drug: "Metoprolol tartrate 25 mg PO", times: ["08:00", "20:00"], barcode: "NDC 0378-0018" },
    { patient: "P04", drug: "Furosemide 40 mg IV", times: ["08:00", "16:00"], barcode: "NDC 0641-6145" },
    { patient: "P04", drug: "Carvedilol 6.25 mg PO", times: ["08:00", "20:00"], barcode: "NDC 0007-4140" },
    { patient: "P04", drug: "Insulin glargine 18 units SC", times: ["21:00"], barcode: "NDC 0088-2220" }
  ],
  // pre-charted administrations: key patient|drug|time -> state
  marCharted: {
    "P12|Aspirin 81 mg PO|06:00": { state: "Missed", note: "Patient NPO for cath; not given" },
    "P12|Metoprolol tartrate 25 mg PO|06:00": { state: "Given", by: "Grace Lin, RN" },
    "P01|Aspirin 81 mg PO|08:00": { state: "Given", by: "Grace Lin, RN" }
  },

  // Pharmacy inventory. expDays relative to today.
  inventory: [
    { item: "Metformin 500 mg tab", lot: "MET-2401", expDays: 585, qty: 4200, reorder: 1000, location: "Main pharmacy" },
    { item: "Amlodipine 5 mg tab", lot: "AML-2312", expDays: 8, qty: 320, reorder: 500, location: "Main pharmacy" },
    { item: "Sodium chloride 0.9% 500 mL", lot: "NS-2405", expDays: -38, qty: 90, reorder: 200, location: "Ward 4B ADC" },
    { item: "Heparin 5,000 units/mL vial", lot: "HEP-2409", expDays: 210, qty: 140, reorder: 60, location: "CICU ADC" },
    { item: "Furosemide 10 mg/mL inj", lot: "FUR-2411", expDays: 44, qty: 55, reorder: 40, location: "CICU ADC" },
    { item: "Piperacillin-tazobactam 4.5 g vial", lot: "PTZ-2502", expDays: 330, qty: 36, reorder: 50, location: "Main pharmacy" },
    { item: "Nitrile gloves (M)", lot: "GLV-2403", expDays: 800, qty: 15000, reorder: 3000, location: "Central supply" }
  ],
  controlled: [
    { item: "Oxycodone 5 mg tab", schedule: "CII", onHand: 240, lastCount: -1 },
    { item: "Morphine 2 mg/mL inj", schedule: "CII", onHand: 58, lastCount: -1 },
    { item: "Lorazepam 1 mg tab", schedule: "CIV", onHand: 112, lastCount: -6 }
  ],

  // Billing accounts. dOff = date of service. CPT/HCPCS + ICD-10-CM.
  claims: [
    { id: "C-9001", patient: "P07", dOff: -14, setting: "Outpatient", cpt: ["99214", "93000"], icd: ["Z95.5", "E78.5"], charge: 412.0, status: "Paid", paid: 286.4, note: "835 remittance posted" },
    { id: "C-9002", patient: "P05", dOff: 0, setting: "Outpatient", cpt: ["99204", "93224"], icd: ["R00.2", "I10"], charge: 688.0, status: "Ready to submit", paid: 0 },
    { id: "C-9003", patient: "P01", dOff: -3, setting: "Inpatient", cpt: ["99223", "99233"], icd: ["I25.2", "N18.31", "E87.5"], charge: 18420.0, status: "Open encounter", paid: 0 },
    { id: "C-9004", patient: "P02", dOff: -2, setting: "Inpatient", cpt: ["99222", "93458"], icd: ["I21.4", "E78.5"], charge: 26875.0, status: "Prior auth pending", paid: 0, note: "278 request sent for cardiac cath" },
    { id: "C-9005", patient: "P08", dOff: -40, setting: "Outpatient", cpt: ["99213", "83036"], icd: ["I10", "E11.9"], charge: 268.0, status: "Denied", paid: 0, note: "CARC 16 — missing/invalid information (rendering NPI)" },
    { id: "C-9006", patient: "P09", dOff: -21, setting: "Outpatient", cpt: ["99214", "11042"], icd: ["E11.621", "L97.419"], charge: 742.0, status: "Submitted", paid: 0, note: "837P accepted by clearinghouse" },
    { id: "C-9007", patient: "P10", dOff: 0, setting: "Inpatient", cpt: ["99221", "87880"], icd: ["J02.0", "E86.0"], charge: 3940.0, status: "Open encounter", paid: 0 },
    { id: "C-9008", patient: "P11", dOff: -60, setting: "Outpatient", cpt: ["99213"], icd: ["I10"], charge: 182.0, status: "Paid", paid: 121.75, note: "835 remittance posted" }
  ],

  // HEDIS measures (MY2026). Population figures are synthetic plan-level numbers for the pitch.
  measures: [
    { code: "CBP", name: "Controlling High Blood Pressure", desc: "Adults 18–85 with hypertension whose most recent BP is <140/90", den: 1240, num: 806, target: 70, inverse: false },
    { code: "GSD", name: "Glycemic Status Assessment, >9.0%", desc: "Adults 18–75 with diabetes whose most recent glycemic status is >9.0% (lower is better)", den: 932, num: 214, target: 20, inverse: true },
    { code: "GSD-8", name: "Glycemic Status Assessment, <8.0%", desc: "Adults 18–75 with diabetes whose most recent glycemic status is <8.0%", den: 932, num: 571, target: 65, inverse: false },
    { code: "BCS-E", name: "Breast Cancer Screening (ECDS)", desc: "Women 50–74 with a mammogram in the past 27 months", den: 1488, num: 1101, target: 78, inverse: false },
    { code: "COL-E", name: "Colorectal Cancer Screening (ECDS)", desc: "Adults 45–75 with appropriate colorectal screening", den: 2310, num: 1524, target: 72, inverse: false },
    { code: "SPC", name: "Statin Therapy for CVD — received", desc: "Adults with ASCVD dispensed at least one high- or moderate-intensity statin", den: 418, num: 351, target: 85, inverse: false }
  ],
  gaps: [
    { patient: "P08", measure: "CBP", detail: "Last BP 152/94 — above 140/90", action: "Recheck BP at visit; consider titration", attributed: "U-2002" },
    { patient: "P09", measure: "GSD", detail: "HbA1c 9.6% (21 days ago)", action: "Endocrine referral; insulin titration", attributed: "U-2002" },
    { patient: "P11", measure: "CBP", detail: "Last BP 146/92; missed follow-up", action: "Outreach to reschedule", attributed: "U-2002" },
    { patient: "P07", measure: "BCS-E", detail: "No mammogram on file in 27 months", action: "Order screening mammogram", attributed: "U-2001" },
    { patient: "P05", measure: "COL-E", detail: "No colorectal screening on file", action: "Offer FIT kit or colonoscopy referral", attributed: "U-2001" },
    { patient: "P01", measure: "GSD-8", detail: "HbA1c 8.4% (12 days ago)", action: "Adjust diabetes regimen at discharge", attributed: "U-2001" }
  ],

  notes: [
    { id: "N-1", patient: "P01", author: "Dr. Elena Marsh", kind: "Progress note", mOff: 300, signed: true,
      text: "S: Mild fatigue, no chest pain.\nO: K 6.1, Cr 1.6, INR 5.8 yesterday (warfarin held).\nA: Hyperkalemia likely from ARB + CKD; supratherapeutic INR.\nP: Hold telmisartan, repeat K + ECG, nephrology/GM consult, recheck INR AM.", addenda: [] },
    { id: "N-2", patient: "P03", author: "Dr. Samuel Okafor", kind: "Admission H&P", mOff: 600, signed: true,
      text: "34M with fever, tachycardia, lactate 4.2. Sepsis bundle started. Cultures drawn before antibiotics. Source workup in progress.", addenda: [] },
    { id: "N-3", patient: "P12", author: "Grace Lin, RN", kind: "Nursing note", mOff: 240, signed: true,
      text: "Pt NPO for cath at 06:00; 06:00 aspirin not given per protocol. VSS. Latex-free cart in room.", addenda: [] }
  ]
};
