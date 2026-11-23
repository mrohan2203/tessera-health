/* Tessera Health — seed for the final Olir One modules and the new modules. Synthetic only. */
(function (SEED) {
  SEED.users.push({ id: 'U-9901', name: 'Noah Kim', username: 'noah.platform', role: 'platform', title: 'Platform reliability engineer', mfa: 'Security key', status: 'active', lastSignIn: 0 });

  // ---------- Credentials & privileges (expDays relative to today) ----------
  SEED.credentials = {
    'U-2001': [['California medical license', 'A-155802', 410], ['DEA registration', 'FM••••521', 220], ['Board certification: Cardiovascular disease', 'ABIM', 900], ['ACLS', 'AHA', 120]],
    'U-2002': [['California medical license', 'A-148310', 95], ['DEA registration', 'BO••••118', 19], ['Board certification: Internal medicine', 'ABIM', 640], ['BLS', 'AHA', 300]],
    'U-2003': [['California medical license', 'A-162207', -12], ['Board certification: Pediatrics', 'ABP', 380], ['PALS', 'AHA', -40]],
    'U-2004': [['California medical license', 'A-151990', 700], ['DEA registration', 'FH••••730', 510], ['Board certification: Emergency medicine', 'ABEM', 1200], ['ACLS', 'AHA', 25], ['ATLS', 'ACS', 330]],
    'U-2005': [['California medical license', 'A-149455', 260], ['DEA registration', 'BW••••902', 800], ['Board certification: General surgery', 'ABS', 1500], ['ACLS', 'AHA', 600]],
    'U-3001': [['California RN license', 'RN 95•••41', 150], ['BLS', 'AHA', 200], ['ACLS', 'AHA', 8], ['CCRN', 'AACN', 400]],
    'U-3002': [['California RN license', 'RN 98•••02', 500], ['BLS', 'AHA', 160], ['CNOR', 'CCI', 720]],
    'U-4001': [['California pharmacist license', 'RPH 7••••3', 300], ['BCPS', 'BPS', 1000]],
    'U-7101': [['California clinical laboratory scientist license', 'CLS ••••88', 240]],
    'U-7201': [['California medical license', 'A-140022', 380], ['Board certification: Diagnostic radiology', 'ABR', 2000], ['MQSA mammography interpretation', 'FDA', 45]]
  };
  SEED.privileges = {
    'U-2005': [['Laparoscopic cholecystectomy (47562)', 'Full'], ['Laparoscopic appendectomy (44970)', 'Full'], ['Total knee arthroplasty (27447)', 'Temporary, expires in 14 days (orthopedics coverage)'], ['Central line placement', 'Full']],
    'U-2004': [['Procedural sedation', 'Full'], ['Endotracheal intubation', 'Full'], ['Central line placement', 'Full']],
    'U-2001': [['Transesophageal echocardiography', 'Full'], ['Cardioversion', 'Full'], ['Left heart catheterization (93458)', 'Proctoring required (3 of 5 done)']]
  };

  // ---------- Consent templates ----------
  SEED.consentTemplates = [
    { id: 'CT-SURG', name: 'Surgical procedure', revocable: false, risks: ['Bleeding', 'Infection', 'Injury to nearby organs', 'Anesthesia risks', 'Need for further surgery'] },
    { id: 'CT-ANES', name: 'Anesthesia', revocable: false, risks: ['Sore throat', 'Nausea', 'Dental injury', 'Awareness (rare)', 'Allergic reaction'] },
    { id: 'CT-BLOOD', name: 'Blood transfusion', revocable: true, risks: ['Fever or allergic reaction', 'Fluid overload', 'Infection (very rare)'] },
    { id: 'CT-RES', name: 'Research participation', revocable: true, risks: ['Loss of confidentiality (minimized by de-identification)', 'Time and inconvenience'] },
    { id: 'CT-AMB', name: 'Ambient recording', revocable: true, risks: ['Conversation is transcribed by a vendor under a BAA; audio deleted when the note is signed'] },
    { id: 'CT-PHOTO', name: 'Clinical photography', revocable: true, risks: ['Photos stored in the record; never shared without separate permission'] },
    { id: 'CT-TELE', name: 'Telehealth', revocable: true, risks: ['Technology may fail', 'Exam is limited compared with in person'] }
  ];

  // ---------- Blood donors ----------
  SEED.donors = [
    { id: 'DN-201', name: 'Marcus Feld', group: 'O-', lastDays: 70, hb: 14.6, status: 'Eligible' },
    { id: 'DN-202', name: 'Alicia Romero', group: 'A+', lastDays: 30, hb: 13.1, status: 'Deferred', why: 'Donated 30 days ago (minimum 56)' },
    { id: 'DN-203', name: 'Kenji Watanabe', group: 'B+', lastDays: 120, hb: 15.2, status: 'Eligible' },
    { id: 'DN-204', name: 'Priyanka Shah', group: 'A-', lastDays: 200, hb: 12.2, status: 'Eligible' },
    { id: 'DN-205', name: 'Tom Becker', group: 'O+', lastDays: 400, hb: 11.9, status: 'Deferred', why: 'Hemoglobin 11.9 g/dL (minimum 12.5)' },
    { id: 'DN-206', name: 'Grace Okoye', group: 'AB+', lastDays: 90, hb: 13.8, status: 'Eligible' },
    { id: 'DN-207', name: 'Luis Ortega', group: 'O+', lastDays: 60, hb: 14.9, status: 'Eligible' }
  ];
  SEED.bbTests = ['ABO/Rh confirmation', 'Antibody screen', 'HIV-1/2 antibody', 'HBsAg (hepatitis B)', 'Anti-HCV (hepatitis C)', 'Syphilis', 'NAT (HIV, HCV, HBV)'];
  SEED.processing = [
    { id: 'W0412 26 001240', donor: 'DN-203', product: 'PRBC', group: 'B+', results: { 0: 'Neg', 1: 'Neg', 2: 'Neg', 3: 'Neg', 4: 'Neg' } },
    { id: 'W0412 26 001241', donor: 'DN-206', product: 'PRBC', group: 'AB+', results: {} }
  ];

  // ---------- Digital twin: floors and zones ----------
  SEED.floors = [
    { id: 'GF', name: 'Ground floor', zones: [{ id: 'z-er', name: 'Emergency', kind: 'er', cap: 12, x: 1, y: 1, w: 4, h: 3 }, { id: 'z-rad', name: 'Radiology', kind: 'rad', cap: 4, x: 5, y: 1, w: 3, h: 2 }, { id: 'z-lab', name: 'Laboratory & blood bank', kind: 'lab', x: 5, y: 3, w: 3, h: 1 }, { id: 'z-reg', name: 'Registration', kind: 'front', x: 8, y: 1, w: 2, h: 2 }, { id: 'z-pha', name: 'Pharmacy', kind: 'pharm', x: 8, y: 3, w: 2, h: 1 }] },
    { id: 'F2', name: 'Second floor', zones: [{ id: 'z-or', name: 'Operating rooms', kind: 'or', cap: 3, x: 1, y: 1, w: 4, h: 2 }, { id: 'z-pacu', name: 'PACU', kind: 'unit', unit: 'PACU', x: 5, y: 1, w: 2, h: 2 }, { id: 'z-dc', name: 'Day care', kind: 'dc', cap: 12, x: 7, y: 1, w: 3, h: 3 }, { id: 'z-sterile', name: 'Sterile processing', kind: 'support', x: 1, y: 3, w: 4, h: 1 }] },
    { id: 'F4', name: 'Fourth floor', zones: [{ id: 'z-4b', name: 'Ward 4B · Med-Surg', kind: 'unit', unit: 'W4B', x: 1, y: 1, w: 6, h: 3 }, { id: 'z-pw', name: 'Pediatric ward', kind: 'unit', unit: 'PEDW', x: 7, y: 1, w: 3, h: 3 }] },
    { id: 'F6', name: 'Sixth floor', zones: [{ id: 'z-cicu', name: 'Cardiac ICU', kind: 'unit', unit: 'CICU', x: 1, y: 1, w: 5, h: 3 }, { id: 'z-cath', name: 'Cath lab', kind: 'support', x: 6, y: 1, w: 4, h: 2 }, { id: 'z-ns6', name: 'Nurse station', kind: 'support', x: 6, y: 3, w: 4, h: 1 }] }
  ];
  SEED.assetZone = { 'EQ-001': 'z-rad', 'EQ-002': 'z-rad', 'EQ-003': 'z-rad', 'EQ-004': 'z-cicu', 'EQ-005': 'z-cicu', 'EQ-006': 'z-er', 'EQ-007': 'z-or', 'EQ-008': 'z-lab', 'EQ-009': 'z-4b' };

  // ---------- Research ----------
  SEED.studies = [
    { id: 'IRB-2026-014', title: 'Hyperkalemia after ARB restart in CKD', pi: 'Dr. Elena Marsh', status: 'Enrolling', waiver: 'Partial HIPAA waiver approved', n: 18 },
    { id: 'IRB-2025-088', title: 'Door-to-balloon time and outcomes registry', pi: 'Dr. Farid Haddad', status: 'Data analysis', waiver: 'De-identified data only', n: 412 },
    { id: 'IRB-2026-031', title: 'Ambient documentation and clinician time', pi: 'Dr. Samuel Okafor', status: 'IRB review', waiver: 'Pending', n: 0 }
  ];

  // ---------- Platform tenants ----------
  SEED.tenants = [
    { id: 'bayview', name: 'Bayview Regional Medical Center', region: 'us-west-2', version: '2026.11.3', health: 'Healthy', keyRotated: -38, backupTested: -6, users: 19 },
    { id: 'sierra', name: 'Sierra Foothills Community Hospital', region: 'us-west-2', version: '2026.11.3', health: 'Healthy', keyRotated: -350, backupTested: -40, users: 212 },
    { id: 'coastal', name: 'Coastal Pediatrics Network', region: 'us-east-1', version: '2026.11.2', health: 'Degraded: report service latency', keyRotated: -90, backupTested: -12, users: 86 }
  ];

  // ---------- Privacy sentinel: synthetic prior audit history (clearly labeled seeded) ----------
  SEED.privacyHistory = [
    { at: -26, actor: 'U-5001', patient: 'P12', action: 'view-account', hour: 23, note: 'After-hours access to a cardiac ICU patient\'s account' },
    { at: -50, actor: 'U-3002', patient: 'P01', action: 'chart-access', hour: 14, outcome: 'blocked', note: 'Tried to open a CICU chart outside the peri-op unit' },
    { at: -51, actor: 'U-3002', patient: 'P04', action: 'chart-access', hour: 14, outcome: 'blocked', note: 'Second out-of-scope attempt within 2 minutes' },
    { at: -52, actor: 'U-3002', patient: 'P12', action: 'chart-access', hour: 14, outcome: 'blocked', note: 'Third out-of-scope attempt within 2 minutes' },
    { at: -200, actor: 'U-2002', patient: 'P05', action: 'view-chart', hour: 10, note: 'VIP-flagged patient opened by a clinician without a care relationship (consult later entered)' }
  ];
  SEED.vip = ['P05'];
  SEED.staffRelations = { 'U-7001': ['P24'] }; // front desk staff member is related to this patient (declared in HR file)

  // ---------- Alert burden: 30-day synthetic history ----------
  SEED.alertHistory = [
    { kind: 'allergy', fired: 64, overridden: 9, harmPrevented: 3 },
    { kind: 'interaction', fired: 212, overridden: 118, harmPrevented: 4 },
    { kind: 'duplicate', fired: 341, overridden: 287, harmPrevented: 0 },
    { kind: 'missing-dose', fired: 58, overridden: 2, harmPrevented: 0 }
  ];
  SEED.alertByClinician = [['Dr. Elena Marsh', 61, 22], ['Dr. Samuel Okafor', 148, 104], ['Dr. Farid Haddad', 203, 131], ['Dr. Caroline Weiss', 92, 41]];

  // ---------- Social needs ----------
  SEED.sdohDomains = [['food', 'Food insecurity', 'Within the past 12 months, did you worry your food would run out before you had money to buy more?'], ['housing', 'Housing instability', 'In the past 12 months, have you been worried about losing your housing, or lived somewhere unsafe?'], ['transport', 'Transportation', 'Has lack of transportation kept you from medical appointments or getting medicines?'], ['utilities', 'Utility difficulties', 'Has the electric, gas or water company threatened to shut off services?'], ['safety', 'Interpersonal safety', 'Does anyone physically hurt you, insult you, threaten you or scream at you?']];
  SEED.communityOrgs = { food: ['East Bay Food Pantry Network (fictional)', 'Meals on Wheels — Bayview (fictional)'], housing: ['Bayview Housing Navigation Center (fictional)'], transport: ['MediRide non-emergency transport (fictional)', 'Medi-Cal transportation benefit'], utilities: ['PG&E-style energy assistance program (fictional)'], safety: ['Confidential advocacy line (fictional)'] };
  SEED.sdohSeed = [
    { patient: 'P09', by: 'Dr. Samuel Okafor', dOff: -21, answers: { food: true, housing: false, transport: true, utilities: false, safety: false } },
    { patient: 'P11', by: 'Front desk intake', dOff: -60, answers: { food: false, housing: false, transport: false, utilities: false, safety: false } }
  ];

  // ---------- Good faith estimates: allowed-amount assumptions ----------
  SEED.cdmPrices = { 27447: [['Surgeon fee', 2850], ['Anesthesia', 1240], ['OR time (2 h)', 6800], ['Implant', 5400], ['Inpatient room, 2 nights', 6200], ['Physical therapy', 480]], 47562: [['Surgeon fee', 1650], ['Anesthesia', 820], ['OR time (1.5 h)', 4900], ['Recovery and same-day stay', 1800], ['Pathology', 210]], 93458: [['Cardiologist fee', 1100], ['Cath lab', 9800], ['Contrast and supplies', 1450], ['Recovery', 1200]] };
  SEED.payerFactor = { 'Self-pay': 0.45, 'Medicare': 0.32, 'Commercial': 0.55 };

  // ---------- Family updates ----------
  SEED.familySeed = { P08: [{ name: 'Anil Bhatt', relation: 'Spouse', contact: '••• ••• 4471', level: 'Status updates' }] };
})(window.TESSERA_SEED);
