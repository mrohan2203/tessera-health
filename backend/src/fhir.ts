/* Phase 4b: FHIR R4 read API (US Core-shaped). Turns Tessera's records into FHIR resources. Access
   rules live in server.ts and are the same as the app's: role, care relationship, row-level security,
   projection, and an audit row for every read. This file only maps data. */

export const FHIR_TYPES = ['Patient', 'Observation', 'Condition', 'AllergyIntolerance', 'MedicationRequest', 'DocumentReference'] as const;
export type FhirType = typeof FHIR_TYPES[number];
const MRN_SYSTEM = 'urn:tessera:mrn';
const LOINC = 'http://loinc.org';
const ref = (pid: string) => ({ reference: `Patient/${pid}` });
const iso = (v: any) => { const d = new Date(typeof v === 'number' ? v : v || Date.now()); return isNaN(+d) ? new Date().toISOString() : d.toISOString(); };
const dayAgo = (dOff: any) => new Date(Date.now() + (Number(dOff) || 0) * 864e5).toISOString();

export function capability(base: string) {
  return {
    resourceType: 'CapabilityStatement', status: 'active', date: new Date().toISOString().slice(0, 10), kind: 'instance', fhirVersion: '4.0.1', format: ['json'],
    implementation: { description: 'Tessera Health FHIR R4 read API', url: base },
    rest: [{
      mode: 'server',
      security: { description: 'Session cookie (Tessera app) or Bearer token for an approved app, issued by POST /api/fhir/authorize. Every read is authorised by role and care relationship and audited.' },
      resource: FHIR_TYPES.map((t) => ({ type: t, interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: t === 'Patient' ? [{ name: 'identifier', type: 'token' }] : [{ name: 'patient', type: 'reference' }, ...(t === 'Observation' ? [{ name: 'category', type: 'token' }] : [])] })),
    }],
  };
}

export function patient(p: any) {
  const [given, ...rest] = String(p.name || '').split(' ');
  return {
    resourceType: 'Patient', id: p.id,
    identifier: [{ system: MRN_SYSTEM, value: p.mrn }],
    name: p.name ? [{ text: p.name, family: rest.join(' ') || undefined, given: [given] }] : undefined,
    gender: p.sex === 'M' ? 'male' : p.sex === 'F' ? 'female' : 'unknown',
    birthDate: p.dob || undefined,
    telecom: p.phone ? [{ system: 'phone', value: p.phone }] : undefined,
  };
}

const VITAL = [['hr', '8867-4', 'Heart rate', '/min'], ['rr', '9279-1', 'Respiratory rate', '/min'], ['spo2', '59408-5', 'Oxygen saturation', '%'], ['temp', '8310-5', 'Body temperature', '[degF]']] as const;
function vitalObs(pid: string, v: any, at: any, n: string) {
  const out: any[] = [];
  const cat = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }];
  for (const [k, code, label, unit] of VITAL) {
    const x = Number(v[k]); if (!Number.isFinite(x)) continue;
    out.push({ resourceType: 'Observation', id: `${pid}-${k}-${n}`, status: 'final', category: cat, code: { coding: [{ system: LOINC, code, display: label }], text: label }, subject: ref(pid), effectiveDateTime: iso(at), valueQuantity: { value: x, unit, system: 'http://unitsofmeasure.org', code: unit } });
  }
  const bp = v.bp ? String(v.bp).split('/').map(Number) : [Number(v.sbp), Number(v.dbp)];
  if (Number.isFinite(bp[0]) && Number.isFinite(bp[1])) out.push({ resourceType: 'Observation', id: `${pid}-bp-${n}`, status: 'final', category: cat, code: { coding: [{ system: LOINC, code: '85354-9', display: 'Blood pressure panel' }], text: 'Blood pressure' }, subject: ref(pid), effectiveDateTime: iso(at),
    component: [{ code: { coding: [{ system: LOINC, code: '8480-6', display: 'Systolic' }] }, valueQuantity: { value: bp[0], unit: 'mm[Hg]' } }, { code: { coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic' }] }, valueQuantity: { value: bp[1], unit: 'mm[Hg]' } }] });
  return out;
}
const INTERP: Record<string, string> = { H: 'H', HH: 'HH', L: 'L', LL: 'LL', A: 'A' };
function labObs(pid: string, l: any, id: string) {
  const v = Number(l.value);
  return { resourceType: 'Observation', id, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { coding: l.loinc ? [{ system: LOINC, code: l.loinc, display: l.test }] : [], text: l.test }, subject: ref(pid), effectiveDateTime: dayAgo(l.dOff),
    ...(Number.isFinite(v) ? { valueQuantity: { value: v, unit: l.unit || '' } } : { valueString: String(l.value ?? '') }),
    ...(l.ref ? { referenceRange: [{ text: l.ref }] } : {}),
    ...(l.flag && INTERP[l.flag] ? { interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: INTERP[l.flag] }] }] } : {}) };
}

