/* Phase 3: clinical records. Every clinical item the app keeps (orders, results, notes, lab orders,
   medication administration, pharmacist verification, vitals, care plans, rapid-response events,
   medication reconciliation, chart updates) is one row in app.records, encrypted under its patient's
   data key and versioned. The API enforces the rules below on every write; the browser's own checks
   are only a convenience. Nothing is ever deleted: corrections are new versions, and the rules make
   signed and administered items immutable. */

import { POLICY, COLL_NAMES } from './policy.ts';
export type Coll = string;
export const COLLS: Coll[] = COLL_NAMES;
export const ARRAY_COLLS = new Set<Coll>(COLL_NAMES.filter((c) => POLICY[c].arr)); // the rest are objects keyed by patient, MAR slot, order, discharge or name

export interface Ctx {
  role: string; userId: string; userName: string; key: string;
  patient: any;          // decrypted clinical record (patient-linked collections), else null
  old: any | null; plan?: any | null;
  siblings?: (coll: string) => Promise<{ key: string; body: any }[]>; // other items of a collection, for cross-record checks (double booking)
  ops?: (coll: string) => Promise<any>;                             // an operational collection (blood stock)
}
export class RuleError extends Error { status: number; constructor(msg: string, status = 422) { super(msg); this.status = status; } }
const no = (msg: string, status = 422): never => { throw new RuleError(msg, status); };
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const startsWith = (oldArr: any[] = [], newArr: any[] = []) => newArr.length >= oldArr.length && oldArr.every((x, i) => same(x, newArr[i]));
const only = (role: string, roles: string[], what: string) => { if (!roles.includes(role)) no(`Your role cannot ${what}.`, 403); };

/* Which roles may read each collection (POLICY), with row filters on top. */
export function readable(role: string, coll: Coll, body: any): boolean {
  const pol = POLICY[coll]; if (!pol || !pol.read.includes(role)) return false;
  if (role === 'pharmacist' && coll === 'orders') return body.type === 'Medication';
  if (role === 'patient') {
    if (coll === 'orders') return body.type === 'Medication' && /Signed|Active/.test(body.status || '');
    if (coll === 'labOrders') return body.status === 'Released';
    if (coll === 'notes') return body.signed === true;
  }
  if (coll === 'labOrders' && role === 'doctor') return true;
  return true;
}

/* Allergy check, the server's copy of the app's rule. */
export function allergyConflict(patient: any, drugText: string): string | null {
  const t = String(drugText || '').toLowerCase(), al = patient.allergies || [];
  if (al.some((a: any) => /penicillin/i.test(a.agent)) && /(cillin|amoxi|ampi|piperacillin)/.test(t)) return 'penicillin allergy';
  if (al.some((a: any) => /sulf/i.test(a.agent)) && /(sulfa|sulfameth|bactrim)/.test(t)) return 'sulfonamide allergy';
  return null;
}
const overridden = (o: any) => { const r = typeof o === 'string' ? o : o && o.reason; return typeof r === 'string' && r.trim().length >= 10; }; // { reason } or the reason itself

const VITAL_RANGES: Record<string, [number, number]> = { hr: [20, 250], rr: [4, 70], spo2: [50, 100], temp: [86, 110], sbp: [40, 280], dbp: [20, 180] };
function checkVitals(v: any) {
  for (const [k, [lo, hi]] of Object.entries(VITAL_RANGES)) {
    if (v[k] == null || v[k] === '') continue;
    const n = Number(v[k]); if (!Number.isFinite(n) || n < lo || n > hi) no(`Implausible ${k}: ${v[k]}. Check the reading.`);
  }
  if (v.bp) { const [s, d] = String(v.bp).split('/').map(Number); if (s && (s < 40 || s > 280)) no(`Implausible blood pressure ${v.bp}.`); if (d && (d < 20 || d > 180)) no(`Implausible blood pressure ${v.bp}.`); }
}

