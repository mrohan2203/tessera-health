/* Phase 3 clinical-record rules, driven through the API (in-process). Every write here is undone by
   reseeding at the end (npm run seed), so run the suites against a seeded development database. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { build } from '../src/server.ts';
import { appPool } from '../src/db.ts';
import { totp } from '../src/crypto.ts';
import { env } from '../src/env.ts';

let creds: any = {}; // read after the reseed in before(): seeding issues new passwords
const ctx: any = { window: {} }; vm.createContext(ctx);
for (const f of ['data.js', 'data2.js', 'data3.js', 'data4.js']) vm.runInContext(readFileSync(new URL(`../../tessera/${f}`, import.meta.url), 'utf8'), ctx);
const SEED = ctx.window.TESSERA_SEED;
const app = build();
const owner = new pg.Pool({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD, max: 2 });
const H = { 'x-tessera': '1', 'content-type': 'application/json' };
const ck = (r: any) => { const c = r.cookies.find((x: any) => x.name === 'tessera_sid'); return c ? `tessera_sid=${c.value}` : ''; };
const sessions: Record<string, string> = {};
async function as(u: string) {
  if (sessions[u]) return sessions[u];
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: u, password: creds[u].password } });
  const b = await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(a) }, payload: { code: totp(creds[u].totpSecret) } });
  assert.equal(b.statusCode, 200, b.body); return (sessions[u] = ck(b));
}
const chart = async (u: string, pid: string) => JSON.parse((await app.inject({ method: 'GET', url: `/api/patients/${pid}`, headers: { cookie: await as(u) } })).body);
async function write(u: string, w: any) {
  const r = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: await as(u) }, payload: { writes: [w] } });
  if (r.statusCode !== 200) return { ok: false, status: r.statusCode, error: r.body };
  return JSON.parse(r.body).results[0];
}
const ver = async (u: string, pid: string, coll: string, key: string) => (await chart(u, pid)).versions[`${coll}|${key}`] || 0;
const audits = async (action: string, outcome = 'success') => +(await owner.query('select count(*) from audit.log where action = $1 and outcome = $2', [action, outcome])).rows[0].count;

const DOC = 'elena.cardio', RN = 'grace.rn', PH = 'nadia.pharm', P = 'P01'; // P01: penicillin allergy, Elena's and Grace's patient
before(async () => { execSync('npm run -s seed', { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' }); creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8')); await app.ready(); });
after(async () => { await app.close(); await appPool.end(); await owner.end(); execSync('npm run -s seed', { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' }); });

test('records arrive with the chart, filtered by role', async () => {
  const d = await chart(DOC, P);
  assert.ok(d.records.orders.some((o: any) => o.patient === P) && d.records.notes.length >= 0);
  const ph = await chart(PH, P);
  assert.ok(ph.records.orders.every((o: any) => o.type === 'Medication'), 'pharmacist sees medication orders only');
  assert.deepEqual(ph.records.notes, [], 'pharmacist sees no notes');
});

test('the database holds clinical records only as ciphertext', async () => {
  const raw = (await owner.query("select string_agg(encode(body_enc, 'escape'), '') as d from app.records")).rows[0].d;
  for (const o of SEED.orders) assert.ok(!raw.includes(o.text), 'order text in plaintext');
  for (const n of SEED.notes) assert.ok(!raw.includes(String(n.text).slice(0, 30)), 'note text in plaintext');
});

test('orders: doctors only; penicillin-class drugs blocked without an override, at the server', async () => {
  const o = { id: 'O-T1', patient: P, type: 'Medication', text: 'Amoxicillin 500 mg PO TID', priority: 'Routine', status: 'Pending signature', by: 'U-2001' };
  assert.equal((await write(RN, { coll: 'orders', key: o.id, patient: P, version: 0, body: o })).status, 403, 'nurse placed an order');
  const before = await audits('write-orders', 'denied');
  const signed = await write(DOC, { coll: 'orders', key: o.id, patient: P, version: 0, body: { ...o, status: 'Signed' } });
  assert.equal(signed.ok, false); assert.match(signed.error, /penicillin/);
  assert.equal(await audits('write-orders', 'denied'), before + 1, 'refusal audited');
  const pend = await write(DOC, { coll: 'orders', key: o.id, patient: P, version: 0, body: o });
  assert.ok(pend.ok, JSON.stringify(pend));
  assert.equal((await write(DOC, { coll: 'orders', key: o.id, patient: P, version: 1, body: { ...o, status: 'Signed', flag: { kind: 'allergy', override: { reason: 'short' } } } })).ok, false, 'thin override accepted');
  const ok = await write(DOC, { coll: 'orders', key: o.id, patient: P, version: 1, body: { ...o, status: 'Signed', flag: { kind: 'allergy', override: { reason: 'Tolerated amoxicillin in 2024 per allergist', by: 'U-2001' } } } });
  assert.ok(ok.ok && ok.version === 2);
  const edit = await write(DOC, { coll: 'orders', key: o.id, patient: P, version: 2, body: { ...o, text: 'Amoxicillin 1 g PO TID', status: 'Signed' } });
  assert.match(edit.error, /signed order cannot be edited/);
});

test('versions stop lost updates', async () => {
  const v = await ver(DOC, P, 'orders', 'O-T1');
  const stale = await write(DOC, { coll: 'orders', key: 'O-T1', patient: P, version: v - 1, body: {} });
  assert.equal(stale.status, 409); assert.equal(stale.current.version, v);
});

test('pharmacists verify once; they cannot edit orders or chart doses', async () => {
  assert.ok((await write(PH, { coll: 'verified', key: 'O-T1', patient: P, version: 0, body: { by: 'Nadia', at: new Date().toISOString() } })).ok);
  assert.equal((await write(PH, { coll: 'verified', key: 'O-T1', patient: P, version: 1, body: { by: 'x' } })).ok, false);
  assert.equal((await write(PH, { coll: 'verified', key: 'O-NONE', patient: P, version: 0, body: {} })).status, 400);
  const v = await ver(DOC, P, 'orders', 'O-T1');
  const o = (await chart(DOC, P)).records.orders.find((x: any) => x.id === 'O-T1');
  assert.equal((await write(PH, { coll: 'orders', key: 'O-T1', patient: P, version: v, body: { ...o, priority: 'STAT' } })).status, 403);
  assert.equal((await write(PH, { coll: 'mar', key: `${P}|Aspirin 81 mg PO|14:00`, patient: P, version: 0, body: { state: 'Given' } })).status, 403);
});

test('MAR: nurses chart once; held doses need a reason', async () => {
  const key = `${P}|Aspirin 81 mg PO|20:00`;
  assert.equal((await write(RN, { coll: 'mar', key, patient: P, version: 0, body: { state: 'Held' } })).ok, false);
  assert.ok((await write(RN, { coll: 'mar', key, patient: P, version: 0, body: { state: 'Given', by: 'Grace', at: new Date().toISOString() } })).ok);
  assert.equal((await write(RN, { coll: 'mar', key, patient: P, version: 1, body: { state: 'Held', note: 'oops' } })).ok, false, 'administration rewritten');
  assert.equal((await write(RN, { coll: 'mar', key: `P02|Aspirin|20:00`, patient: P, version: 0, body: { state: 'Given' } })).status, 400, 'slot for another patient');
});

test('notes: signed notes are immutable, addenda only grow, drafts belong to their author', async () => {
  const n = { id: 'N-T1', patient: P, author: 'Dr. Elena Marsh', kind: 'Progress note', at: new Date().toISOString(), signed: false, text: 'Draft', addenda: [] };
  assert.equal((await write(DOC, { coll: 'notes', key: n.id, patient: P, version: 0, body: { ...n, author: 'Dr. Someone Else' } })).status, 403);
  assert.ok((await write(DOC, { coll: 'notes', key: n.id, patient: P, version: 0, body: n })).ok);
  assert.equal((await write('samuel.gmed', { coll: 'notes', key: n.id, patient: P, version: 1, body: { ...n, text: 'hijack' } })).status, 403, 'another doctor edited the draft');
  assert.ok((await write(DOC, { coll: 'notes', key: n.id, patient: P, version: 1, body: { ...n, signed: true, text: 'Final' } })).ok);
  const signed = { ...n, signed: true, text: 'Final' };
  assert.match((await write(DOC, { coll: 'notes', key: n.id, patient: P, version: 2, body: { ...signed, text: 'Changed' } })).error, /cannot be changed/);
  const add = { author: 'Dr. Elena Marsh', at: new Date().toISOString(), text: 'Addendum' };
  assert.ok((await write(DOC, { coll: 'notes', key: n.id, patient: P, version: 2, body: { ...signed, addenda: [add] } })).ok);
  assert.match((await write(DOC, { coll: 'notes', key: n.id, patient: P, version: 3, body: { ...signed, addenda: [] } })).error, /never edited or removed/);
});

test('vitals: append-only and range-checked; current vitals patch limited to chart fields', async () => {
  const v1 = [{ at: Date.now(), hr: 88, rr: 18, spo2: 96, sbp: 130, dbp: 80, temp: 98.6 }];
  assert.ok((await write(RN, { coll: 'vitalsLog', key: P, patient: P, version: 0, body: v1 })).ok);
  assert.match((await write(RN, { coll: 'vitalsLog', key: P, patient: P, version: 1, body: [...v1, { at: Date.now(), hr: 400 }] })).error, /Implausible hr/);
  assert.match((await write(RN, { coll: 'vitalsLog', key: P, patient: P, version: 1, body: [{ ...v1[0], hr: 60 }] })).error, /cannot be edited/);
  assert.equal((await write(PH, { coll: 'vitalsLog', key: P, patient: P, version: 1, body: v1 })).status, 403);
  assert.ok((await write(RN, { coll: 'patientPatches', key: P, patient: P, version: 0, body: { vitals: { bp: '128/78', hr: 90, rr: 18, temp: 98.4, spo2: 96 } } })).ok);
  assert.equal((await write(RN, { coll: 'patientPatches', key: P, patient: P, version: 1, body: { vitals: { bp: '128/78', hr: 90, rr: 18, temp: 98.4, spo2: 96 }, phone: '4155550000' } })).status, 403, 'nurse changed a phone number (front desk only)');
  assert.match((await write(RN, { coll: 'patientPatches', key: P, patient: P, version: 1, body: { vitals: { bp: '128/78', hr: 90 }, favouriteColour: 'blue' } })).error, /not a chart field/);
  assert.equal((await write(RN, { coll: 'patientPatches', key: P, patient: P, version: 1, body: { vitals: { bp: '128/78', hr: 90 }, code: 'DNR' } })).status, 403, 'nurse changed code status');
});

test('care plans: a doctor starts them, nurses only tick tasks, blocked medicines need a doctor override', async () => {
  const plan = { goals: [{ id: 'G1', text: 'K below 5.1' }], tasks: [{ id: 'T1', text: 'Repeat potassium' }], meds: [] };
  assert.equal((await write(RN, { coll: 'carePlans', key: P, patient: P, version: 0, body: plan })).status, 403);
  assert.ok((await write(DOC, { coll: 'carePlans', key: P, patient: P, version: 0, body: plan })).ok);
  assert.ok((await write(RN, { coll: 'carePlans', key: P, patient: P, version: 1, body: { ...plan, tasks: [{ id: 'T1', text: 'Repeat potassium', done: { by: 'Grace' } }] } })).ok);
  assert.equal((await write(RN, { coll: 'carePlans', key: P, patient: P, version: 2, body: { ...plan, goals: [] } })).status, 403);
  const med = { id: 'PM1', drug: 'Amoxicillin 500 mg PO TID', check: { level: 'block' } };
  const p2 = { ...plan, tasks: [{ id: 'T1', text: 'Repeat potassium', done: { by: 'Grace' } }], meds: [med] };
  assert.ok((await write(DOC, { coll: 'carePlans', key: P, patient: P, version: 2, body: p2 })).ok);
  assert.match((await write(DOC, { coll: 'carePlans', key: P, patient: P, version: 3, body: { ...p2, meds: [{ ...med, ordered: { id: 'O-T2' } }] } })).error, /penicillin/);
  const p4 = { ...p2, meds: [{ ...med, override: { reason: 'Allergist cleared amoxicillin in 2024', by: 'U-2001' } }] };
  assert.ok((await write(DOC, { coll: 'carePlans', key: P, patient: P, version: 3, body: p4 })).ok);
  // an order from that overridden plan medicine can now be signed
  assert.ok((await write(DOC, { coll: 'orders', key: 'O-T2', patient: P, version: 0, body: { id: 'O-T2', patient: P, type: 'Medication', text: med.drug, status: 'Signed', fromPlan: 'PM1' } })).ok);
});

test('rapid-response events: log append-only, drug check, closed events frozen', async () => {
  const ev = { id: 'RR-T1', patient: P, kind: 'rapid', status: 'open', log: [{ at: 1, kind: 'call', text: 'Rapid response called' }] };
  assert.ok((await write(RN, { coll: 'rrEvents', key: ev.id, patient: P, version: 0, body: ev })).ok);
  assert.match((await write(RN, { coll: 'rrEvents', key: ev.id, patient: P, version: 1, body: { ...ev, log: [...ev.log, { at: 2, kind: 'drug', text: 'Amoxicillin 1 g IV' }] } })).error, /penicillin/);
  assert.match((await write(RN, { coll: 'rrEvents', key: ev.id, patient: P, version: 1, body: { ...ev, log: [] } })).error, /append-only/);
  const closed = { ...ev, status: 'closed' };
  assert.ok((await write(RN, { coll: 'rrEvents', key: ev.id, patient: P, version: 1, body: closed })).ok);
  assert.match((await write(RN, { coll: 'rrEvents', key: ev.id, patient: P, version: 2, body: { ...closed, log: [...ev.log, { at: 3, kind: 'note', text: 'late' }] } })).error, /closed event/);
});

test('outside the care relationship nothing can be written, and the attempt is audited', async () => {
  const outside = (await owner.query("select id from app.patients where id not in (select patient_id from app.care_relationships where user_id = 'U-2001') limit 1")).rows[0].id;
  const before = await audits('write-notes', 'denied');
  const r = await write(DOC, { coll: 'notes', key: 'N-T9', patient: outside, version: 0, body: { id: 'N-T9', patient: outside, author: 'Dr. Elena Marsh', text: 'x', signed: false, addenda: [] } });
  assert.equal(r.status, 403);
  assert.equal(await audits('write-notes', 'denied'), before + 1);
  assert.equal((await write('marcus.billing', { coll: 'notes', key: 'N-T9', patient: P, version: 0, body: {} })).status, 403, 'billing wrote a note');
  assert.equal((await write('radha.patient', { coll: 'notes', key: 'N-T9', patient: 'P08', version: 0, body: {} })).status, 403, 'patient wrote to their record');
});

test('every version is kept, and the API role cannot delete records', async () => {
  const n = +(await owner.query("select count(*) from app.record_versions where coll = 'notes' and key = 'N-T1'")).rows[0].count;
  assert.equal(n, 3);
  const c = await appPool.connect();
  try { await assert.rejects(c.query("delete from app.records where key = 'N-T1'"), /permission denied/); await assert.rejects(c.query('select * from app.record_versions'), /permission denied/); }
  finally { c.release(); }
});
