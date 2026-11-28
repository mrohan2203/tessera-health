/* Phase 2 security tests. Run against the local database after `npm run migrate && npm run seed`.
   They drive the API in-process (Fastify inject), and check the database directly as the owner and as
   tessera_app. Anything they change is put back at the end. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { build } from '../src/server.ts';
import { appPool } from '../src/db.ts';
import { totp } from '../src/crypto.ts';
import { env } from '../src/env.ts';

const creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8'));
const ctx: any = { window: {} }; vm.createContext(ctx);
for (const f of ['data.js', 'data2.js', 'data3.js', 'data4.js']) vm.runInContext(readFileSync(new URL(`../../tessera/${f}`, import.meta.url), 'utf8'), ctx);
const SEED = ctx.window.TESSERA_SEED;
const userId = (u: string) => SEED.users.find((x: any) => x.username === u).id;

const app = build();
const owner = new pg.Pool({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD, max: 2 });
const H = { 'x-tessera': '1', 'content-type': 'application/json' };
const cookieOf = (r: any) => { const c = r.cookies.find((x: any) => x.name === 'tessera_sid'); return c ? `tessera_sid=${c.value}` : ''; };

async function login(username: string) {
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username, password: creds[username].password } });
  assert.equal(a.statusCode, 200, `password step for ${username}: ${a.body}`);
  const b = await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: cookieOf(a) }, payload: { code: totp(creds[username].totpSecret) } });
  assert.equal(b.statusCode, 200, `mfa step for ${username}: ${b.body}`);
  return cookieOf(b);
}
const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string, payload: any = {}) => app.inject({ method: 'POST', url, headers: { ...H, cookie }, payload });
const auditCount = async (where: string, args: any[]) => +(await owner.query(`select count(*) from audit.log where ${where}`, args)).rows[0].count;

before(async () => { await app.ready(); });
after(async () => {
  await owner.query('delete from app.btg_grants');
  await owner.query('update app.users set failed_logins = 0, locked_until = null');
  await app.close(); await appPool.end(); await owner.end();
});

/* ---------------- authentication ---------------- */
test('sign-in needs password and then the authenticator code; the pre-MFA token is not a session', async () => {
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'elena.cardio', password: creds['elena.cardio'].password } });
  assert.equal(a.statusCode, 200);
  assert.equal((await get('/api/me', cookieOf(a))).statusCode, 401, 'password alone must not open a session');
  assert.equal((await get('/api/patients', cookieOf(a))).statusCode, 401);
  const bad = await post('/api/auth/mfa', cookieOf(a), { code: '000000' });
  assert.equal(bad.statusCode, 401);
  const cookie = await login('elena.cardio');
  const me = JSON.parse((await get('/api/me', cookie)).body);
  assert.equal(me.user.username, 'elena.cardio');
});

test('session cookie is HttpOnly and SameSite=Strict, and responses are not cached', async () => {
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'grace.rn', password: creds['grace.rn'].password } });
  const sc = String(a.headers['set-cookie']);
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  assert.equal(a.headers['cache-control'], 'no-store');
  assert.equal(a.headers['x-content-type-options'], 'nosniff');
});

test('wrong passwords are refused, audited, and lock the account after five tries', async () => {
  const u = 'rita.insurance';
  const before = await auditCount("action = 'sign-in' and outcome = 'denied' and actor = $1", [userId(u)]);
  for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: u, password: 'wrong' + i } })).statusCode, 401);
  const right = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: u, password: creds[u].password } });
  assert.equal(right.statusCode, 401, 'a locked account refuses even the right password');
  assert.equal(await auditCount("action = 'sign-in' and outcome = 'denied' and actor = $1", [userId(u)]), before + 6);
  await owner.query('update app.users set failed_logins = 0, locked_until = null where username = $1', [u]);
});

test('unknown users get the same answer as wrong passwords', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'nobody.here', password: 'x' } });
  const w = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'elena.cardio', password: 'x' } });
  assert.equal(r.statusCode, 401); assert.equal(r.body, w.body);
  await owner.query("update app.users set failed_logins = 0 where username = 'elena.cardio'");
});

