/* Phase 4: who may read and write each collection, and how much of a patient each role sees.
   Deny by default: a collection or role not listed here gets nothing. Patient-linked collections are
   stored in app.records (row-level security by patient), operational ones in app.ops. Both are
   encrypted. The clinical rules for individual collections are in records.ts. */

export type PtLink = 'item' | 'key' | 'mar' | 'order' | 'discharge' | false;
export interface Policy { pt: PtLink; read: string[]; write: string[]; perUser?: boolean; scalar?: boolean; arr: boolean; }

const CL = ['doctor', 'nurse'];
const STAFF = ['admin', 'doctor', 'nurse', 'pharmacist', 'billing', 'quality', 'receptionist', 'lab', 'pathologist', 'radiologist', 'insurance', 'executive'];
const P = (arr: boolean, pt: PtLink, read: string[], write: string[], extra: Partial<Policy> = {}): Policy => ({ arr, pt, read, write, ...extra });

export const POLICY: Record<string, Policy> = {
  // Phase 3, clinical (rules in records.ts)
  orders: P(true, 'item', [...CL, 'pharmacist', 'patient'], [...CL, 'pharmacist']),
  results: P(true, 'item', [...CL, 'lab', 'pathologist', 'radiologist'], [...CL, 'lab', 'pathologist', 'radiologist']),
  notes: P(true, 'item', [...CL, 'patient'], CL),
  labOrders: P(true, 'item', [...CL, 'lab', 'pathologist', 'patient'], ['doctor', 'lab', 'pathologist']),
  rrEvents: P(true, 'item', CL, CL),
  mar: P(false, 'mar', [...CL, 'pharmacist'], ['nurse']),
  verified: P(false, 'order', [...CL, 'pharmacist'], ['pharmacist']),
  vitalsLog: P(false, 'key', [...CL, 'patient'], CL),
  carePlans: P(false, 'key', CL, CL),
  medrec: P(false, 'key', [...CL, 'pharmacist'], [...CL, 'pharmacist']),
  patientPatches: P(false, 'key', [...CL, 'pharmacist', 'receptionist', 'billing', 'insurance', 'lab', 'pathologist', 'radiologist', 'patient'], [...CL, 'receptionist']),
  // Phase 4, patient-linked
  appts: P(true, 'item', [...CL, 'receptionist', 'patient'], [...CL, 'receptionist']),
  er: P(true, 'item', [...CL, 'receptionist'], [...CL, 'receptionist']),
  ot: P(true, 'item', CL, CL),
  daycare: P(true, 'item', CL, CL),
  handovers: P(true, 'item', CL, CL),
  pathways: P(true, 'item', CL, CL),
  discharges: P(true, 'item', [...CL, 'pharmacist', 'billing', 'insurance'], [...CL, 'pharmacist', 'billing', 'insurance']),
  dcsum: P(false, 'discharge', CL, ['doctor']),
  tele: P(true, 'item', CL, CL),
  rpm: P(true, 'item', CL, CL),
  erx: P(true, 'item', [...CL, 'pharmacist', 'patient'], ['doctor']),
  consents: P(true, 'item', [...CL, 'receptionist', 'patient', 'quality'], [...CL, 'receptionist', 'patient']),
  ambientNotes: P(true, 'item', CL, ['doctor']),
  radOrders: P(true, 'item', [...CL, 'radiologist'], ['doctor', 'radiologist']),
  crossmatch: P(true, 'item', [...CL, 'lab', 'pathologist'], [...CL, 'lab', 'pathologist']),
  reminders: P(true, 'item', [...CL, 'receptionist', 'patient'], [...CL, 'receptionist']),
  followups: P(true, 'item', [...CL, 'receptionist'], [...CL, 'receptionist']),
  claims: P(true, 'item', ['billing', 'insurance', 'patient'], ['billing', 'doctor']),
  insCases: P(true, 'item', [...CL, 'billing', 'insurance'], [...CL, 'billing', 'insurance']),
  hai: P(true, 'item', [...CL, 'quality'], ['nurse', 'quality']),
  docs: P(true, 'item', CL, CL),
  assessments: P(true, 'item', CL, CL),
  caseDrafts: P(false, 'key', ['doctor'], ['doctor']),
  sdoh: P(true, 'item', [...CL, 'receptionist', 'quality'], [...CL, 'receptionist']),
  sdohRefs: P(true, 'item', [...CL, 'receptionist', 'quality'], [...CL, 'receptionist']),
  gfe: P(true, 'item', ['billing', 'receptionist', 'patient'], ['billing', 'receptionist']),
  family: P(false, 'key', [...CL, 'patient'], [...CL, 'patient']),
  familyMsgs: P(true, 'item', [...CL, 'patient'], CL),
  portalRequests: P(true, 'item', ['doctor', 'patient'], ['doctor', 'patient']),
  shares: P(true, 'item', ['patient'], ['patient']),
  shareLog: P(true, 'item', ['patient'], ['patient']),
  bedRequests: P(true, 'item', [...CL, 'receptionist'], [...CL, 'receptionist']),
  // Phase 4, operational (no patient)
  controlled: P(true, false, ['pharmacist'], ['pharmacist']),
  counts: P(true, false, ['pharmacist'], ['pharmacist']),
  roleRequests: P(true, false, ['admin'], ['admin']),
  review: P(false, false, ['admin'], ['admin']),
  reviewSigned: P(false, false, ['admin'], ['admin'], { scalar: true }),
  gapsDone: P(false, false, ['quality', 'doctor'], ['quality', 'doctor']),
  bedStatus: P(false, false, [...CL, 'receptionist', 'admin', 'executive'], [...CL, 'receptionist']),
  incidents: P(true, false, STAFF, STAFF),
  assets: P(true, false, ['admin', 'executive'], ['admin']),
  workOrders: P(true, false, ['admin', 'executive'], ['admin']),
  config: P(false, false, [...STAFF, 'patient', 'platform'], ['admin', 'quality']), // quality may make a non-allergy alert passive (Alert burden)
  orderSets: P(true, false, [...CL, 'admin'], ['admin']),
  interop: P(false, false, ['admin'], ['admin']),
  notifRead: P(false, false, [...STAFF, 'patient'], [...STAFF, 'patient'], { perUser: true }),
  todos: P(false, false, [...STAFF, 'patient'], [...STAFF, 'patient'], { perUser: true }),
  bloodUnits: P(true, false, [...CL, 'lab', 'pathologist'], ['lab', 'pathologist']),
  donors: P(true, false, ['lab', 'pathologist'], ['lab', 'pathologist']),
  processing: P(true, false, ['lab', 'pathologist'], ['lab', 'pathologist']),
  tenants: P(true, false, ['platform', 'admin'], ['platform']),
  supportReq: P(true, false, ['platform', 'admin'], ['platform', 'admin']),
  credReminders: P(false, false, ['admin'], ['admin']),
  extracts: P(true, false, ['quality'], ['quality']),
  privacyCases: P(false, false, ['admin'], ['admin']),
  forecastWhatIf: P(false, false, ['executive'], ['executive'], { scalar: true }),
  privacyConfig: P(false, false, ['admin'], ['admin']), // VIP list and HR relative links for the Privacy Sentinel
};
export const COLL_NAMES = Object.keys(POLICY);
export const isPatientColl = (c: string) => !!(POLICY[c] && POLICY[c].pt);

