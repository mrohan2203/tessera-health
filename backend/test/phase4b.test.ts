/* Phase 4b: FHIR R4 read API with app tokens, the changes feed, the outbound message queue and the
   Privacy Sentinel on the audit log. Driven through the API in-process. Reseeds before and after. */
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
// These suites sign the same accounts in many times a minute; hardening.test.ts covers both protections
env.ALLOW_TOTP_REUSE = true; env.RATE_LIMITS = false; process.env.TESSERA_QUIET = '1';

const root = new URL('..', import.meta.url).pathname;
const ctx: any = { window: {} }; vm.createContext(ctx);
for (const f of ['data.js', 'data2.js', 'data3.js', 'data4.js']) vm.runInContext(readFileSync(new URL(`../../tessera/${f}`, import.meta.url), 'utf8'), ctx);
const SEED = ctx.window.TESSERA_SEED;
let creds: any = {};
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
const get = async (u: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie: await as(u) } });
const bearer = (t: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${t}` } });
const post = async (u: string, url: string, payload: any) => app.inject({ method: 'POST', url, headers: { ...H, cookie: await as(u) }, payload });
const J = (r: any) => JSON.parse(r.body);
async function write(u: string, w: any) { const r = await post(u, '/api/records', { writes: [w] }); return r.statusCode === 200 ? J(r).results[0] : { ok: false, status: r.statusCode }; }
const boot = async (u: string) => J(await get(u, '/api/bootstrap'));
const audits = async (action: string, outcome = 'success') => +(await owner.query('select count(*) from audit.log where action = $1 and outcome = $2', [action, outcome])).rows[0].count;

before(async () => { execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8')); await app.ready(); });
after(async () => { await app.close(); await appPool.end(); await owner.end(); execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); });

/* ---------------- FHIR ---------------- */
test('the CapabilityStatement is public and lists the six resource types', async () => {
  const r = await app.inject({ method: 'GET', url: '/fhir/r4/metadata' });
  assert.equal(r.statusCode, 200); assert.match(String(r.headers['content-type']), /fhir\+json/);
  assert.deepEqual(J(r).rest[0].resource.map((x: any) => x.type), ['Patient', 'Observation', 'Condition', 'AllergyIntolerance', 'MedicationRequest', 'DocumentReference']);
  assert.equal((await app.inject({ method: 'POST', url: '/fhir/r4/Patient', payload: {} })).statusCode, 405, 'writes refused');
});

test('a clinician reads US Core-shaped resources for a patient in their care, each read audited', async () => {
  const before = await audits('fhir-read');
  const p = J(await get('elena.cardio', '/fhir/r4/Patient/P01'));
  assert.equal(p.resourceType, 'Patient'); assert.equal(p.identifier[0].value, '100241'); assert.equal(p.gender, 'male');
  const obs = J(await get('elena.cardio', '/fhir/r4/Observation?patient=P01')).entry.map((e: any) => e.resource);
  assert.ok(obs.some((o: any) => o.code.coding.some((c: any) => c.code === '2823-3') && o.interpretation[0].coding[0].code === 'HH'), 'critical potassium with LOINC and interpretation');
  assert.ok(obs.some((o: any) => o.code.coding[0].code === '85354-9' && o.component.length === 2), 'blood pressure panel');
  const vit = J(await get('elena.cardio', '/fhir/r4/Observation?patient=P01&category=vital-signs')).entry.map((e: any) => e.resource);
  assert.ok(vit.length && vit.every((o: any) => o.category[0].coding[0].code === 'vital-signs'));
  const cond = J(await get('elena.cardio', '/fhir/r4/Condition?patient=P01')).entry.map((e: any) => e.resource);
  assert.ok(cond.some((c: any) => c.code.coding[0]?.code === 'E11.9'));
  const al = J(await get('elena.cardio', '/fhir/r4/AllergyIntolerance?patient=P01')).entry.map((e: any) => e.resource);
  assert.ok(al.some((a: any) => a.code.text === 'Penicillin'));
  assert.ok(J(await get('elena.cardio', '/fhir/r4/MedicationRequest?patient=P01')).total > 0);
  const docs = J(await get('elena.cardio', '/fhir/r4/DocumentReference?patient=P01')).entry.map((e: any) => e.resource);
  assert.ok(docs.length && Buffer.from(docs[0].content[0].attachment.data, 'base64').toString().length > 10, 'signed note as a document');
  assert.equal(await audits('fhir-read'), before + 7, 'one audit row per FHIR read');
  assert.equal(J(await get('elena.cardio', '/fhir/r4/Patient?identifier=100241')).entry[0].resource.id, 'P01', 'search by MRN');
});

test('FHIR follows the same access rules: outside care, wrong role, no sign-in', async () => {
  const outside = (await owner.query("select id from app.patients where id not in (select patient_id from app.care_relationships where user_id = 'U-2001') limit 1")).rows[0].id;
  assert.equal((await get('elena.cardio', `/fhir/r4/Patient/${outside}`)).statusCode, 403);
  assert.equal(J(await get('elena.cardio', `/fhir/r4/Observation?patient=${outside}`)).total, 0);
  assert.ok(await audits('fhir-read', 'denied') >= 2);
  assert.equal((await get('sofia.frontdesk', '/fhir/r4/Patient/P01')).statusCode, 403, 'front desk has no FHIR access');
  assert.equal((await app.inject({ method: 'GET', url: '/fhir/r4/Patient/P01' })).statusCode, 401);
  const ph = J(await get('nadia.pharm', '/fhir/r4/Condition?patient=P01'));
  assert.equal(ph.total, 0, 'pharmacist projection has no problem list');
});

test('a patient connects an approved app; its token reads only their record; revoking the app kills it', async () => {
  const pt = SEED.users.find((u: any) => u.role === 'patient');
  const a = await post(pt.username, '/api/fhir/authorize', { app: 'APP-1' });
  assert.equal(a.statusCode, 200, a.body); const tok = J(a);
  assert.equal(tok.patient, pt.patientId); assert.equal(tok.scope, 'patient/*.read');
  assert.equal((await bearer(tok.access_token, `/fhir/r4/Patient/${pt.patientId}`)).statusCode, 200);
  assert.ok(J(await bearer(tok.access_token, `/fhir/r4/Observation?patient=${pt.patientId}`)).total > 0);
  assert.equal((await bearer(tok.access_token, '/fhir/r4/Patient/P01')).statusCode, 403, "another patient's record");
  assert.equal((await bearer(tok.access_token, '/fhir/r4/Observation?patient=P01')).statusCode, 403);
  const row = (await owner.query("select detail from audit.log where action = 'fhir-read' and outcome = 'success' order by seq desc limit 1")).rows[0];
  assert.match(row.detail, /Bayview Patient App/, 'reads are attributed to the app');
  assert.equal((await post(pt.username, '/api/fhir/authorize', { app: 'APP-3' })).statusCode, 403, 'app still in security review');
  assert.equal((await post('elena.cardio', '/api/fhir/authorize', { app: 'APP-1' })).statusCode, 403, 'clinician connected a patient app');
  // revoke in Hospital configuration
  const b = await boot('dana.admin'); const apps = b.records.interop.apps.map((x: any) => x.id === 'APP-1' ? { ...x, status: 'Revoked: tokens invalidated' } : x);
  assert.ok((await write('dana.admin', { coll: 'interop', key: 'apps', patient: '', version: b.versions['interop|apps'], body: apps })).ok);
  assert.equal((await bearer(tok.access_token, `/fhir/r4/Patient/${pt.patientId}`)).statusCode, 401, 'revoked app token still works');
  assert.equal((await bearer('not-a-token', '/fhir/r4/Patient/P01')).statusCode, 401);
});

test("a clinician app is limited to its scopes and to the clinician's own patients", async () => {
  const t = J(await post('elena.cardio', '/api/fhir/authorize', { app: 'APP-2' })).access_token; // user/Observation.read user/Patient.read
  assert.ok(J(await bearer(t, '/fhir/r4/Observation?patient=P01')).total > 0);
  assert.equal((await bearer(t, '/fhir/r4/Condition?patient=P01')).statusCode, 403, 'outside the app scopes');
  const outside = (await owner.query("select id from app.patients where id not in (select patient_id from app.care_relationships where user_id = 'U-2001') limit 1")).rows[0].id;
  assert.equal(J(await bearer(t, `/fhir/r4/Observation?patient=${outside}`)).total, 0, 'token reached beyond the clinician');
  assert.equal((await post('sofia.frontdesk', '/api/fhir/authorize', { app: 'APP-2' })).statusCode, 403);
});

/* ---------------- changes feed ---------------- */
test("the changes feed carries other people's work, filtered for each caller", async () => {
  const since = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 20));
  const n = { id: 'N-FEED', patient: 'P01', author: 'Dr. Elena Marsh', kind: 'Progress note', at: new Date().toISOString(), signed: true, text: 'Feed test note', addenda: [] };
  assert.ok((await write('elena.cardio', { coll: 'notes', key: n.id, patient: 'P01', version: 0, body: n })).ok);
  const rn = J(await get('grace.rn', `/api/changes?since=${encodeURIComponent(since)}`));
  assert.ok(rn.records.notes.some((x: any) => x.id === 'N-FEED') && rn.versions['notes|N-FEED'] === 1, 'nurse did not get the note');
  assert.ok(rn.now && Object.keys(rn.versions).length < 5, 'feed sent more than what changed');
  const bill = J(await get('marcus.billing', `/api/changes?since=${encodeURIComponent(since)}`));
  assert.equal(bill.records.notes.length, 0, 'billing received a note');
  assert.equal((await get('grace.rn', '/api/changes?since=yesterday')).statusCode, 400);
});

/* ---------------- outbound messages ---------------- */
test('events queue pager and email messages that never carry identity or clinical values', async () => {
  const b = await boot('ben.lab'); const o = b.records.labOrders.find((x: any) => x.id === 'L-301'); const v = b.versions['labOrders|L-301'];
  assert.ok((await write('ben.lab', { coll: 'labOrders', key: 'L-301', patient: 'P01', version: v, body: { ...o, status: 'Resulted', value: '6.6', flag: 'HH' } })).ok);
  assert.ok((await write('hannah.path', { coll: 'labOrders', key: 'L-301', patient: 'P01', version: v + 1, body: { ...o, status: 'Released', value: '6.6', flag: 'HH', releasedBy: 'Hannah' } })).ok);
  const page = (await owner.query("select * from app.outbox where subject = 'Critical lab result' order by id desc limit 1")).rows[0];
  assert.ok(page && page.channel === 'pager' && page.to_user === o.by && /PT-[0-9A-F]{6}/.test(page.body));
  assert.ok((await write('farid.er', { coll: 'bedRequests', key: 'BR-T1', patient: 'P13', version: 0, body: { id: 'BR-T1', patient: 'P13', unit: 'CICU', dept: 'CARD', at: new Date().toISOString(), done: false } })).ok);
  assert.ok((await owner.query("select 1 from app.outbox where subject = 'Bed request' and to_role = 'receptionist'")).rowCount);
  assert.equal((await post('samuel.gmed', '/api/patients/P05/btg', { reason: 'Emergency treatment', justification: 'Collapsed in clinic waiting room, need history' })).statusCode, 200);
  assert.ok((await owner.query("select 1 from app.outbox where subject = 'Break-the-glass access to review' and to_role = 'admin'")).rowCount);
  const all = (await owner.query('select subject || body as t from app.outbox')).rows.map((r: any) => r.t).join('\n');
  for (const p of SEED.patients) for (const x of [p.name, p.mrn, p.dob, p.phone]) if (x && String(x).length > 4) assert.ok(!all.includes(String(x)), `outbox carries ${String(x).slice(0, 3)}…`);
  assert.ok(!/6\.6|mmol/.test(all), 'outbox carries a clinical value');
  assert.equal((await get('elena.cardio', '/api/outbox')).statusCode, 403);
  assert.ok(J(await get('dana.admin', '/api/outbox')).messages.length >= 3);
});

/* ---------------- Privacy Sentinel ---------------- */
test('the Privacy Sentinel finds blocked attempts, VIP emergency access and a relative opened by staff', async () => {
  for (const pid of ['P01', 'P02', 'P03']) await get('marcus.billing', `/api/patients/${pid}`); // billing tries charts
  await get('samuel.gmed', '/api/patients/P05'); // P05 is VIP; Samuel has the break-the-glass grant from the test above
  const fd = await boot('sofia.frontdesk'); // Sofia is related to P24 (HR record)
  assert.ok((await write('sofia.frontdesk', { coll: 'appts', key: 'K-REL', patient: 'P24', version: 0, body: { _k: 'K-REL', patient: 'P24', time: '16:30', reason: 'Follow-up visit', provider: 'U-2001', status: 'Scheduled' } })).ok, 'booking failed');
  void fd;
  const r = await get('dana.admin', '/api/privacy/alerts?refresh=1'); assert.equal(r.statusCode, 200);
  const alerts = J(r).alerts;
  const rule = (x: string) => alerts.filter((a: any) => a.rule === x);
  const deny = rule('Repeated blocked chart access').find((a: any) => a.who === 'U-5001');
  assert.ok(deny && deny.risk === 'High', 'blocked attempts not flagged');
  assert.ok(rule('VIP record opened outside the care team').some((a: any) => a.who === 'U-2002'), 'VIP access not flagged');
  assert.ok(rule('Break-the-glass access').some((a: any) => a.risk === 'High'), 'VIP break-the-glass not high risk');
  assert.ok(rule("Staff member accessed a relative's record").some((a: any) => a.who === 'U-7001'), 'relative access not flagged');
  assert.ok(alerts.every((a: any) => !SEED.patients.some((p: any) => JSON.stringify(a).includes(p.name))), 'alerts carry patient names');
  assert.equal((await get('elena.cardio', '/api/privacy/alerts')).statusCode, 403);
  const rel = rule("Staff member accessed a relative's record")[0];
  assert.equal((await post('dana.admin', '/api/privacy/reveal', { token: rel.pt, why: 'short' })).statusCode, 400);
  const before = await audits('privacy-identity-reveal');
  const who = J(await post('dana.admin', '/api/privacy/reveal', { token: rel.pt, why: 'HR relative link flagged by Sentinel' }));
  assert.equal(who.name, SEED.patients.find((p: any) => p.id === 'P24').name);
  assert.equal(await audits('privacy-identity-reveal'), before + 1);
});