test('state-changing requests without the X-Tessera header are refused (CSRF)', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { 'content-type': 'application/json' }, payload: { username: 'elena.cardio', password: creds['elena.cardio'].password } });
  assert.equal(r.statusCode, 403);
  const o = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...H, origin: 'https://evil.example' }, payload: { username: 'elena.cardio', password: creds['elena.cardio'].password } });
  assert.equal(o.statusCode, 403);
});

test('sessions lock after the idle timeout, and sign-out revokes them', async () => {
  const cookie = await login('samuel.gmed');
  assert.equal((await get('/api/me', cookie)).statusCode, 200);
  await owner.query(`update app.sessions set last_seen = now() - interval '${env.IDLE_MINUTES + 1} minutes' where user_id = $1 and revoked_at is null`, [userId('samuel.gmed')]);
  assert.equal((await get('/api/me', cookie)).statusCode, 401, 'idle session must lock');
  assert.equal((await get('/api/me', cookie)).statusCode, 401, 'and stay locked');
  const c2 = await login('samuel.gmed');
  assert.equal((await post('/api/auth/logout', c2)).statusCode, 200);
  assert.equal((await get('/api/me', c2)).statusCode, 401);
});

/* ---------------- least privilege: the access matrix ---------------- */
test('every role sees exactly the patients the care rules allow, in lists and charts', async () => {
  const rel = (await owner.query('select user_id, patient_id from app.care_relationships')).rows;
  const allPids = SEED.patients.map((p: any) => p.id);
  for (const u of SEED.users) {
    if (u.status === 'suspended') continue;
    const cookie = await login(u.username);
    const list = await get('/api/patients', cookie);
    let expected: string[];
    if (u.role === 'pharmacist') expected = allPids;
    else if (u.role === 'doctor' || u.role === 'nurse') expected = [...new Set(rel.filter((r) => r.user_id === u.id).map((r) => r.patient_id))];
    else if (u.role === 'patient') expected = [u.patientId];
    else { assert.equal(list.statusCode, 403, `${u.username} (${u.role}) must have no patient list`); expected = []; }
    if (list.statusCode === 200) { const got = JSON.parse(list.body).patients.map((p: any) => p.id).sort(); assert.deepEqual(got, [...expected].sort(), `list for ${u.username}: got ${got.join(' ')}, expected ${[...expected].sort().join(' ')}`); }
    // charts: probe every patient
    for (const pid of allPids) {
      const r = await get(`/api/patients/${pid}`, cookie);
      const ok = expected.includes(pid);
      assert.equal(r.statusCode, ok ? 200 : 403, `${u.username} (${u.role}) → ${pid}: got ${r.statusCode}`);
    }
    await post('/api/auth/logout', cookie);
  }
});

test('a pharmacist gets the medication profile only, not the whole chart', async () => {
  const cookie = await login('nadia.pharm');
  const p = JSON.parse((await get(`/api/patients/${SEED.patients[0].id}`, cookie)).body).patient;
  assert.ok(p.meds && p.allergies !== undefined);
  for (const k of ['problems', 'vitals', 'phone', 'memberId', 'payer', 'dob']) assert.equal(p[k], undefined, `pharmacist must not get ${k}`);
});

test('a patient sees only their own record, and gets their name from it', async () => {
  const me = SEED.users.find((u: any) => u.role === 'patient');
  const cookie = await login(me.username);
  const boot = JSON.parse((await get('/api/bootstrap', cookie)).body);
  assert.equal(boot.user.name, null);
  assert.deepEqual(boot.patients.map((p: any) => p.id), [me.patientId]);
  assert.equal(boot.patients[0].name, SEED.patients.find((p: any) => p.id === me.patientId).name);
  assert.equal((await get(`/api/patients/${me.patientId}`, cookie)).statusCode, 200);
  const other = SEED.patients.find((p: any) => p.id !== me.patientId).id;
  assert.equal((await get(`/api/patients/${other}`, cookie)).statusCode, 403);
});