/* The rules. `next` is the item as the app wants it stored; `ctx.old` is the stored version (null when new). */
export async function check(coll: Coll, next: any, ctx: Ctx) {
  const { role, old } = ctx;
  const pol = POLICY[coll];
  if (!pol) no('Unknown record type.', 400);
  if (!pol.write.includes(role)) no(role === 'patient' ? 'Your record is read-only here. Requests go through the portal.' : 'Your role cannot change this.', 403);
  if (next === undefined) no('Empty record.');
  if (pol.perUser && ctx.key !== ctx.userId) no('You can only change your own list.', 403);
  switch (coll) {
    case 'orders': {
      if (!old) only(role, ['doctor'], 'place orders');
      if (old) {
        for (const k of ['patient', 'type']) if (!same(old[k], next[k])) no(`An order's ${k} cannot change.`);
        if (/Signed|Rejected|Discontinued/.test(old.status) && !same(old.text, next.text)) no('A signed order cannot be edited. Discontinue it and place a new one.');
        if (role === 'pharmacist') {
          const rest = (o: any) => { const { status, intervention, ...r } = o || {}; return r; };
          if (!same(rest(old), rest(next)) || !(same(old.status, next.status) || next.status === 'Rejected by pharmacy')) no('Pharmacists can verify or reject orders, not change them.', 403);
        }
        if (role === 'nurse' && !same(old, next)) no('Nurses cannot change orders.', 403);
      }
      if (next.type === 'Medication' && next.status === 'Signed') {
        if (role !== 'doctor' && !(old && old.status === 'Signed')) no('Only a doctor can sign a medication order.', 403);
        const hit = allergyConflict(ctx.patient, next.text);
        const planMed = next.fromPlan && ctx.plan ? (ctx.plan.meds || []).find((m: any) => m.id === next.fromPlan) : null;
        if (hit && !overridden(next.flag && next.flag.override) && !overridden(planMed && planMed.override)) no(`Blocked: ${hit}. A doctor must record an override reason before signing.`);
      }
      return;
    }
    case 'notes': {
      only(role, ['doctor', 'nurse'], 'write notes');
      if (old && old.signed) {
        for (const k of ['patient', 'text', 'author', 'kind', 'signed', 'at']) if (!same(old[k], next[k])) no('A signed note cannot be changed. Add an addendum instead.');
        if (!startsWith(old.addenda, next.addenda)) no('Addenda can be added, never edited or removed.');
      } else if (old && old.author !== ctx.userName) no('Only the author can edit or sign a draft note.', 403);
      if (!old && next.author !== ctx.userName) no('A note must be written under your own name.', 403);
      return;
    }
    case 'results': {
      if (!old) { only(role, ['lab', 'pathologist', 'radiologist'], 'create results'); return; } // critical results raised by the lab or imaging
      only(role, ['doctor', 'nurse'], 'act on results');
      for (const k of ['patient', 'test', 'value']) if (!same(old[k], next[k])) no('A result value cannot change.');
      if (!startsWith(old.trail, next.trail)) no('The result trail is append-only.');
      return;
    }
    case 'labOrders': {
      if (!old) { only(role, ['doctor'], 'order labs'); if (next.value != null || next.status === 'Released') no('A new lab order cannot carry a result.'); return; }
      only(role, ['lab', 'pathologist'], 'work lab orders');
      for (const k of ['patient', 'test', 'by']) if (!same(old[k], next[k])) no(`A lab order's ${k} cannot change.`);
      if (old.status === 'Released' && !same(old, next)) no('A released result cannot be changed. Issue a corrected report.');
      const STEPS = ['Ordered', 'Collected', 'Received', 'Resulted', 'Released'];
      if (STEPS.indexOf(next.status) < STEPS.indexOf(old.status)) no('A lab order cannot go back a step.');
      const v = Number(next.value);
      const critical = (next.critHi != null && v >= next.critHi) || (next.critLo != null && v <= next.critLo);
      if (critical && !(String(next.flag || '').length > 1)) no('This value is in the critical range and must be flagged.');
      if (next.status === 'Released' && old.status !== 'Released') {
        if (String(next.flag || '').length > 1 && role !== 'pathologist') no('A critical result needs pathologist verification before release.', 403);
        if (next.flag && next.auto) no('Only normal results can be autoverified.');
      }
      return;
    }
    case 'mar': {
      only(role, ['nurse'], 'chart medication administration');
      if (old) no('An administration entry cannot be changed once charted.');
      if (!['Given', 'Held', 'Refused'].includes(next.state)) no('Unknown administration state.');
      if (next.state !== 'Given' && !String(next.note || '').trim()) no('Give a reason for a held or refused dose.');
      return;
    }
    case 'verified': {
      only(role, ['pharmacist'], 'verify medication orders');
      if (old) no('A verification cannot be changed.');
      return;
    }
    case 'vitalsLog': {
      only(role, ['doctor', 'nurse'], 'chart vitals');
      if (!Array.isArray(next)) no('Bad vitals log.');
      if (!startsWith(old || [], next)) no('Charted vitals cannot be edited or removed. Chart a new set.');
      for (const v of next.slice((old || []).length)) checkVitals(v);
      return;
    }
    case 'carePlans': {
      only(role, ['doctor', 'nurse'], 'change care plans');
      if (role === 'nurse' && old) for (const k of ['goals', 'meds']) if (!same(old[k], next[k])) no('Nurses can update tasks, not goals or medicines.', 403);
      if (role === 'nurse' && !old) no('A doctor starts the care plan.', 403);
      for (const m of next.meds || []) {
        const prev = old ? (old.meds || []).find((x: any) => x.id === m.id) : null;
        if (m.override && !same(prev && prev.override, m.override) && role !== 'doctor') no('Only a doctor can override a blocked medicine.', 403);
        if (m.ordered && !(prev && prev.ordered) && allergyConflict(ctx.patient, m.drug) && !overridden(m.override)) no(`Blocked: ${allergyConflict(ctx.patient, m.drug)}. Record an override reason first.`);
      }
      return;
    }
    case 'rrEvents': {
      only(role, ['doctor', 'nurse'], 'record rapid-response events');
      if (old) {
        if (!startsWith(old.log, next.log)) no('The event log is append-only.');
        if (old.status === 'closed' && (next.log || []).length !== (old.log || []).length) no('A closed event cannot get new entries.');
      }
      for (const x of (next.log || []).slice(old ? (old.log || []).length : 0)) {
        if (x.kind === 'drug' && allergyConflict(ctx.patient, x.text) && !overridden(x.override)) no(`Blocked: ${allergyConflict(ctx.patient, x.text)}. Record an override reason first.`);
        if (x.kind === 'vitals') checkVitals(x);
      }
      return;
    }
    case 'medrec': {
      only(role, ['doctor', 'nurse', 'pharmacist'], 'reconcile medications');
      if (role === 'pharmacist') {
        const strip = (r: any) => JSON.parse(JSON.stringify(r || {}, (k, v) => (k === 'verifiedBy' || k === 'verifiedAt' ? undefined : v)));
        if (!same(strip(old), strip(next))) no('Pharmacists verify a reconciliation; the prescriber completes it.', 403);
      }
      return;
    }
    case 'patientPatches': {
      const ADT = ['receptionist', 'nurse', 'doctor'];
      const allowed: Record<string, string[]> = { vitals: ['doctor', 'nurse'], weightKg: ['doctor', 'nurse'], heightCm: ['doctor', 'nurse'], code: ['doctor'], problems: ['doctor'], meds: ['doctor'], allergies: ['doctor', 'nurse'], allergiesUnknown: ['doctor', 'nurse'], labs: ['doctor'],
        unit: ADT, bed: ADT, status: ADT, dept: ADT, consults: ADT,                                   // admission, transfer, discharge
        name: ADT, dob: ADT, age: ADT, mrn: ['receptionist', 'doctor', 'nurse'], phone: ['receptionist'], payer: ['receptionist', 'doctor', 'nurse'], memberId: ['receptionist'], alias: ADT, unidentified: ADT }; // identity (registration, ER identification)
      for (const k of Object.keys(next)) {
        if (same((old || {})[k], next[k])) continue;
        if (!allowed[k]) no(`"${k}" is not a chart field this API accepts.`);
        if (!allowed[k].includes(role)) no(`Your role cannot change ${k}.`, 403);
        if (k === 'vitals') checkVitals(next.vitals || {});
      }
      return;
    }
    case 'appts': {
      if (next.status && ['No-show', 'Rescheduled', 'Cancelled'].includes(next.status)) return;
      const toMin = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
      if (old && same(old.time, next.time) && same(old.provider, next.provider)) return;
      const others = ctx.siblings ? await ctx.siblings('appts') : [];
      const clash = others.find((o) => o.key !== ctx.key && o.body.provider === next.provider && !['No-show', 'Rescheduled', 'Cancelled'].includes(o.body.status) && Math.abs(toMin(o.body.time) - toMin(next.time)) < 30);
      if (clash) no(`Double booking: that doctor already has a visit at ${clash.body.time}.`, 409);
      return;
    }
    case 'radOrders': {
      if (!old) { only(role, ['doctor'], 'order imaging'); return; }
      const egfr = Number(((ctx.patient && ctx.patient.labs) || []).find((l: any) => /egfr/i.test(l.test))?.value);
      if (next.contrast && Number.isFinite(egfr) && egfr < 30 && next.status !== 'Ordered' && !next.contrastOverride) no(`Contrast blocked: eGFR ${egfr}. Change to non-contrast or record a radiologist override.`);
      if (next.contrastOverride && !(old && old.contrastOverride) && role !== 'radiologist') no('Only a radiologist can override the contrast check.', 403);
      return;
    }
    case 'crossmatch': {
      if (next.state === 'Issued' && !(old && old.state === 'Issued')) {
        if (!next.verifiedBy || next.verifiedBy === ctx.userName) no('Blood is issued only with a second verifier, who cannot be you.');
        const units = ctx.ops ? await ctx.ops('bloodUnits') : [];
        for (const id of next.unitIds || []) { const u = (units || []).find((x: any) => x.id === id); if (!u) no(`Unit ${id} is not in stock.`); if (u.expDays < 0) no(`Unit ${id} is expired and cannot be issued.`); }
      }
      return;
    }
    case 'roleRequests': {
      if (!old) { if (next.by !== ctx.userId) no('A role request must be made under your own name.', 403); if (next.status !== 'pending') no('A new request starts as pending.'); return; }
      for (const k of ['user', 'to', 'by', 'why']) if (!same(old[k], next[k])) no('A role request cannot be edited.');
      if (old.status !== 'pending') no('This request is already decided.');
      if (next.status === 'approved' || next.status === 'rejected') { if (old.by === ctx.userId || old.user === ctx.userId) no('Separation of duties: you cannot decide a change you requested or one to your own role.', 403); }
      else if (next.status === 'withdrawn') { if (old.by !== ctx.userId) no('Only the requester can withdraw.', 403); }
      else no('Unknown decision.');
      return;
    }
    case 'config': {
      if (role === 'quality' && ctx.key !== 'cds') no('Quality can change alert settings only.', 403);
      if (ctx.key === 'cds' && next && next.allergy === false) no('The allergy check cannot be turned off.');
      if (ctx.key === 'idleMin' && !(Number(next) >= 1 && Number(next) <= 30)) no('Idle timeout must be between 1 and 30 minutes.');
      if (ctx.key === 'btgHours' && !(Number(next) >= 1 && Number(next) <= 12)) no('Break-the-glass grants last 1 to 12 hours.');
      return;
    }
    case 'supportReq': {
      if (!old) { only(role, ['platform'], 'request support access'); if (next.status !== 'pending' || next.by !== ctx.userId) no('A request starts as pending, under your name.'); return; }
      if (next.status === 'approved' && old.status !== 'approved') only(role, ['admin'], 'approve support access (the tenant administrator decides)');
      if (role === 'platform' && !same(old, next)) no('The platform team cannot change its own request.', 403);
      return;
    }
    case 'incidents': {
      if (old && !same(old.status, next.status) && !['quality', 'admin'].includes(role)) no('Quality manages incident status.', 403);
      return;
    }
    case 'consents': {
      if (role === 'patient' && old && old.state === 'Done' && !/Revoked/.test(next.state || '') && !same(old, next)) no('A signed consent can only be revoked.');
      return;
    }
  }
}
