/* Phase 3: clinical records. Every clinical item the app keeps (orders, results, notes, lab orders,
   medication administration, pharmacist verification, vitals, care plans, rapid-response events,
   medication reconciliation, chart updates) is one row in app.records, encrypted under its patient's
   data key and versioned. The API enforces the rules below on every write; the browser's own checks
   are only a convenience. Nothing is ever deleted: corrections are new versions, and the rules make
   signed and administered items immutable. */

export type Coll = 'orders' | 'results' | 'notes' | 'labOrders' | 'rrEvents' | 'mar' | 'verified' | 'vitalsLog' | 'carePlans' | 'medrec' | 'patientPatches';
export const COLLS: Coll[] = ['orders', 'results', 'notes', 'labOrders', 'rrEvents', 'mar', 'verified', 'vitalsLog', 'carePlans', 'medrec', 'patientPatches'];
export const ARRAY_COLLS = new Set<Coll>(['orders', 'results', 'notes', 'labOrders', 'rrEvents']); // the rest are objects keyed by patient, MAR slot or order id

export interface Ctx { role: string; userId: string; userName: string; patient: any; /* decrypted clinical record */ old: any | null; plan?: any | null; }
export class RuleError extends Error { status: number; constructor(msg: string, status = 422) { super(msg); this.status = status; } }
const no = (msg: string, status = 422): never => { throw new RuleError(msg, status); };
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const startsWith = (oldArr: any[] = [], newArr: any[] = []) => newArr.length >= oldArr.length && oldArr.every((x, i) => same(x, newArr[i]));
const only = (role: string, roles: string[], what: string) => { if (!roles.includes(role)) no(`Your role cannot ${what}.`, 403); };

/* Which roles may read each collection (on top of the care relationship), and how to filter rows. */
export function readable(role: string, coll: Coll, body: any): boolean {
  if (role === 'doctor' || role === 'nurse') return true;
  if (role === 'pharmacist') return (coll === 'orders' && body.type === 'Medication') || ['verified', 'mar', 'medrec'].includes(coll);
  if (role === 'patient') return (coll === 'orders' && body.type === 'Medication' && /Signed|Active/.test(body.status || '')) || (coll === 'labOrders' && body.status === 'Released') || (coll === 'notes' && body.signed === true);
  return false;
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
export function check(coll: Coll, next: any, ctx: Ctx) {
  const { role, old } = ctx;
  if (next == null || typeof next !== 'object') no('Empty record.');
  if (role === 'patient') no('Your record is read-only here. Requests go through the portal.', 403);
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
      only(role, ['doctor', 'nurse'], 'act on results');
      if (old) { for (const k of ['patient', 'test', 'value']) if (!same(old[k], next[k])) no('A result value cannot change.'); if (!startsWith(old.trail, next.trail)) no('The result trail is append-only.'); }
      else no('Results come from the laboratory and imaging systems.', 403);
      return;
    }
    case 'labOrders': {
      if (!old) { only(role, ['doctor'], 'order labs'); if (next.value != null || next.status === 'Released') no('A new lab order cannot carry a result.'); return; }
      no('Lab results are entered by the laboratory (Phase 4).', 403);
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
      const allowed: Record<string, string[]> = { vitals: ['doctor', 'nurse'], weightKg: ['doctor', 'nurse'], heightCm: ['doctor', 'nurse'], code: ['doctor'], problems: ['doctor'], meds: ['doctor'], allergies: ['doctor', 'nurse'], allergiesUnknown: ['doctor', 'nurse'] };
      for (const k of Object.keys(next)) {
        if (same((old || {})[k], next[k])) continue;
        if (!allowed[k]) no(`"${k}" is not a chart field this API accepts yet (registration and bed moves come in Phase 4).`);
        if (!allowed[k].includes(role)) no(`Your role cannot change ${k}.`, 403);
        if (k === 'vitals') checkVitals(next.vitals || {});
      }
      return;
    }
  }
}