test('row-level security holds even if the API forgot to check (direct queries as tessera_app)', async () => {
  const c = await appPool.connect();
  try {
    assert.equal((await c.query('select count(*) from app.patients')).rows[0].count, '0', 'no identity set → no rows');
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.role', 'doctor', true)", [userId('elena.cardio')]);
    const n = +(await c.query('select count(*) from app.patients')).rows[0].count;
    const care = +(await owner.query('select count(distinct patient_id) from app.care_relationships where user_id = $1', [userId('elena.cardio')])).rows[0].count;
    assert.equal(n, care);
    await c.query('rollback');
    await assert.rejects(c.query("update app.patients set unit = 'X'"), /permission denied/);
    await assert.rejects(c.query('delete from app.users'), /permission denied/);
    await assert.rejects(c.query('create table app.x (a int)'), /permission denied/);
  } finally { c.release(); }
});

/* ---------------- audit ---------------- */
test('every chart view writes exactly one audit row, with a token and no name', async () => {
  const cookie = await login('elena.cardio');
  const pid = (await owner.query('select patient_id from app.care_relationships where user_id = $1 limit 1', [userId('elena.cardio')])).rows[0].patient_id;
  const before = await auditCount("action = 'view-chart' and actor = $1", [userId('elena.cardio')]);
  for (let i = 0; i < 3; i++) assert.equal((await get(`/api/patients/${pid}`, cookie)).statusCode, 200);
  assert.equal(await auditCount("action = 'view-chart' and actor = $1", [userId('elena.cardio')]), before + 3);
  const row = (await owner.query("select * from audit.log where action = 'view-chart' and actor = $1 order by seq desc limit 1", [userId('elena.cardio')])).rows[0];
  const p = SEED.patients.find((x: any) => x.id === pid);
  assert.match(row.patient_token, /^PT-[0-9A-F]{6}$/);
  assert.equal(row.purpose, 'Treatment');
  assert.ok(!JSON.stringify(row).includes(p.name) && !JSON.stringify(row).includes(p.mrn), 'audit rows must not carry names or MRNs');
});

test('denied access is audited too', async () => {
  const cookie = await login('sofia.frontdesk');
  const before = await auditCount("action = 'chart-denied' and actor = $1", [userId('sofia.frontdesk')]);
  assert.equal((await get(`/api/patients/${SEED.patients[0].id}`, cookie)).statusCode, 403);
  assert.equal(await auditCount("action = 'chart-denied' and actor = $1", [userId('sofia.frontdesk')]), before + 1);
  const cookie2 = await login('grace.rn');
  const notMine = (await owner.query('select id from app.patients where id not in (select patient_id from app.care_relationships where user_id = $1) limit 1', [userId('grace.rn')])).rows[0].id;
  const b2 = await auditCount("action = 'chart-denied' and actor = $1 and outcome = 'denied'", [userId('grace.rn')]);
  assert.equal((await get(`/api/patients/${notMine}`, cookie2)).statusCode, 403);
  assert.equal(await auditCount("action = 'chart-denied' and actor = $1 and outcome = 'denied'", [userId('grace.rn')]), b2 + 1);
});

test('the audit log is append-only, even for its owner', async () => {
  const c = await appPool.connect();
  try {
    await assert.rejects(c.query('update audit.log set detail = $1', ['x']), /permission denied/);
    await assert.rejects(c.query('delete from audit.log'), /permission denied/);
    await assert.rejects(c.query('truncate audit.log'), /permission denied/);
  } finally { c.release(); }
  await assert.rejects(owner.query("update audit.log set detail = 'x' where seq = 1"), /append-only/);
  await assert.rejects(owner.query('delete from audit.log where seq = 1'), /append-only/);
  await assert.rejects(owner.query('truncate audit.log'), /append-only/);
});

test('the hash chain verifies, and detects tampering', async () => {
  const ok = (await owner.query('select * from audit.verify()')).rows[0];
  assert.equal(ok.ok, true); assert.ok(+ok.checked > 10);
  const c = await owner.connect();
  try {
    await c.query('begin'); // tamper inside a transaction, then roll back
    await c.query('alter table audit.log disable trigger audit_no_update');
    const seq = (await c.query('select seq from audit.log order by seq limit 1 offset 5')).rows[0].seq;
    await c.query("update audit.log set detail = 'edited' where seq = $1", [seq]);
    const r = (await c.query('select * from audit.verify()')).rows[0];
    assert.equal(r.ok, false); assert.equal(String(r.broken_at), String(seq));
    await c.query('rollback');
  } finally { c.release(); }
  assert.equal((await owner.query('select ok from audit.verify()')).rows[0].ok, true);
  const admin = await login('dana.admin');
  assert.equal(JSON.parse((await get('/api/audit/verify', admin)).body).ok, true);
  assert.equal((await get('/api/audit/verify', await login('elena.cardio'))).statusCode, 403);
});