/* How much of a patient each role is sent (minimum necessary). Clinical roles and the patient get the
   full record through Phase 2's rules; pharmacists their medication profile. */
const DEMO = ['id', 'token', 'name', 'mrn', 'dob', 'age', 'sex', 'phone', 'payer', 'memberId', 'dept', 'consults', 'unit', 'bed', 'status', 'attending', 'unidentified', 'alias'];
const HEADER = ['id', 'token', 'name', 'mrn', 'dob', 'age', 'sex', 'dept', 'unit', 'bed', 'status', 'attending', 'bloodGroup', 'weightKg'];
export const PROJECTION: Record<string, string[] | 'deid'> = {
  receptionist: DEMO, billing: DEMO, insurance: DEMO,
  lab: HEADER, pathologist: HEADER,
  radiologist: [...HEADER, 'allergies', 'labs'], // contrast safety needs allergies and kidney function
  quality: 'deid',
};
export const ORG_ROLES = Object.keys(PROJECTION);

export function project(role: string, p: any) {
  const f = PROJECTION[role];
  if (!f) return p;
  if (f === 'deid') return { id: p.id, token: p.token, name: p.token, mrn: '—', dob: '', age: p.age, sex: p.sex, dept: p.dept, unit: p.unit, status: p.status, problems: p.problems || [], unidentified: !!p.unidentified, _deid: true }; // Safe Harbor: diagnoses and age, no identifiers
  const out: any = {};
  for (const k of f) if (p[k] !== undefined) out[k] = k === 'labs' ? (p.labs || []).filter((l: any) => /egfr|creatinine/i.test(l.test)) : p[k];
  return out;
}
/* Chart-field patches are cut to the same projection, so a clinical change never reaches the front desk. */
export function projectPatch(role: string, patch: any) {
  const f = PROJECTION[role];
  if (!f || role === 'patient') return patch;
  if (f === 'deid') return {};
  const out: any = {}; for (const k of Object.keys(patch || {})) if (f.includes(k)) out[k] = patch[k]; return out;
}
/* Social-needs answers: the front desk never sees the safety domain. */
export function projectItem(role: string, coll: string, body: any) {
  if (coll === 'sdoh' && role === 'receptionist') { const { answers, ...rest } = body; const a: any = {}; for (const [k, v] of Object.entries(answers || {})) if (!/safety/i.test(k)) a[k] = v; return { ...rest, answers: a }; }
  if (coll === 'sdohRefs' && role === 'receptionist' && /safety/i.test(body.domain || '')) return null;
  if (coll === 'patientPatches') return projectPatch(role, body);
  return body;
}