/* Everything for one patient, as FHIR resources of the requested types. `recs` holds the patient's
   records already filtered for the caller (vitalsLog, labOrders, orders, notes). */
export function resourcesFor(p: any, recs: any, types: Set<string>, category?: string) {
  const pid = p.id, out: any[] = [];
  if (types.has('Observation')) {
    if (!category || category === 'vital-signs') {
      const log = (recs.vitalsLog || {})[pid] || [];
      log.forEach((v: any, i: number) => out.push(...vitalObs(pid, v, v.at, `log${i}`)));
      if (p.vitals) out.push(...vitalObs(pid, p.vitals, Date.now(), 'current'));
    }
    if (!category || category === 'laboratory') {
      (p.labs || []).forEach((l: any, i: number) => out.push(labObs(pid, l, `${pid}-lab-${i}`)));
      (recs.labOrders || []).filter((o: any) => o.patient === pid && o.status === 'Released').forEach((o: any) => out.push(labObs(pid, { ...o, dOff: 0 }, `${pid}-${o.id}`)));
    }
  }
  if (types.has('Condition')) (p.problems || []).forEach((t: string, i: number) => {
    const icd = (String(t).match(/\(([A-Z]\d[\d.A-Z]*)\)/) || [])[1];
    out.push({ resourceType: 'Condition', id: `${pid}-cond-${i}`, clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] }],
      code: { coding: icd ? [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: icd }] : [], text: String(t).replace(/\s*\([^)]*\)\s*$/, '') }, subject: ref(pid) });
  });
  if (types.has('AllergyIntolerance')) {
    if (p.allergiesUnknown) out.push({ resourceType: 'AllergyIntolerance', id: `${pid}-allergy-unknown`, clinicalStatus: { coding: [{ code: 'active' }] }, verificationStatus: { coding: [{ code: 'unconfirmed' }] }, code: { text: 'Allergies unknown' }, patient: ref(pid) });
    (p.allergies || []).forEach((a: any, i: number) => out.push({ resourceType: 'AllergyIntolerance', id: `${pid}-allergy-${i}`, clinicalStatus: { coding: [{ code: 'active' }] }, verificationStatus: { coding: [{ code: 'confirmed' }] },
      code: { text: a.agent }, patient: ref(pid), reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }], severity: /severe/i.test(a.severity) ? 'severe' : /mild/i.test(a.severity) ? 'mild' : 'moderate' }] : undefined }));
  }
  if (types.has('MedicationRequest')) {
    (p.meds || []).forEach((m: any, i: number) => out.push({ resourceType: 'MedicationRequest', id: `${pid}-med-${i}`, status: /held|stopped/i.test(m.status) ? 'on-hold' : /pending/i.test(m.status) ? 'draft' : 'active', intent: 'order',
      medicationCodeableConcept: { text: m.drug }, subject: ref(pid), dosageInstruction: [{ text: [m.dose, m.route, m.freq].filter(Boolean).join(' ') }] }));
    (recs.orders || []).filter((o: any) => o.patient === pid && o.type === 'Medication').forEach((o: any) => out.push({ resourceType: 'MedicationRequest', id: `${pid}-${o.id}`, status: o.status === 'Signed' ? 'active' : /Rejected|Discontinued/.test(o.status) ? 'stopped' : 'draft', intent: 'order', medicationCodeableConcept: { text: o.text }, subject: ref(pid), priority: o.priority === 'STAT' ? 'stat' : 'routine' }));
  }
  if (types.has('DocumentReference')) (recs.notes || []).filter((n: any) => n.patient === pid && n.signed).forEach((n: any) => out.push({ resourceType: 'DocumentReference', id: `${pid}-${n.id}`, status: 'current',
    type: { coding: [{ system: LOINC, code: '11506-3', display: 'Progress note' }], text: n.kind }, subject: ref(pid), date: iso(n.at), author: [{ display: n.author }],
    content: [{ attachment: { contentType: 'text/plain', data: Buffer.from([n.text, ...(n.addenda || []).map((a: any) => `Addendum (${a.author}): ${a.text}`)].join('\n\n')).toString('base64') } }] }));
  return out;
}

export const bundle = (base: string, entries: any[]) => ({ resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r })) });
export const outcome = (code: string, text: string) => ({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code, diagnostics: text }] });

/* SMART-style scopes: patient/*.read, user/Observation.read ... */
export function allows(scopes: string, type: string): boolean {
  return String(scopes || '').split(/\s+/).some((s) => { const m = /^(patient|user)\/(\*|[A-Za-z]+)\.(read|\*)$/.exec(s); return !!m && (m[2] === '*' || m[2] === type); });
}