/* ---------------- encryption at rest ---------------- */
test('no names, MRNs, birth dates, phones or member IDs exist in plaintext in the database', async () => {
  // Every text column (timestamps and hex hashes left out: six-digit MRNs can turn up in them by chance)
  const dump = (await owner.query(`select string_agg(t, E'\\n') as d from (
      select concat_ws('|', id, token, age, sex, dept, consults::text, unit, bed, status, code, attending) as t from app.patients
      union all select concat_ws('|', id, username, name, role, dept, unit, title, patient_id, status) from app.users
      union all select concat_ws('|', actor, role, action, resource, patient_token, purpose, outcome, detail, ip) from audit.log
      union all select concat_ws('|', user_id, patient_id, reason, justification) from app.btg_grants) x`)).rows[0].d;
  const raw = (await owner.query(`select string_agg(encode(name_enc || mrn_enc || dob_enc || clinical_enc, 'escape'), '') as d from app.patients`)).rows[0].d;
  for (const p of SEED.patients) for (const v of [p.name, p.mrn, p.dob, p.phone, p.memberId]) {
    if (!v || String(v).length < 5) continue;
    assert.ok(!dump.includes(String(v)), `plaintext ${String(v).slice(0, 3)}… found in a table`);
    assert.ok(!raw.includes(String(v)), `plaintext ${String(v).slice(0, 3)}… found in ciphertext`);
  }
  for (const p of SEED.patients) for (const a of p.allergies || []) { const s = typeof a === 'string' ? a : a.substance || a.name; if (s && s.length > 5) assert.ok(!raw.includes(s), 'allergy in plaintext'); }
});

/* ---------------- break the glass ---------------- */
test('break-the-glass: justified, time-limited, audited and reviewable', async () => {
  const doc = 'elena.cardio'; const cookie = await login(doc);
  const btgBefore = await auditCount("action = 'break-the-glass' and actor = $1 and patient_token <> ''", [userId(doc)]);
  const pid = (await owner.query('select id from app.patients where id not in (select patient_id from app.care_relationships where user_id = $1) limit 1', [userId(doc)])).rows[0].id;
  const denied = await get(`/api/patients/${pid}`, cookie);
  assert.equal(denied.statusCode, 403); assert.equal(JSON.parse(denied.body).btg, true);
  assert.equal((await post(`/api/patients/${pid}/btg`, cookie, { reason: 'Emergency', justification: 'too short' })).statusCode, 400);
  const g = await post(`/api/patients/${pid}/btg`, cookie, { reason: 'Emergency treatment', justification: 'Patient collapsed in corridor, need allergies and meds now' });
  assert.equal(g.statusCode, 200, g.body);
  const grant = JSON.parse(g.body);
  const hours = (new Date(grant.expires).getTime() - Date.now()) / 3600000;
  assert.ok(hours > env.BTG_HOURS - 0.1 && hours <= env.BTG_HOURS, 'grant lasts BTG_HOURS');
  const chart = await get(`/api/patients/${pid}`, cookie);
  assert.equal(chart.statusCode, 200); assert.equal(JSON.parse(chart.body).access, 'btg');
  const row = (await owner.query("select * from audit.log where action = 'view-chart' and actor = $1 order by seq desc limit 1", [userId(doc)])).rows[0];
  assert.equal(row.purpose, 'Emergency (break-the-glass)');
  assert.equal(await auditCount("action = 'break-the-glass' and actor = $1 and patient_token <> ''", [userId(doc)]), btgBefore + 1);
  // expiry: once the grant lapses the chart closes again
  await owner.query("update app.btg_grants set expires_at = now() - interval '1 second' where id = $1", [grant.grant]);
  assert.equal((await get(`/api/patients/${pid}`, cookie)).statusCode, 403);
  // roles that may not break the glass
  assert.equal((await post(`/api/patients/${pid}/btg`, await login('sofia.frontdesk'), { reason: 'x', justification: 'a long enough justification text' })).statusCode, 403);
  assert.equal((await post(`/api/patients/${pid}/btg`, await login('nadia.pharm'), { reason: 'x', justification: 'a long enough justification text' })).statusCode, 403);
  // review by an administrator, once
  const admin = await login('dana.admin');
  const list = JSON.parse((await get('/api/btg', admin)).body).grants;
  assert.ok(list.some((x: any) => +x.id === +grant.grant));
  assert.equal((await get('/api/btg', cookie)).statusCode, 403, 'clinicians cannot review grants');
  assert.equal((await post(`/api/btg/${grant.grant}/review`, admin, { outcome: 'appropriate' })).statusCode, 200);
  assert.equal((await post(`/api/btg/${grant.grant}/review`, admin, { outcome: 'inappropriate' })).statusCode, 409, 'a review cannot be rewritten');
});

