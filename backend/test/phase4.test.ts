/* Phase 4: role-scoped census, operational records, front office, diagnostics, blood bank, accounts,
   configuration, registration and ADT, driven through the API in-process. Reseeds before and after. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
let creds: any = {};
const app = build();
const owner = new pg.Pool({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD, max: 2 });
const H = { 'x-tessera': '1', 'content-type': 'application/json' };
const ck = (r: any) => { const c = r.cookies.find((x: any) => x.name === 'tessera_sid'); return c ? `tessera_sid=${c.value}` : ''; };
const sessions: Record<string, string> = {};
async function as(u: string, fresh = false) {
  if (sessions[u] && !fresh) return sessions[u];
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: u, password: creds[u].password } });
  if (a.statusCode !== 200) return '';
  const b = await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(a) }, payload: { code: totp(creds[u].totpSecret) } });
  return (sessions[u] = b.statusCode === 200 ? ck(b) : '');
}
const boot = async (u: string) => JSON.parse((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: await as(u) } })).body);
const get = async (u: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie: await as(u) } });
const post = async (u: string, url: string, payload: any) => app.inject({ method: 'POST', url, headers: { ...H, cookie: await as(u) }, payload });
async function write(u: string, w: any) { const r = await post(u, '/api/records', { writes: [w] }); return r.statusCode === 200 ? JSON.parse(r.body).results[0] : { ok: false, status: r.statusCode }; }
const rec = async (u: string, coll: string, key: string) => { const b = await boot(u); const v = b.records[coll]; const body = Array.isArray(v) ? v.find((x: any) => (x.id || x._k) === key) : v[key]; return { body, version: b.versions[`${coll}|${key}`] || 0 }; };
const audits = async (action: string, outcome = 'success') => +(await owner.query('select count(*) from audit.log where action = $1 and outcome = $2', [action, outcome])).rows[0].count;

before(async () => { execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8')); await app.ready(); });
after(async () => { await app.close(); await appPool.end(); await owner.end(); execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); });

test('each role gets its own slice: front desk demographics, lab a header, quality tokens, platform nothing', async () => {
  const fd = await boot('sofia.frontdesk');
  assert.ok(fd.patients.length > 20 && fd.patients.every((p: any) => p.name && p.phone !== undefined && p.problems === undefined && p.allergies === undefined));
  assert.ok(fd.records.appts.length > 0 && fd.records.orders.length === 0 && fd.records.notes.length === 0);
  const lab = await boot('ben.lab');
  assert.ok(lab.patients.every((p: any) => p.phone === undefined && p.problems === undefined) && lab.records.labOrders.length > 0 && lab.records.bloodUnits.length > 0 && lab.records.appts.length === 0);
  const pf = await boot('noah.platform');
  assert.deepEqual(pf.patients, []); assert.ok(pf.records.tenants.length > 0 && pf.records.claims.length === 0);
  assert.ok(pf.users.every((u: any) => u.role !== 'patient' || u.name === null), 'patient account names never in the directory');
});

test('social needs: the front desk never sees the safety answer, and cannot wipe it', async () => {
  const fd = await boot('sofia.frontdesk');
  const sd = fd.records.sdoh.find((x: any) => x.patient === 'P09');
  assert.ok(sd && !('safety' in sd.answers) && 'food' in sd.answers);
  const r = await write('sofia.frontdesk', { coll: 'sdoh', key: sd._k, patient: 'P09', version: fd.versions[`sdoh|${sd._k}`], body: { ...sd, answers: { ...sd.answers, food: false } } });
  assert.ok(r.ok, JSON.stringify(r));
  const doc = await rec('samuel.gmed', 'sdoh', sd._k);
  assert.ok('safety' in doc.body.answers && doc.body.answers.food === false, 'safety answer kept, food updated');
});

test('appointments: double booking refused across patients the caller cannot see', async () => {
  const r = await write('sofia.frontdesk', { coll: 'appts', key: 'K-T1', patient: 'P03', version: 0, body: { _k: 'K-T1', patient: 'P03', time: '10:15', reason: 'Follow-up visit', provider: 'U-2002', status: 'Scheduled' } });
  assert.equal(r.status, 409); assert.match(r.error, /Double booking/);
  assert.ok((await write('sofia.frontdesk', { coll: 'appts', key: 'K-T2', patient: 'P03', version: 0, body: { _k: 'K-T2', patient: 'P03', time: '16:00', reason: 'Follow-up visit', provider: 'U-2002', status: 'Scheduled' } })).ok);
  assert.equal((await write('ben.lab', { coll: 'appts', key: 'K-T3', patient: 'P03', version: 0, body: {} })).status, 403);
});

test('lab: steps only go forward, critical values must be flagged and only a pathologist releases them', async () => {
  const { body: o, version } = await rec('ben.lab', 'labOrders', 'L-301'); // potassium, critical above 6
  assert.match((await write('ben.lab', { coll: 'labOrders', key: 'L-301', patient: 'P01', version, body: { ...o, status: 'Ordered' } })).error, /back a step/);
  assert.match((await write('ben.lab', { coll: 'labOrders', key: 'L-301', patient: 'P01', version, body: { ...o, status: 'Resulted', value: '6.4', flag: 'H' } })).error, /critical range/);
  const res = { ...o, status: 'Resulted', value: '6.4', flag: 'HH', resultedBy: 'Ben' };
  assert.ok((await write('ben.lab', { coll: 'labOrders', key: 'L-301', patient: 'P01', version, body: res })).ok);
  assert.equal((await write('ben.lab', { coll: 'labOrders', key: 'L-301', patient: 'P01', version: version + 1, body: { ...res, status: 'Released' } })).status, 403);
  assert.ok((await write('hannah.path', { coll: 'labOrders', key: 'L-301', patient: 'P01', version: version + 1, body: { ...res, status: 'Released', releasedBy: 'Hannah' } })).ok);
  assert.match((await write('hannah.path', { coll: 'labOrders', key: 'L-301', patient: 'P01', version: version + 2, body: { ...res, status: 'Released', value: '5.0' } })).error, /released result/);
  assert.equal((await write('elena.cardio', { coll: 'labOrders', key: 'L-301', patient: 'P01', version: version + 2, body: { ...res, status: 'Released' } })).status, 403, 'a doctor changed a lab result');
});

test('radiology: contrast with eGFR under 30 is blocked unless a radiologist overrides', async () => {
  const { body: o, version } = await rec('victor.rad', 'radOrders', 'RAD-6'); // P04, eGFR < 30, contrast
  assert.match((await write('victor.rad', { coll: 'radOrders', key: 'RAD-6', patient: 'P04', version, body: { ...o, status: 'Scheduled' } })).error, /Contrast blocked/);
  assert.ok((await write('victor.rad', { coll: 'radOrders', key: 'RAD-6', patient: 'P04', version, body: { ...o, status: 'Scheduled', contrastOverride: true } })).ok);
});

test('blood: issue needs a second verifier who is not you, and never an expired unit', async () => {
  const { body: x, version } = await rec('ben.lab', 'crossmatch', 'XM-1');
  assert.match((await write('ben.lab', { coll: 'crossmatch', key: 'XM-1', patient: 'P04', version, body: { ...x, state: 'Issued' } })).error, /second verifier/);
  assert.match((await write('ben.lab', { coll: 'crossmatch', key: 'XM-1', patient: 'P04', version, body: { ...x, state: 'Issued', verifiedBy: 'Ben Ito', unitIds: ['W0412 26 001101'] } })).error, /expired|second verifier/);
  assert.match((await write('ben.lab', { coll: 'crossmatch', key: 'XM-1', patient: 'P04', version, body: { ...x, state: 'Issued', verifiedBy: 'Dr. Elena Marsh', unitIds: ['W0412 26 001101'] } })).error, /expired/);
  assert.ok((await write('ben.lab', { coll: 'crossmatch', key: 'XM-1', patient: 'P04', version, body: { ...x, state: 'Issued', verifiedBy: 'Dr. Elena Marsh', unitIds: ['W0412 26 001144'] } })).ok);
});

test('role changes need a second administrator; approval changes the account and its access', async () => {
  const req = { id: 'RQ-T1', user: 'U-2002', to: 'doctor:CARD', toLabel: 'Attending, Cardiology', fromLabel: 'Attending, General Medicine', why: 'Moving to cardiology', by: 'U-1001', status: 'pending', at: new Date().toISOString() };
  assert.equal((await write('dana.admin', { coll: 'roleRequests', key: 'RQ-T1', patient: '', version: 0, body: { ...req, by: 'U-1002' } })).status, 403, 'request under another name');
  assert.ok((await write('dana.admin', { coll: 'roleRequests', key: 'RQ-T1', patient: '', version: 0, body: req })).ok);
  assert.equal((await write('dana.admin', { coll: 'roleRequests', key: 'RQ-T1', patient: '', version: 1, body: { ...req, status: 'approved' } })).status, 403, 'approved own request');
  assert.equal((await write('dana.admin', { coll: 'users', key: 'U-2002', patient: '', version: 0, body: { role: 'doctor', dept: 'CARD', unit: null } })).status, 403, 'direct role edit');
  const sam = await as('samuel.gmed');
  assert.ok((await write('leo.admin', { coll: 'roleRequests', key: 'RQ-T1', patient: '', version: 1, body: { ...req, status: 'approved', approver: 'U-1002' } })).ok);
  const u = (await owner.query("select role, dept from app.users where id = 'U-2002'")).rows[0];
  assert.deepEqual(u, { role: 'doctor', dept: 'CARD' });
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: sam } })).statusCode, 401, 'old session ended');
  const rels = (await owner.query("select array_agg(distinct patient_id order by patient_id) as p from app.care_relationships where user_id = 'U-2002'")).rows[0].p;
  const card = (await owner.query("select array_agg(id order by id) as p from app.patients where dept = 'CARD' or 'CARD' = any(consults)")).rows[0].p;
  assert.deepEqual(rels, card, 'care relationships re-derived for cardiology');
});

test('suspension ends sessions and blocks sign-in; nobody suspends themselves', async () => {
  const rita = await as('rita.insurance', true);
  assert.equal((await write('dana.admin', { coll: 'users', key: 'U-1001', patient: '', version: 0, body: { role: 'admin', dept: null, unit: null, status: 'suspended' } })).status, 403);
  const u = (await owner.query("select role, dept, unit from app.users where username = 'rita.insurance'")).rows[0];
  assert.ok((await write('dana.admin', { coll: 'users', key: (await owner.query("select id from app.users where username = 'rita.insurance'")).rows[0].id, patient: '', version: 0, body: { ...u, status: 'suspended' } })).ok);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: rita } })).statusCode, 401);
  assert.equal(await as('rita.insurance', true), '', 'suspended account signed in');
  assert.equal((await write('elena.cardio', { coll: 'users', key: 'U-1001', patient: '', version: 0, body: { status: 'suspended' } })).status, 403);
});

test('configuration: the allergy check cannot be turned off; limits are bounded', async () => {
  const { body, version } = await rec('dana.admin', 'config', 'cds');
  assert.match((await write('dana.admin', { coll: 'config', key: 'cds', patient: '', version, body: { ...body, allergy: false } })).error, /cannot be turned off/);
  assert.ok((await write('dana.admin', { coll: 'config', key: 'cds', patient: '', version, body: { ...body, duplicate: false } })).ok);
  const idle = await rec('dana.admin', 'config', 'idleMin');
  assert.match((await write('dana.admin', { coll: 'config', key: 'idleMin', patient: '', version: idle.version, body: 600 })).error, /between 1 and 30/);
  assert.equal((await write('elena.cardio', { coll: 'config', key: 'idleMin', patient: '', version: idle.version, body: 20 })).status, 403);
});

test('platform support access: requested by the platform team, approved only by the tenant administrator', async () => {
  const r = { id: 'SR-T1', tenant: 'T-01', by: (await owner.query("select id from app.users where role = 'platform'")).rows[0].id, why: 'INC-1: latency', status: 'pending', at: new Date().toISOString() };
  assert.ok((await write('noah.platform', { coll: 'supportReq', key: 'SR-T1', patient: '', version: 0, body: r })).ok);
  assert.equal((await write('noah.platform', { coll: 'supportReq', key: 'SR-T1', patient: '', version: 1, body: { ...r, status: 'approved' } })).status, 403);
  assert.ok((await write('dana.admin', { coll: 'supportReq', key: 'SR-T1', patient: '', version: 1, body: { ...r, status: 'approved' } })).ok);
});

test('personal lists belong to their owner', async () => {
  assert.equal((await write('elena.cardio', { coll: 'todos', key: 'U-2002', patient: '', version: 0, body: [] })).status, 403);
  assert.ok((await write('elena.cardio', { coll: 'todos', key: 'U-2001', patient: '', version: 0, body: [{ text: 'Call family' }] })).ok);
  await as('samuel.gmed', true); assert.ok(!(await boot('samuel.gmed')).records.todos['U-2001'], "another user's list was sent");
});

test('registration: duplicate caught by blind index, MRN from the server, findable by search', async () => {
  const warned = await audits('mpi-duplicate-warning');
  const dupe = await post('sofia.frontdesk', '/api/patients/register', { patient: { id: 'R-T1', name: 'Harish Malhotraa', dob: '1964-03-14', sex: 'M', age: 62 } });
  assert.equal(dupe.statusCode, 409); assert.match(JSON.parse(dupe.body).error, /Possible duplicate/);
  assert.equal(await audits('mpi-duplicate-warning'), warned + 1);
  const ok = await post('sofia.frontdesk', '/api/patients/register', { patient: { id: 'R-T2', name: 'Mira Castell', dob: '1990-02-02', sex: 'F', age: 36, phone: '4155550199', payer: 'Commercial' } });
  assert.equal(ok.statusCode, 200, ok.body); const r = JSON.parse(ok.body); assert.match(r.mrn, /^2\d{5}$/);
  const found = JSON.parse((await get('samuel.gmed', '/api/search?q=Mira%20Castell')).body).matches;
  assert.deepEqual(found.map((m: any) => m.id), ['R-T2']);
  const raw = (await owner.query("select p::text as t from app.patients p where id = 'R-T2'")).rows[0].t;
  assert.ok(!raw.includes('Mira') && !raw.includes('Castell'), 'new patient name stored in plaintext');
  assert.equal((await post('ben.lab', '/api/patients/register', { patient: { id: 'R-T3', name: 'X Y', dob: '1990-01-01' } })).statusCode, 403);
  const unk = await post('farid.er', '/api/patients/register', { patient: { id: 'X-T1', unidentified: true, sex: 'M', age: 40, dept: 'EMER', unit: 'ER', status: 'Emergency', allergiesUnknown: true } });
  assert.equal(unk.statusCode, 200, unk.body); assert.match(JSON.parse(unk.body).mrn, /^T-/);
  assert.equal((await get('farid.er', '/api/patients/X-T1')).statusCode, 200, 'ER doctor can open the unknown patient they registered');
});

test('admission: assigning a bed gives the receiving unit access and the old unit loses it', async () => {
  // P13 is in the ER; move to CICU (Grace's unit)
  assert.equal((await get('grace.rn', '/api/patients/P13')).statusCode, 403);
  const { body, version } = await rec('sofia.frontdesk', 'patientPatches', 'P13');
  const r = await write('sofia.frontdesk', { coll: 'patientPatches', key: 'P13', patient: 'P13', version, body: { ...(body || {}), unit: 'CICU', bed: 'CICU-6', status: 'Admitted', dept: 'CARD', consults: ['EMER'] } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await get('grace.rn', '/api/patients/P13')).statusCode, 200, 'receiving unit nurse has access');
  assert.equal((await get('elena.cardio', '/api/patients/P13')).statusCode, 200, 'cardiology now has the patient');
  assert.equal((await write('sofia.frontdesk', { coll: 'patientPatches', key: 'P13', patient: 'P13', version: version + 1, body: { problems: ['x'] } })).status, 403, 'front desk changed the problem list');
});

test('quality works de-identified and naming patients is purpose-bound and audited', async () => {
  assert.equal((await post('tomas.quality', '/api/reveal', { ids: ['P01'], purpose: '' })).statusCode, 400);
  const before = await audits('phi-reveal');
  const r = JSON.parse((await post('tomas.quality', '/api/reveal', { ids: ['P01', 'P02'], purpose: 'Diabetes outreach list' })).body);
  assert.equal(r.patients.length, 2); assert.equal(await audits('phi-reveal'), before + 2);
  assert.equal((await post('marcus.billing', '/api/reveal', { ids: ['P01'], purpose: 'curious' })).statusCode, 403);
});

test('operational records are stored only as ciphertext, with every version kept', async () => {
  const raw = (await owner.query("select string_agg(encode(body_enc, 'escape'), '') as d from app.ops")).rows[0].d;
  assert.ok(!raw.includes('Ventilator') && !raw.includes('INC-1'), 'operational record in plaintext');
  assert.ok(+(await owner.query("select count(*) from app.ops_versions where coll = 'roleRequests' and key = 'RQ-T1'")).rows[0].count >= 2);
});
