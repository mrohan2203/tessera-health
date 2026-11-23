/* Tessera Health — extended synthetic seed: modules modeled on the Olir One blueprint.
   All people are fictional. Offsets: mOff = minutes ago, dOff/expDays = days from today. */
(function (SEED) {
  Object.assign(SEED.departments, { EMER: 'Emergency Medicine', SURG: 'General Surgery', DAYC: 'Day Care', RAD: 'Radiology', LAB: 'Laboratory' });
  Object.assign(SEED.units, { ER: 'Emergency Department', PACU: 'Post-anesthesia care (PACU)', DAYC: 'Day Care Unit', PERIOP: 'Peri-operative services' });
  SEED.unitGroups = { PERIOP: ['PACU', 'DAYC'] };

  SEED.users.push(
    { id: 'U-2004', name: 'Dr. Farid Haddad', username: 'farid.er', role: 'doctor', dept: 'EMER', title: 'Attending, Emergency Medicine', mfa: 'Security key', status: 'active', lastSignIn: 0 },
    { id: 'U-2005', name: 'Dr. Caroline Weiss', username: 'caroline.surgery', role: 'doctor', dept: 'SURG', title: 'Attending, General Surgery', mfa: 'Security key', status: 'active', lastSignIn: 0 },
    { id: 'U-3002', name: 'Jamal Rivers, RN', username: 'jamal.periop', role: 'nurse', unit: 'PERIOP', title: 'Peri-operative & day care nurse', mfa: 'Badge tap + PIN', status: 'active', lastSignIn: 0 },
    { id: 'U-7001', name: 'Sofia Alvarez', username: 'sofia.frontdesk', role: 'receptionist', title: 'Front desk & admissions', mfa: 'Authenticator app', status: 'active', lastSignIn: 0 },
    { id: 'U-7101', name: 'Ben Okoro, MLS', username: 'ben.lab', role: 'lab', title: 'Medical laboratory scientist', mfa: 'Badge tap + PIN', status: 'active', lastSignIn: 0 },
    { id: 'U-7102', name: 'Dr. Hannah Cho', username: 'hannah.path', role: 'pathologist', title: 'Pathologist, lab director', mfa: 'Security key', status: 'active', lastSignIn: -1 },
    { id: 'U-7201', name: 'Dr. Victor Lund', username: 'victor.rad', role: 'radiologist', title: 'Attending radiologist', mfa: 'Security key', status: 'active', lastSignIn: 0 },
    { id: 'U-5002', name: 'Rita Gomez', username: 'rita.insurance', role: 'insurance', title: 'Insurance & pre-authorization desk', mfa: 'Authenticator app', status: 'active', lastSignIn: -1 },
    { id: 'U-8001', name: 'Catherine Moore', username: 'catherine.ceo', role: 'executive', title: 'Chief executive officer', mfa: 'Security key', status: 'active', lastSignIn: -2 },
    { id: 'U-9001', name: 'Radha Bhatt', username: 'radha.patient', role: 'patient', patientId: 'P08', title: 'Patient portal', mfa: 'Authenticator app', status: 'active', lastSignIn: -5 }
  );

  const base = { consults: [], code: 'Full code', allergies: [], meds: [], labs: [] };
  const mk = (o) => Object.assign({}, base, o);
  SEED.patients.push(
    mk({ id: 'P13', mrn: '102871', name: 'Prakash Rangan', age: 54, sex: 'M', dob: '1972-02-08', phone: '4155550111', dept: 'EMER', consults: ['CARD'], unit: 'ER', bed: 'ER-02', status: 'Emergency', attending: 'U-2004',
      payer: 'Kaiser Permanente HMO', memberId: 'KP00431187', weightKg: 84, heightCm: 174,
      problems: ['Acute anterior STEMI (I21.09)', 'Hypertension (I10)'], vitals: { bp: '90/60', hr: 110, rr: 22, temp: 98.2, spo2: 94 },
      meds: [{ drug: 'Aspirin', dose: '325 mg chewed', route: 'PO', freq: 'Once', status: 'Given' }, { drug: 'Ticagrelor', dose: '180 mg load', route: 'PO', freq: 'Once', status: 'Given' }, { drug: 'Heparin', dose: '60 units/kg bolus', route: 'IV', freq: 'Once', status: 'Given' }],
      labs: [{ test: 'Troponin I', loinc: '10839-9', value: '2.4', unit: 'ng/mL', ref: '<0.04', flag: 'HH', dOff: 0 }, { test: 'Potassium', loinc: '2823-3', value: '4.1', unit: 'mmol/L', ref: '3.5–5.1', flag: '', dOff: 0 }] }),
    mk({ id: 'P14', mrn: 'T-0412', name: 'Unknown Male · Trauma-0412', unidentified: true, age: 60, sex: 'M', dob: '', phone: '', dept: 'EMER', unit: 'ER', bed: 'ER-04', status: 'Emergency', attending: 'U-2004',
      payer: 'Unknown — registration pending', memberId: '', weightKg: 80, heightCm: 175, allergiesUnknown: true,
      problems: ['Altered mental status, GCS 12 (R40.2432)'], vitals: { bp: '168/96', hr: 58, rr: 18, temp: 97.9, spo2: 96 },
      labs: [{ test: 'Glucose, point of care', loinc: '2345-7', value: '112', unit: 'mg/dL', ref: '70–140', flag: '', dOff: 0 }] }),
    mk({ id: 'P15', mrn: 'T-0413', name: 'Unknown Female · Trauma-0413', unidentified: true, age: 30, sex: 'F', dob: '', phone: '', dept: 'EMER', unit: 'ER', bed: '—', status: 'Emergency', attending: 'U-2004',
      payer: 'Unknown — registration pending', memberId: '', weightKg: 62, heightCm: 165, allergiesUnknown: true,
      problems: ['Motor vehicle collision, minor lacerations (V43.52)'], vitals: { bp: '124/80', hr: 96, rr: 16, temp: 98.4, spo2: 99 } }),
    mk({ id: 'P16', mrn: '102905', name: 'Nisha Varghese', age: 31, sex: 'F', dob: '1995-04-27', phone: '6505550172', dept: 'EMER', unit: 'ER', bed: 'ER-05', status: 'Emergency', attending: 'U-2004',
      payer: 'Cigna Open Access', memberId: 'U88120476', weightKg: 58, heightCm: 163,
      problems: ['Sprain of right ankle (S93.401A)'], vitals: { bp: '118/76', hr: 84, rr: 14, temp: 98.3, spo2: 99 } }),
    mk({ id: 'P18', mrn: '102933', name: 'Teresa Morales', age: 45, sex: 'F', dob: '1981-12-01', phone: '5105550148', dept: 'EMER', consults: ['SURG'], unit: 'ER', bed: 'ER-08', status: 'Emergency', attending: 'U-2004',
      payer: 'Anthem Blue Cross PPO', memberId: 'XBC55210933', weightKg: 70, heightCm: 160, allergies: [{ agent: 'Iodinated contrast', reaction: 'Hives', severity: 'Moderate' }],
      problems: ['Right upper quadrant pain (R10.11)'], vitals: { bp: '134/84', hr: 102, rr: 18, temp: 100.6, spo2: 98 } }),
    // Day care
    mk({ id: 'P20', mrn: '101112', name: 'Venkatesh Murthy', age: 66, sex: 'M', dob: '1960-07-19', phone: '4155550133', dept: 'DAYC', unit: 'DAYC', bed: 'DC-01', status: 'Day care', attending: 'U-2002', payer: 'Medicare Part B', memberId: '2HX7AB4KC19', weightKg: 72, heightCm: 170, problems: ['Colon cancer, on FOLFOX (C18.9)'], vitals: { bp: '129/82', hr: 88, rr: 16, temp: 98.4, spo2: 94 } }),
    mk({ id: 'P21', mrn: '101203', name: 'Dilip Chandran', age: 72, sex: 'M', dob: '1954-03-30', phone: '4085550120', dept: 'DAYC', unit: 'DAYC', bed: 'DC-02', status: 'Day care', attending: 'U-2002', payer: 'Medicare Part B', memberId: '5TT2PL8XN03', weightKg: 66, heightCm: 168, problems: ['Myelodysplastic syndrome, transfusion-dependent (D46.9)'], vitals: { bp: '154/77', hr: 76, rr: 15, temp: 98.1, spo2: 97 } }),
    mk({ id: 'P22', mrn: '101377', name: 'Shobha Pai', age: 55, sex: 'F', dob: '1971-10-05', phone: '6505550161', dept: 'DAYC', unit: 'DAYC', bed: 'DC-03', status: 'Day care', attending: 'U-2002', payer: 'UnitedHealthcare Choice Plus', memberId: 'UHC66120931', weightKg: 61, heightCm: 158, problems: ['Iron deficiency anemia (D50.9)'], vitals: { bp: '129/101', hr: 65, rr: 14, temp: 98.0, spo2: 94 } }),
    mk({ id: 'P23', mrn: '101488', name: 'Asha Menon', age: 71, sex: 'F', dob: '1955-01-22', phone: '5105550104', dept: 'DAYC', unit: 'DAYC', bed: 'DC-04', status: 'Day care', attending: 'U-2002', payer: 'Medicare Advantage — Humana', memberId: 'H77310598', weightKg: 59, heightCm: 155, problems: ['Dyspepsia, for EGD (K30)'], vitals: { bp: '144/79', hr: 65, rr: 14, temp: 98.2, spo2: 94 } }),
    mk({ id: 'P24', mrn: '101590', name: 'Pradeep Rao', age: 46, sex: 'M', dob: '1980-08-14', phone: '4155550190', dept: 'DAYC', unit: 'DAYC', bed: 'DC-05', status: 'Day care', attending: 'U-2002', payer: 'Aetna PPO', memberId: 'W331209845', weightKg: 81, heightCm: 177, problems: ['Screening colonoscopy (Z12.11)'], vitals: { bp: '169/92', hr: 65, rr: 14, temp: 98.3, spo2: 95 } }),
    mk({ id: 'P25', mrn: '101642', name: 'Revathi Iyer', age: 81, sex: 'F', dob: '1945-11-09', phone: '4085550147', dept: 'DAYC', unit: 'DAYC', bed: 'DC-06', status: 'Day care', attending: 'U-2002', payer: 'Medicare Part B', memberId: '8MN4QR2WT55', weightKg: 54, heightCm: 150, problems: ['Age-related cataract, right eye (H25.11)'], vitals: { bp: '172/78', hr: 91, rr: 16, temp: 98.0, spo2: 94 } })
  );

  const groups = { P01: 'B+', P02: 'O+', P03: 'A+', P04: 'O+', P05: 'AB+', P06: 'O-', P07: 'A+', P08: 'A-', P09: 'B-', P10: 'O+', P11: 'B+', P12: 'O+', P13: 'B+', P14: 'Unknown', P15: 'Unknown', P16: 'A+', P18: 'O+', P20: 'A+', P21: 'O+', P22: 'B+', P23: 'O+', P24: 'A+', P25: 'AB-' };
  SEED.patients.forEach((p) => { p.bloodGroup = groups[p.id] || 'Unknown'; p.consults = p.consults || []; });

  // ---------- Ambient Doctor scripts (simulated capture, not live audio) ----------
  SEED.ambientScripts = {
    P05: {
      transcript: [
        ['Clinician', 'How have the palpitations been since we put the monitor on?'],
        ['Patient', 'Two or three episodes, mostly at night. Maybe ten minutes each. No fainting.'],
        ['Clinician', 'Any chest pain or shortness of breath with them?'],
        ['Patient', 'A bit breathless the long one on Tuesday. Coffee seems to set it off.'],
        ['Clinician', 'The Holter shows short runs of a regular fast rhythm, about 160, starting and stopping suddenly. That fits SVT. Your thyroid test was normal.'],
        ['Patient', 'Is that dangerous?'],
        ['Clinician', 'Usually not. I will teach you vagal maneuvers, start a low dose of metoprolol, and refer you to electrophysiology to talk about ablation.']
      ],
      soap: 'S: 54M with intermittent palpitations, 2–3 nocturnal episodes over 7 days, ~10 min each, one with mild dyspnea. Caffeine trigger. No syncope or chest pain.\nO: BP 132/84, HR 104. Holter: paroxysmal narrow-complex tachycardia to 160 bpm, abrupt onset/offset. TSH 0.9 (normal).\nA: Paroxysmal supraventricular tachycardia (I47.1). Hypertension, on lisinopril.\nP: Vagal maneuver teaching. Start metoprolol succinate 25 mg daily. EP referral for ablation discussion. Limit caffeine. Return precautions for syncope or chest pain.',
      icd: ['I47.1 Supraventricular tachycardia', 'I10 Essential hypertension'],
      cpt: ['99214 Office visit, established, moderate MDM', '93227 Holter review and interpretation'],
      orders: [{ type: 'Medication', text: 'Metoprolol succinate 25 mg PO daily' }, { type: 'Nursing', text: 'Referral: cardiac electrophysiology (SVT, ablation evaluation)' }]
    },
    P06: {
      transcript: [
        ['Clinician', 'How often are you using the rescue inhaler right now?'],
        ['Patient', 'Most days this month, and I woke up coughing twice last week.'],
        ['Clinician', 'Are you taking the budesonide-formoterol twice a day?'],
        ['Patient', 'I skip the evening one a lot.'],
        ['Clinician', 'Your lungs sound clear today and your oxygen is 99 percent. Let us go over technique and set up an action plan.']
      ],
      soap: 'S: 31F with moderate persistent asthma. Rescue use most days, 2 nocturnal awakenings last week. Missing evening controller doses.\nO: SpO₂ 99%, RR 14, lungs clear.\nA: Asthma, not well controlled, adherence gap (J45.40).\nP: Inhaler technique teaching, written asthma action plan, continue budesonide-formoterol 160/4.5 BID with SMART dosing, follow up 4 weeks.',
      icd: ['J45.40 Moderate persistent asthma, uncomplicated'],
      cpt: ['99214 Office visit, established, moderate MDM', '94664 Inhaler technique demonstration'],
      orders: [{ type: 'Nursing', text: 'Asthma action plan education' }]
    }
  };

  // ---------- Emergency department (ESI 1–5) ----------
  SEED.er = [
    { id: 'E-1', patient: 'P13', esi: 1, complaint: 'Central chest pain, diaphoresis — ?STEMI', arrival: 'Ambulance', mOff: 58, triagedOff: 52, status: 'In treatment', provider: 'U-2004' },
    { id: 'E-2', patient: 'P14', esi: 2, complaint: 'Found collapsed at bus stop, GCS 12', arrival: 'Ambulance', mOff: 35, triagedOff: 30, status: 'In treatment', provider: 'U-2004' },
    { id: 'E-3', patient: 'P18', esi: 3, complaint: 'Right upper quadrant pain, fever', arrival: 'Walk-in', mOff: 41, triagedOff: 33, status: 'Waiting', provider: null },
    { id: 'E-4', patient: 'P15', esi: 3, complaint: 'Car collision, minor lacerations', arrival: 'Walk-in', mOff: 9, triagedOff: null, status: 'Waiting', provider: null },
    { id: 'E-5', patient: 'P16', esi: 4, complaint: 'Right ankle twisting injury', arrival: 'Walk-in', mOff: 74, triagedOff: 60, status: 'Waiting', provider: null },
    { id: 'E-6', patient: 'P11', esi: 5, complaint: 'Medication refill, mild headache', arrival: 'Walk-in', mOff: 4, triagedOff: null, status: 'Waiting', provider: null }
  ];
  SEED.esiTarget = { 1: 0, 2: 10, 3: 30, 4: 60, 5: 120 }; // minutes to provider

  // ---------- Beds ----------
  const beds = [];
  ['CICU-1', 'CICU-2', 'CICU-3', 'CICU-4', 'CICU-5', 'CICU-6'].forEach((b) => beds.push({ unit: 'CICU', bed: b }));
  for (let i = 1; i <= 12; i++) beds.push({ unit: 'W4B', bed: '4B-' + String(i).padStart(2, '0') });
  ['PW-1', 'PW-2', 'PW-3', 'PW-4'].forEach((b) => beds.push({ unit: 'PEDW', bed: b }));
  ['PACU-1', 'PACU-2', 'PACU-3'].forEach((b) => beds.push({ unit: 'PACU', bed: b }));
  SEED.beds = beds;
  SEED.bedStatus = { 'CICU-4': 'Cleaning', 'CICU-6': 'Reserved', '4B-03': 'Cleaning', '4B-05': 'Maintenance', '4B-09': 'Reserved' };
  SEED.bedReservations = { 'CICU-6': 'P13', '4B-09': 'P08' };

  // ---------- Operating rooms ----------
  SEED.whoChecklist = {
    signIn: ['Patient identity confirmed with two identifiers', 'Site marked', 'Consent verified', 'Anesthesia machine and medication check complete', 'Known allergies reviewed', 'Airway and aspiration risk assessed'],
    timeOut: ['Team introduced by name and role', 'Patient, site and procedure confirmed aloud', 'Antibiotic prophylaxis given within 60 minutes', 'Anticipated critical events reviewed', 'Essential imaging displayed'],
    signOut: ['Procedure name recorded', 'Instrument, sponge and needle counts correct', 'Specimen labeled', 'Equipment problems addressed', 'Key recovery concerns handed over']
  };
  const all = (k) => Object.fromEntries(SEED.whoChecklist[k].map((_, i) => [i, true]));
  SEED.ot = [
    { id: 'OT-1', room: 'OR-1', patient: 'P08', procedure: 'Total knee arthroplasty, left', cpt: '27447', site: 'Left knee', surgeon: 'U-2005', anesthesia: 'Dr. Marcus Yee', scheduled: '07:30', stage: 'Recovery', consent: 'Signed', ebl: '150 mL', check: { signIn: all('signIn'), timeOut: all('timeOut'), signOut: all('signOut') } },
    { id: 'OT-2', room: 'OR-2', patient: 'P07', procedure: 'Laparoscopic cholecystectomy', cpt: '47562', site: 'Abdomen', surgeon: 'U-2005', anesthesia: 'Dr. Marcus Yee', scheduled: '13:00', stage: 'Preparation', consent: 'Signed', note: 'Clopidogrel held 5 days, cleared by cardiology', check: { signIn: { 0: true, 1: true, 2: true }, timeOut: {}, signOut: {} } },
    { id: 'OT-3', room: 'OR-3', patient: 'P03', procedure: 'Laparoscopic appendectomy', cpt: '44970', site: 'Abdomen', surgeon: 'U-2005', anesthesia: 'Dr. Lena Ortiz', scheduled: '06:00', stage: 'Completed', consent: 'Signed', ebl: '30 mL', check: { signIn: all('signIn'), timeOut: all('timeOut'), signOut: all('signOut') } },
    { id: 'OT-4', room: 'OR-2', patient: 'P18', procedure: 'Laparoscopic cholecystectomy (urgent, if confirmed)', cpt: '47562', site: 'Abdomen', surgeon: 'U-2005', anesthesia: 'Dr. Lena Ortiz', scheduled: '17:30', stage: 'Scheduled', consent: 'Not signed', check: { signIn: {}, timeOut: {}, signOut: {} } }
  ];
  SEED.otStages = ['Scheduled', 'Preparation', 'In surgery', 'Recovery', 'Completed'];

  // ---------- Day care ----------
  SEED.dayPhases = ['Pre-procedure', 'In procedure', 'Recovery', 'Ready for discharge', 'Discharged'];
  SEED.daycare = [
    { patient: 'P20', procedure: 'Chemotherapy infusion (FOLFOX, cycle 4)', phase: 'Recovery', mOff: 20 },
    { patient: 'P21', procedure: 'Blood transfusion, 2 units PRBC', phase: 'In procedure', mOff: 57 },
    { patient: 'P22', procedure: 'IV iron infusion', phase: 'Pre-procedure', mOff: 94 },
    { patient: 'P23', procedure: 'Upper endoscopy (EGD)', phase: 'Ready for discharge', mOff: 40 },
    { patient: 'P24', procedure: 'Screening colonoscopy', phase: 'Recovery', mOff: 168 },
    { patient: 'P25', procedure: 'Cataract surgery, phacoemulsification', phase: 'In procedure', mOff: 62 }
  ];

  // ---------- Clinical handover (ISBAR) ----------
  SEED.handovers = [
    { id: 'H-1', patient: 'P01', from: 'Dr. Elena Marsh (day)', to: 'Night cardiology', status: 'Unstable', ack: null,
      s: '62M, CAD and CKD 3a, K⁺ 6.1 critical, on cardiac monitor in CICU-3.', b: 'HTN, T2DM, AF on warfarin (held, INR 5.8 yesterday). Admitted via ER with chest pain.',
      a: 'Hyperkalemia under treatment; telmisartan held; borderline blood pressure.', r: 'Repeat K⁺ and ECG at 22:00. Call if SBP < 100 or new arrhythmia. Recheck INR in the morning.',
      tasks: [{ t: 'Repeat potassium + ECG', due: '22:00', urgent: true, done: false }, { t: 'Review INR', due: '06:00', urgent: false, done: false }] },
    { id: 'H-2', patient: 'P02', from: 'Dr. Elena Marsh (day)', to: 'Night cardiology', status: 'Watch', ack: null,
      s: '52F, NSTEMI rule-out, clinically ready for discharge.', b: 'HTN, hyperlipidemia. Penicillin anaphylaxis.',
      a: 'Stable. Discharge blocked on prior authorization for cardiac cath.', r: 'If authorization clears overnight, complete discharge. Otherwise continue heparin and recheck troponin.',
      tasks: [{ t: 'Check prior-auth status', due: '08:00', urgent: false, done: false }] },
    { id: 'H-3', patient: 'P12', from: 'Grace Lin, RN (day)', to: 'CICU night RN', status: 'Stable', ack: null,
      s: '58M NSTEMI, post-cath, CICU-2.', b: 'Latex allergy. Smoker.', a: 'Radial site clean, pulses intact, pain 1/10.', r: 'Radial band release per protocol at 20:00. Morning aspirin due.',
      tasks: [{ t: 'Radial band release', due: '20:00', urgent: false, done: false }] }
  ];

  // ---------- Clinical pathways ----------
  SEED.pathways = [
    { id: 'PW-1', patient: 'P13', name: 'STEMI — primary PCI', metric: 'Door-to-balloon', target: 90, startOff: 58,
      steps: [{ t: 'Triage + 12-lead ECG within 10 min', by: 'Triage RN', off: 52, note: 'Anterior ST elevation V1–V4' }, { t: 'Cath lab activated', by: 'Dr. Farid Haddad', off: 48 }, { t: 'Aspirin, P2Y12 load, heparin', by: 'Dr. Farid Haddad', off: 41, note: 'Aspirin 325 mg, ticagrelor 180 mg, heparin bolus' }, { t: 'Transfer to cath lab' }, { t: 'Balloon inflation' }, { t: 'Post-PCI CICU admission' }] },
    { id: 'PW-2', patient: 'P03', name: 'Sepsis — hour-1 bundle', metric: 'Bundle complete', target: 60, startOff: 600,
      steps: [{ t: 'Lactate measured', by: 'Dr. Samuel Okafor', off: 596, note: '4.2 mmol/L' }, { t: 'Blood cultures before antibiotics', by: 'Ward 4B RN', off: 592 }, { t: 'Broad-spectrum antibiotics', by: 'Ward 4B RN', off: 580, note: 'Piperacillin-tazobactam 4.5 g IV' }, { t: '30 mL/kg crystalloid for hypotension or lactate ≥ 4', by: 'Ward 4B RN', off: 570 }, { t: 'Repeat lactate within 2–4 h' }, { t: 'Source control', by: 'Dr. Caroline Weiss', off: 240, note: 'Laparoscopic appendectomy' }] },
    { id: 'PW-3', patient: 'P14', name: 'Code stroke', metric: 'Door-to-CT', target: 25, startOff: 35,
      steps: [{ t: 'Stroke alert called', by: 'Dr. Farid Haddad', off: 33 }, { t: 'Glucose checked', by: 'ER RN', off: 31, note: '112 mg/dL' }, { t: 'Last known well established' }, { t: 'Non-contrast CT head' }, { t: 'Thrombolysis decision' }, { t: 'Stroke unit or neuro-IR' }] }
  ];

  // ---------- Discharge orchestrator ----------
  SEED.discharges = [
    { id: 'D-1', patient: 'P02', decidedOff: 95, by: 'U-2001', followUp: ['Cardiology review in 2 weeks', 'Lipid panel in 6 weeks'],
      steps: [{ owner: 'doctor', t: 'Discharge summary signed', state: 'Done', by: 'Dr. Elena Marsh' }, { owner: 'pharmacist', t: 'Discharge medications reconciled and dispensed', state: 'Pending' }, { owner: 'billing', t: 'Financial clearance', state: 'Blocked', blocker: 'Prior authorization for cardiac cath pending; estimated patient balance $2,480' }, { owner: 'nurse', t: 'Lines removed, discharge education done', state: 'Done', by: 'Ward 4B RN' }, { owner: 'receptionist', t: 'Transport booked', state: 'Pending' }] },
    { id: 'D-2', patient: 'P03', decidedOff: 35, by: 'U-2005', followUp: ['Wound check in 10 days', 'Telehealth check-in day 3'],
      steps: [{ owner: 'doctor', t: 'Discharge summary signed', state: 'Pending' }, { owner: 'pharmacist', t: 'Oral antibiotics dispensed (amoxicillin-clavulanate × 7 days)', state: 'Pending' }, { owner: 'billing', t: 'Financial clearance', state: 'Pending' }, { owner: 'nurse', t: 'Wound care teaching done', state: 'Done', by: 'Ward 4B RN' }, { owner: 'receptionist', t: 'Transport booked', state: 'Pending' }] }
  ];

  // ---------- Laboratory (LIS) ----------
  SEED.labFlow = ['Ordered', 'Collected', 'Received', 'Resulted', 'Released'];
  SEED.labOrders = [
    { id: 'L-301', patient: 'P01', test: 'Potassium (repeat)', loinc: '2823-3', specimen: 'Lithium heparin, green top', priority: 'STAT', status: 'Collected', by: 'U-2001', mOff: 25, unit: 'mmol/L', ref: '3.5–5.1', lo: 3.5, hi: 5.1, critLo: 2.8, critHi: 6.0 },
    { id: 'L-302', patient: 'P04', test: 'Sodium', loinc: '2951-2', specimen: 'Lithium heparin, green top', priority: 'Routine', status: 'Ordered', by: 'U-2001', mOff: 40, unit: 'mmol/L', ref: '135–145', lo: 135, hi: 145, critLo: 120, critHi: 160 },
    { id: 'L-303', patient: 'P13', test: 'Troponin I (3 h repeat)', loinc: '10839-9', specimen: 'Lithium heparin, green top', priority: 'STAT', status: 'Resulted', value: '3.8', by: 'U-2004', mOff: 15, unit: 'ng/mL', ref: '<0.04', lo: null, hi: 0.04, critLo: null, critHi: 0.5, resultedBy: 'Ben Okoro, MLS' },
    { id: 'L-304', patient: 'P03', test: 'Blood culture × 2', loinc: '600-7', specimen: 'Aerobic + anaerobic bottles', priority: 'Routine', status: 'Received', by: 'U-2002', mOff: 610, unit: '', ref: 'No growth', text: true },
    { id: 'L-305', patient: 'P10', test: 'WBC', loinc: '6690-2', specimen: 'EDTA, lavender top', priority: 'Routine', status: 'Released', value: '14.2', by: 'U-2003', mOff: 300, unit: '10³/µL', ref: '4.5–13.5', lo: 4.5, hi: 13.5, critLo: 1, critHi: 30, resultedBy: 'Ben Okoro, MLS', releasedBy: 'Dr. Hannah Cho' },
    { id: 'L-306', patient: 'P08', test: 'Hemoglobin (post-op)', loinc: '718-7', specimen: 'EDTA, lavender top', priority: 'Urgent', status: 'Ordered', by: 'U-2005', mOff: 30, unit: 'g/dL', ref: '12.0–15.5', lo: 12, hi: 15.5, critLo: 7, critHi: 20 },
    { id: 'L-307', patient: 'P18', test: 'Lipase', loinc: '3040-3', specimen: 'Lithium heparin, green top', priority: 'Urgent', status: 'Collected', by: 'U-2004', mOff: 20, unit: 'U/L', ref: '13–60', lo: 13, hi: 60, critLo: null, critHi: 1000 }
  ];

  // ---------- Radiology (RIS / PACS) ----------
  SEED.radFlow = ['Ordered', 'Scheduled', 'Arrived', 'In progress', 'Completed', 'Reported'];
  SEED.radOrders = [
    { id: 'RAD-1', acc: 'ACC-77120', patient: 'P14', modality: 'CT', study: 'CT head without contrast', priority: 'STAT', status: 'Completed', contrast: false, indication: 'Found collapsed, GCS 12. Rule out intracranial hemorrhage (code stroke).', by: 'U-2004', mOff: 12, phantom: 'sdh' },
    { id: 'RAD-2', acc: 'ACC-77031', patient: 'P03', modality: 'CT', study: 'CT abdomen and pelvis with IV contrast', priority: 'Urgent', status: 'Reported', contrast: true, indication: 'Sepsis, right lower quadrant pain.', by: 'U-2002', mOff: 560, phantom: 'abd',
      report: { technique: 'Axial CT abdomen/pelvis after 100 mL IV iodinated contrast.', findings: 'Dilated, thick-walled appendix with periappendiceal fat stranding and a 3.1 cm rim-enhancing collection. No free air.', impression: 'Perforated appendicitis with periappendiceal abscess.', critical: true, by: 'Dr. Victor Lund', at: null } },
    { id: 'RAD-3', acc: 'ACC-77141', patient: 'P16', modality: 'XR', study: 'XR right ankle, 3 views', priority: 'Routine', status: 'Arrived', contrast: false, indication: 'Inversion injury. Ottawa ankle rules positive (malleolar tenderness).', by: 'U-2004', mOff: 30, phantom: 'xr' },
    { id: 'RAD-4', acc: 'ACC-77138', patient: 'P13', modality: 'XR', study: 'XR chest, portable AP', priority: 'STAT', status: 'In progress', contrast: false, indication: 'STEMI, pre-cath baseline.', by: 'U-2004', mOff: 20, phantom: 'xr' },
    { id: 'RAD-5', acc: 'ACC-77150', patient: 'P08', modality: 'XR', study: 'XR left knee, post-op, 2 views', priority: 'Routine', status: 'Scheduled', contrast: false, indication: 'Post total knee arthroplasty.', by: 'U-2005', mOff: 60, phantom: 'xr' },
    { id: 'RAD-6', acc: 'ACC-77152', patient: 'P04', modality: 'CT', study: 'CT chest with IV contrast (PE protocol)', priority: 'Urgent', status: 'Ordered', contrast: true, indication: 'Hypoxia, rule out pulmonary embolism.', by: 'U-2001', mOff: 25, phantom: 'chest' },
    { id: 'RAD-7', acc: 'ACC-77155', patient: 'P18', modality: 'US', study: 'US right upper quadrant', priority: 'Urgent', status: 'Ordered', contrast: false, indication: 'RUQ pain, fever. Rule out cholecystitis.', by: 'U-2004', mOff: 18, phantom: 'us' }
  ];

  // ---------- Blood bank ----------
  SEED.bloodUnits = [
    { id: 'W0412 26 001101', group: 'O+', product: 'PRBC', expDays: -5 },
    { id: 'W0412 26 001144', group: 'O+', product: 'PRBC', expDays: 9, reservedFor: 'XM-1' },
    { id: 'W0412 26 001152', group: 'O+', product: 'PRBC', expDays: 14, reservedFor: 'XM-1' },
    { id: 'W0412 26 001160', group: 'O+', product: 'PRBC', expDays: 21 },
    { id: 'W0412 26 001171', group: 'O-', product: 'PRBC', expDays: 6 },
    { id: 'W0412 26 001175', group: 'A-', product: 'PRBC', expDays: -2 },
    { id: 'W0412 26 001180', group: 'A+', product: 'PRBC', expDays: 18 },
    { id: 'W0412 26 001186', group: 'B+', product: 'PRBC', expDays: 25 },
    { id: 'W0412 26 001190', group: 'A+', product: 'Platelets', expDays: 3 },
    { id: 'W0412 26 001199', group: 'AB+', product: 'FFP', expDays: 300 },
    { id: 'W0412 26 001203', group: 'O+', product: 'FFP', expDays: 280 }
  ];
  SEED.crossmatch = [
    { id: 'XM-1', patient: 'P04', product: 'PRBC', units: 2, state: 'Crossmatched', reqOff: 240, by: 'U-2001', reason: 'Hb 7.1 g/dL, symptomatic' },
    { id: 'XM-2', patient: 'P08', product: 'PRBC', units: 1, state: 'Requested', reqOff: 60, by: 'U-2005', reason: 'Post-op, type and crossmatch on hold' },
    { id: 'XM-3', patient: 'P21', product: 'PRBC', units: 2, state: 'Issued', reqOff: 300, by: 'U-2002', reason: 'Scheduled transfusion (day care)' }
  ];

  // ---------- Telemedicine ----------
  SEED.tele = [
    { id: 'TM-1', patient: 'P05', provider: 'U-2001', status: 'In session', when: 'Today 10:00', mins: 20, reason: 'Holter results review' },
    { id: 'TM-2', patient: 'P06', provider: 'U-2002', status: 'Waiting room', when: 'Today 14:30', mins: 15, reason: 'Asthma action plan check' },
    { id: 'TM-3', patient: 'P09', provider: 'U-2002', status: 'Completed', when: 'Today 09:00', mins: 20, reason: 'Foot wound photo review' },
    { id: 'TM-4', patient: 'P11', provider: 'U-2002', status: 'Scheduled', when: 'Tomorrow 09:30', mins: 15, reason: 'BP follow-up after missed visit' },
    { id: 'TM-5', patient: 'P07', provider: 'U-2001', status: 'Scheduled', when: 'In 7 days', mins: 20, reason: 'Post-op cardiology check' }
  ];
  SEED.rpm = [
    { patient: 'P11', device: 'Home BP cuff', reading: '158/98 mmHg, 3 days running', level: 'warn', provider: 'U-2002' },
    { patient: 'P09', device: 'Glucometer', reading: 'Fasting glucose 288 mg/dL', level: 'crit', provider: 'U-2002' },
    { patient: 'P05', device: 'Wearable ECG patch', reading: 'HR 162 for 11 minutes at 02:14', level: 'warn', provider: 'U-2001' }
  ];

  // ---------- Insurance desk ----------
  SEED.insCases = [
    { id: 'PA-501', kind: 'Prior authorization', patient: 'P02', payer: 'Aetna PPO', service: 'Left heart catheterization (CPT 93458)', amount: 26875, status: 'Payer query',
      docs: [{ n: 'X12 278 authorization request', ok: true }, { n: 'Cardiology consult note', ok: true }, { n: 'Troponin trend', ok: false }, { n: '12-lead ECG tracing', ok: false }],
      thread: [{ from: 'Aetna utilization review', off: 360, text: 'Please send troponin trend and ECG tracing to support medical necessity.' }],
      timeline: [{ off: 1440, t: 'Authorization request submitted (278)' }, { off: 360, t: 'Payer requested more information' }] },
    { id: 'PA-502', kind: 'Prior authorization', patient: 'P07', payer: 'Aetna Medicare Advantage', service: 'Laparoscopic cholecystectomy (CPT 47562)', amount: 9850, status: 'Approved', ref: 'AUTH-7731902',
      docs: [{ n: 'X12 278 authorization request', ok: true }, { n: 'Surgical consult note', ok: true }, { n: 'RUQ ultrasound report', ok: true }],
      thread: [], timeline: [{ off: 4320, t: 'Authorization request submitted (278)' }, { off: 2880, t: 'Approved, valid 60 days' }] },
    { id: 'CL-601', kind: 'Inpatient claim', patient: 'P03', payer: 'Blue Shield of California HMO', service: 'Appendectomy with sepsis (MS-DRG 339)', amount: 41200, status: 'Documents needed',
      docs: [{ n: 'UB-04 / 837I claim', ok: true }, { n: 'Operative report', ok: false }, { n: 'Discharge summary', ok: false }],
      thread: [], timeline: [{ off: 120, t: 'Claim drafted from charge capture' }] }
  ];

  // ---------- Itemized charges (CDM) ----------
  SEED.chargeLines = {
    'C-9003': [['0450', '99285', 'ER visit, high severity', 1, 1850], ['0200', '99223', 'Initial hospital care, high', 1, 640], ['0200', '99233', 'Subsequent hospital care ×3', 3, 310], ['0300', '80048', 'Basic metabolic panel ×4', 4, 85], ['0305', '85610', 'Prothrombin time / INR ×3', 3, 42], ['0730', '93005', '12-lead ECG ×4', 4, 210], ['0200', 'ICU', 'Cardiac ICU room and board ×3 days', 3, 4450]],
    'C-9004': [['0200', '99222', 'Initial hospital care, moderate', 1, 480], ['0481', '93458', 'Left heart cath with coronary angiography', 1, 21900], ['0250', 'J1644', 'Heparin 1,000 units', 12, 18], ['0300', '84484', 'Troponin I ×3', 3, 145], ['0120', 'ROOM', 'Med-surg room and board ×2 days', 2, 1849.5]]
  };
  SEED.cptDesc = { 99204: 'New patient visit, moderate', 99213: 'Established visit, low', 99214: 'Established visit, moderate', 99221: 'Initial hospital care, low', 99222: 'Initial hospital care, moderate', 99223: 'Initial hospital care, high', 99233: 'Subsequent hospital care, high', 93000: 'ECG with interpretation', 93224: 'Holter monitor, 48 h', 93458: 'Left heart cath', 83036: 'HbA1c', 11042: 'Debridement, subcutaneous', 87880: 'Rapid strep test' };

  // ---------- Patient safety ----------
  SEED.incidents = [
    { id: 'IR-041', kind: 'Adverse event', type: 'Medication error', harm: 'Temporary harm', where: 'Ward 4B', dOff: -2, status: 'Under investigation', reporter: 'Anonymous', text: 'Insulin 20 units given instead of 10 units ordered. Glucose fell to 54 mg/dL; treated with D50, recovered.' },
    { id: 'IR-040', kind: 'Adverse event', type: 'Fall', harm: 'Minor harm', where: 'Ward 4B', dOff: -3, status: 'Root cause analysis', reporter: 'Ward 4B RN', text: 'Patient found on floor beside bed. No loss of consciousness. Hip X-ray negative.' },
    { id: 'IR-039', kind: 'Near miss', type: 'Medication — look-alike', harm: 'No harm', where: 'CICU', dOff: -5, status: 'Closed', reporter: 'Grace Lin, RN', text: 'Hydroxyzine pulled instead of hydralazine; caught by barcode scan before administration.' }
  ];
  SEED.hai = [
    { id: 'HAI-1', type: 'CAUTI', patient: 'P01', unit: 'CICU', device: 'Urinary catheter, day 17', organism: 'E. coli (ESBL+)', status: 'Under treatment', tx: 'Meropenem 1 g IV q8h × 7 days', nhsn: 'Reported' },
    { id: 'HAI-2', type: 'CLABSI', patient: 'P04', unit: 'CICU', device: 'Central line, day 5', organism: 'Cultures pending', status: 'Investigating', tx: 'Empiric vancomycin + cefepime', nhsn: 'Pending criteria' }
  ];
  SEED.isolation = [{ patient: 'P01', type: 'Contact', reason: 'ESBL E. coli' }, { patient: 'P03', type: 'Contact', reason: 'C. difficile test pending' }];
  SEED.stewardship = [{ drug: 'Meropenem', dot: 42, target: 30 }, { drug: 'Vancomycin IV', dot: 61, target: 55 }, { drug: 'Piperacillin-tazobactam', dot: 58, target: 60 }, { drug: 'Ceftriaxone', dot: 70, target: 80 }];
  SEED.handHygiene = [{ unit: 'CICU', pct: 91 }, { unit: 'W4B', pct: 82 }, { unit: 'PEDW', pct: 94 }, { unit: 'ER', pct: 78 }];

  // ---------- Operations ----------
  SEED.assets = [
    { id: 'EQ-001', name: 'Digital X-ray room 1', cat: 'Imaging', loc: 'Ground floor, Radiology', crit: 'High', last: -120, next: 62, status: 'Operational' },
    { id: 'EQ-002', name: 'CT scanner, 128-slice', cat: 'Imaging', loc: 'Ground floor, CT suite', crit: 'Critical', last: -150, next: 30, status: 'Operational' },
    { id: 'EQ-003', name: 'MRI 3.0T', cat: 'Imaging', loc: 'Ground floor, MRI suite', crit: 'Critical', last: -10, next: 170, status: 'Under maintenance' },
    { id: 'EQ-004', name: 'Portable X-ray (CICU)', cat: 'Imaging', loc: '6th floor, CICU', crit: 'High', last: -90, next: 90, status: 'Operational' },
    { id: 'EQ-005', name: 'ICU ventilator #3', cat: 'Life support', loc: '6th floor, CICU', crit: 'Critical', last: -175, next: 5, status: 'Operational' },
    { id: 'EQ-006', name: 'Defibrillator, ER crash cart 2', cat: 'Life support', loc: 'Ground floor, ER', crit: 'Critical', last: -183, next: -3, status: 'Operational' },
    { id: 'EQ-007', name: 'Anesthesia workstation OR-2', cat: 'OR equipment', loc: '2nd floor, OR-2', crit: 'Critical', last: -60, next: 120, status: 'Operational' },
    { id: 'EQ-008', name: 'Blood bank refrigerator', cat: 'Laboratory', loc: 'Ground floor, Blood bank', crit: 'Critical', last: -30, next: 60, status: 'Operational', note: 'Temp 4.1 °C, continuous monitoring' },
    { id: 'EQ-009', name: 'Infusion pump fleet (48)', cat: 'Biomedical', loc: 'Hospital-wide', crit: 'High', last: -200, next: -15, status: 'Operational' }
  ];
  SEED.roster = [
    { unit: 'CICU', shift: 'Day 07:00–19:00', staff: ['Grace Lin, RN (charge)', 'Paul Ng, RN'], ratio: 2 },
    { unit: 'CICU', shift: 'Night 19:00–07:00', staff: ['Maria Santos, RN'], ratio: 2 },
    { unit: 'W4B', shift: 'Day 07:00–19:00', staff: ['Ana Cruz, RN', 'Tom Hale, RN'], ratio: 5 },
    { unit: 'W4B', shift: 'Night 19:00–07:00', staff: ['Lily Tran, RN'], ratio: 5 },
    { unit: 'ER', shift: 'Day 07:00–19:00', staff: ['Dr. Farid Haddad', 'Kim Park, RN', 'Owen Diaz, RN'], ratio: 4 },
    { unit: 'PERIOP', shift: 'Day 06:30–17:00', staff: ['Jamal Rivers, RN', 'Dr. Marcus Yee (Anesthesia)', 'Dr. Caroline Weiss'], ratio: null }
  ];
  SEED.reminders = [
    { patient: 'P11', kind: 'Appointment', channel: 'SMS', when: 'Tomorrow 09:00', status: 'Scheduled', msg: 'You have an upcoming visit at Bayview. Reply C to confirm or call (415) 555-0100.' },
    { patient: 'P09', kind: 'Lab due', channel: 'App', when: 'Today 11:00', status: 'Delivered', msg: 'A lab test is due. Open the Tessera app for details.' },
    { patient: 'P06', kind: 'Medication', channel: 'App push', when: 'Daily 20:00', status: 'Delivered', msg: 'Reminder: it is time for your scheduled medication.' },
    { patient: 'P05', kind: 'Telehealth', channel: 'Email', when: 'Today 09:45', status: 'Opened', msg: 'Your video visit starts soon. Sign in to the Tessera app to join.' }
  ];
  SEED.followups = [
    { patient: 'P09', kind: 'Day-3 wound check call', risk: 'Medium', dueOff: 0, done: false },
    { patient: 'P06', kind: 'Week-1 asthma check', risk: 'Low', dueOff: 1, done: false },
    { patient: 'P12', kind: 'Cardiac rehab enrollment call (after discharge)', risk: 'High', dueOff: 2, done: false }
  ];
  // Month-to-date history for leadership analytics (synthetic, labeled as such in the UI)
  SEED.history = {
    deptVolumes: [['Emergency Medicine', 1420, 0, 1420], ['Cardiology', 610, 182, 0], ['General Medicine', 1980, 304, 0], ['General Surgery', 390, 146, 0], ['Pediatrics', 720, 64, 0], ['Day Care', 0, 0, 0], ['Radiology', 0, 0, 0]],
    revenue: [['Operating rooms', 1840000], ['Cardiac ICU', 1120000], ['Emergency', 930000], ['General Medicine', 610000], ['Radiology', 520000], ['Day Care', 340000], ['Pediatrics', 210000]],
    payerMix: [['Medicare / Medicare Advantage', 46], ['Commercial', 34], ['Medi-Cal (Medicaid)', 15], ['Self-pay', 5]],
    rareCounts: [['Hospital-onset C. difficile', 2], ['Pressure injury, stage 3+', 1], ['Readmissions within 30 days, heart failure', 14], ['Sepsis mortality', 3]]
  };
})(window.TESSERA_SEED);