test('reading the audit log is itself audited, and limited to admin and quality', async () => {
  const q = await login('tomas.quality');
  const before = await auditCount("action = 'view-audit' and actor = $1", [userId('tomas.quality')]);
  assert.equal((await get('/api/audit?limit=5', q)).statusCode, 200);
  assert.equal(await auditCount("action = 'view-audit' and actor = $1", [userId('tomas.quality')]), before + 1);
  for (const u of ['elena.cardio', 'marcus.billing', 'catherine.ceo']) assert.equal((await get('/api/audit', await login(u))).statusCode, 403, u);
});

/* ---------------- census and search (what the app's live mode runs on) ---------------- */
test('the census holds only permitted records, projected for pharmacists, with one audit row per patient', async () => {
  const doc = 'elena.cardio'; const cookie = await login(doc);
  const care = (await owner.query('select distinct patient_id from app.care_relationships where user_id = $1', [userId(doc)])).rows.map((r) => r.patient_id).sort();
  const before = await auditCount("action = 'census' and actor = $1", [userId(doc)]);
  const boot = JSON.parse((await get('/api/bootstrap', cookie)).body);
  assert.deepEqual(boot.patients.map((p: any) => p.id).sort(), care);
  assert.ok(boot.patients.every((p: any) => p._access === 'care' && Array.isArray(p.problems)));
  assert.equal(await auditCount("action = 'census' and actor = $1", [userId(doc)]), before + care.length);
  const ph = JSON.parse((await get('/api/bootstrap', await login('nadia.pharm'))).body);
  assert.equal(ph.patients.length, SEED.patients.length);
  assert.ok(ph.patients.every((p: any) => p.problems === undefined && p.phone === undefined && p.vitals === undefined));
  const billing = JSON.parse((await get('/api/bootstrap', await login('marcus.billing'))).body);
  assert.deepEqual(billing.patients, []);
});

test('hospital-wide search matches exact MRN or full name by blind index and reveals no identity', async () => {
  const doc = 'elena.cardio'; const cookie = await login(doc);
  const outside = (await owner.query('select id from app.patients where id not in (select patient_id from app.care_relationships where user_id = $1) limit 1', [userId(doc)])).rows[0].id;
  const p = SEED.patients.find((x: any) => x.id === outside);
  for (const q of [p.mrn, p.name, p.name.toUpperCase()]) {
    const r = JSON.parse((await get(`/api/search?q=${encodeURIComponent(q)}`, cookie)).body);
    assert.deepEqual(r.matches.map((m: any) => m.id), [outside], `search ${q.slice(0, 2)}…`);
    assert.ok(!JSON.stringify(r).includes(p.name) && !JSON.stringify(r).includes(p.mrn));
  }
  assert.deepEqual(JSON.parse((await get(`/api/search?q=${encodeURIComponent(p.name.slice(0, 4))}`, cookie)).body).matches, [], 'partial names do not match');
  assert.equal((await get('/api/search?q=100241', await login('marcus.billing'))).statusCode, 403);
});
