/* Phase 5 hardening: single-use authenticator codes, rate limits, sign-in through an identity provider
   (against a local mock OpenID Connect provider), signed write-once audit checkpoints, master key
   rotation, readiness, metrics and logs without health data. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, createSign, createHash, randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { env } from '../src/env.ts';
import { build } from '../src/server.ts';
import { appPool } from '../src/db.ts';
import { totp, LocalKms, kms } from '../src/crypto.ts';
import { resetLimits } from '../src/ratelimit.ts';
import { LocalWorm, writeCheckpoint, verifyCheckpoints } from '../src/worm.ts';
import { rotate } from '../src/rotate-kek.ts';
import { clearOidcCache } from '../src/oidc.ts';

process.env.TESSERA_QUIET = '1';
env.ALLOW_TOTP_REUSE = false; env.RATE_LIMITS = true;
const root = new URL('..', import.meta.url).pathname;
let creds: any = {};
const app = build();
const owner = new pg.Pool({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD, max: 2 });
const H = { 'x-tessera': '1', 'content-type': 'application/json' };
const ck = (r: any) => { const c = r.cookies.find((x: any) => x.name === 'tessera_sid'); return c ? `tessera_sid=${c.value}` : ''; };
const pw = (u: string, ip = '10.0.0.1') => app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: u, password: creds[u].password }, remoteAddress: ip });
const audits = async (action: string, outcome: string) => +(await owner.query('select count(*) from audit.log where action = $1 and outcome = $2', [action, outcome])).rows[0].count;

before(async () => { execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8')); await app.ready(); });
after(async () => { env.OIDC_ISSUER = ''; await app.close(); await appPool.end(); await owner.end(); idp.close(); execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); });

/* ---------------- authenticator codes work once ---------------- */
test('an authenticator code cannot be used twice', async () => {
  resetLimits();
  const code = totp(creds['elena.cardio'].totpSecret);
  const a = await pw('elena.cardio');
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(a) }, payload: { code } })).statusCode, 200);
  const b = await pw('elena.cardio');
  const again = await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(b) }, payload: { code } });
  assert.equal(again.statusCode, 401); assert.match(again.body, /already used/);
  assert.ok(await audits('sign-in', 'denied') > 0);
  const older = totp(creds['elena.cardio'].totpSecret, Date.now() - 30000);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(b) }, payload: { code: older } })).statusCode, 401, 'an older code was accepted');
  await owner.query("update app.users set failed_logins = 0, locked_until = null");
});

/* ---------------- rate limits ---------------- */
test('sign-in is rate limited per address, audited once, and other addresses are unaffected', async () => {
  resetLimits();
  const before = await audits('rate-limited', 'denied');
  const codes: number[] = [];
  for (let i = 0; i < 14; i++) codes.push((await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'nobody', password: 'x' }, remoteAddress: '10.9.9.9' })).statusCode);
  assert.ok(codes.slice(0, 10).every((c) => c === 401) && codes.slice(10).every((c) => c === 429), codes.join(','));
  const r = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'nobody', password: 'x' }, remoteAddress: '10.9.9.9' });
  assert.ok(Number(r.headers['retry-after']) > 0);
  assert.equal(await audits('rate-limited', 'denied'), before + 1, 'flood should be audited once a minute, not per request');
  assert.equal((await pw('grace.rn', '10.1.1.1')).statusCode, 200, 'another address was blocked');
  resetLimits();
});

/* ---------------- identity provider ---------------- */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const mock: any = { claims: {}, signWith: privateKey, codes: new Map() };
let issuer = '';
const jwt = (claims: any, key: any) => { const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url'); const p = Buffer.from(JSON.stringify(claims)).toString('base64url'); return `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url')}`; };
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url!, issuer);
  const json = (o: any, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/openid-configuration') return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
  if (u.pathname === '/jwks') return json({ keys: [jwk] });
  if (u.pathname === '/authorize') { // the "user" signs in at the provider; the test picks who via login_hint
    const code = randomBytes(8).toString('hex');
    mock.codes.set(code, { nonce: u.searchParams.get('nonce'), challenge: u.searchParams.get('code_challenge'), user: u.searchParams.get('login_hint'), client: u.searchParams.get('client_id') });
    res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` }); return res.end();
  }
  if (u.pathname === '/token') {
    let body = ''; for await (const ch of req) body += ch; const f = new URLSearchParams(body);
    const c = mock.codes.get(f.get('code')); mock.codes.delete(f.get('code'));
    if (!c) return json({ error: 'invalid_grant' }, 400);
    if (createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE' }, 400);
    if (req.headers.authorization !== 'Basic ' + Buffer.from('tessera-app:s3cret').toString('base64')) return json({ error: 'invalid_client' }, 401);
    const now = Math.floor(Date.now() / 1000);
    return json({ id_token: jwt({ iss: issuer, aud: c.client, sub: 'sub-' + c.user, preferred_username: c.user, nonce: c.nonce, iat: now, exp: now + 300, amr: ['pwd', 'mfa'], ...mock.claims }, mock.signWith), token_type: 'Bearer' });
  }
  res.writeHead(404); res.end();
});
await new Promise<void>((r) => idp.listen(0, '127.0.0.1', () => r()));
issuer = `http://127.0.0.1:${(idp.address() as any).port}`;

async function oidcSignIn(user: string) {
  resetLimits(); // this test makes more sign-in requests from one address than the limit allows
  const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' });
  assert.equal(start.statusCode, 302, start.body);
  const loc = new URL(String(start.headers.location)); loc.searchParams.set('login_hint', user);
  const atIdp = await fetch(loc, { redirect: 'manual' });
  const cb = new URL(atIdp.headers.get('location')!);
  const r = await app.inject({ method: 'GET', url: cb.pathname + cb.search });
  return { r, cb };
}
test('sign-in through the identity provider: PKCE, state, nonce, signature, MFA and the account all checked', async () => {
  resetLimits(); clearOidcCache();
  Object.assign(env, { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'tessera-app', OIDC_CLIENT_SECRET: 's3cret', OIDC_REDIRECT: 'http://localhost:8787/api/auth/oidc/callback' });
  assert.deepEqual(JSON.parse((await app.inject({ method: 'GET', url: '/api/auth/config' })).body).oidc, true);
  assert.equal((await pw('elena.cardio')).statusCode, 403, 'password sign-in still open with an identity provider');
  const ok = await oidcSignIn('elena.cardio');
  assert.equal(ok.r.statusCode, 302); assert.match(String(ok.r.headers.location), /#home$/);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: ck(ok.r) } });
  assert.equal(JSON.parse(me.body).user.username, 'elena.cardio');
  assert.match((await owner.query("select detail from audit.log where action = 'sign-in' and outcome = 'success' order by seq desc limit 1")).rows[0].detail, /identity provider .* amr pwd,mfa/);
  // the same callback again (state replay)
  const replay = await app.inject({ method: 'GET', url: ok.cb.pathname + ok.cb.search });
  assert.match(String(replay.headers.location), /signin_error=denied/);
  const cases: [string, any, string, RegExp][] = [
    ['no MFA', { amr: ['pwd'] }, 'elena.cardio', /multi-factor/],
    ['wrong nonce', { nonce: 'x' }, 'elena.cardio', /nonce/],
    ['wrong audience', { aud: 'someone-else' }, 'elena.cardio', /another application/],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }, 'elena.cardio', /expired/],
    ['unknown user', {}, 'mallory', /no Tessera account/],
    ['suspended account', {}, 'ruth.peds', /suspended/],
  ];
  for (const [label, claims, user, why] of cases) {
    mock.claims = claims;
    const { r } = await oidcSignIn(user);
    assert.match(String(r.headers.location), /signin_error=denied/, label);
    assert.match((await owner.query("select detail from audit.log where action = 'sign-in' and outcome = 'denied' order by seq desc limit 1")).rows[0].detail, why, label);
  }
  mock.claims = {}; mock.signWith = other.privateKey;
  assert.match(String((await oidcSignIn('elena.cardio')).r.headers.location), /signin_error=denied/, 'forged signature accepted');
  mock.signWith = privateKey;
  env.OIDC_ISSUER = '';
});

/* ---------------- write-once audit checkpoints ---------------- */
test('signed write-once checkpoints catch a rebuilt audit chain that the chain check alone misses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-worm-')); const store = new LocalWorm(dir); const key = randomBytes(32);
  const cp = await writeCheckpoint(owner, store, key);
  assert.ok(cp && cp.seq > 0);
  const f = join(dir, (await store.list())[0]);
  assert.equal(statSync(f).mode & 0o222, 0, 'checkpoint is writable');
  await assert.rejects(store.put((await store.list())[0], '{}'), /EEXIST/, 'checkpoint overwritten');
  assert.equal((await verifyCheckpoints(owner, store, key)).ok, true);
  // attack: someone with schema rights edits a row and recomputes every later hash
  const c = await owner.connect();
  try {
    await c.query('begin');
    await c.query('alter table audit.log disable trigger audit_no_update');
    const first = (await c.query('select min(seq) as s from audit.log')).rows[0].s;
    await c.query("update audit.log set detail = 'rewritten' where seq = $1", [first]);
    await c.query(`do $$ declare r audit.log; p text := repeat('0', 64); begin
      for r in select * from audit.log order by seq loop r.prev_hash := p; r.hash := audit.row_digest(r); update audit.log set prev_hash = r.prev_hash, hash = r.hash where seq = r.seq; p := r.hash; end loop; end $$`);
    assert.equal((await c.query('select ok from audit.verify()')).rows[0].ok, true, 'the rebuilt chain fools the chain check');
    const v = await verifyCheckpoints(c, store, key);
    assert.equal(v.ok, false); assert.match(v.problems.join(' '), /chain was rebuilt/);
    await c.query('rollback');
  } finally { c.release(); }
  // a forged checkpoint (wrong key) is noticed
  const forged = { seq: 999999999, hash: 'x', count: 1, at: new Date().toISOString(), prev: (await verifyCheckpoints(owner, store, key)).ok ? JSON.parse(await store.get((await store.list())[0])).sig : '', sig: 'f'.repeat(64) };
  writeFileSync(join(dir, 'checkpoint-999999999999.json'), JSON.stringify(forged));
  const v2 = await verifyCheckpoints(owner, store, key);
  assert.match(v2.problems.join(' '), /signature invalid/);
});

/* ---------------- master key rotation ---------------- */
test('master key rotation re-wraps every key without touching health data', async () => {
  const before = (await owner.query("select string_agg(encode(name_enc, 'hex'), '') as d from app.patients")).rows[0].d;
  const next = new LocalKms(randomBytes(32).toString('hex')), cur = new LocalKms(env.KEK_HEX);
  const n = await rotate(owner, cur, next);
  assert.ok(n >= 23 + 1 + 20);
  const w = (await owner.query("select dek_wrapped from app.patients where id = 'P01'")).rows[0].dek_wrapped;
  assert.throws(() => cur.unwrap(w), 'old key still opens the data key'); next.unwrap(w);
  assert.equal((await owner.query("select string_agg(encode(name_enc, 'hex'), '') as d from app.patients")).rows[0].d, before, 'ciphertext of health data changed');
  await rotate(owner, next, cur); // put the development key back
  kms.unwrap((await owner.query("select dek_wrapped from app.patients where id = 'P01'")).rows[0].dek_wrapped);
});

/* ---------------- readiness, metrics, logs ---------------- */
test('readiness checks the database, keys and audit; metrics and logs carry no health data', async () => {
  resetLimits();
  const r = JSON.parse((await app.inject({ method: 'GET', url: '/api/ready' })).body);
  assert.deepEqual(r, { ok: true, checks: { database: true, keys: true, audit: true } });
  env.ALLOW_TOTP_REUSE = true;
  const sign = async (u: string) => { const a = await pw(u, '10.2.2.2'); const b = await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(a) }, payload: { code: totp(creds[u].totpSecret) }, remoteAddress: '10.2.2.2' }); return ck(b); };
  const doc = await sign('samuel.gmed'), adm = await sign('dana.admin');
  const lines: string[] = []; const w = process.stdout.write.bind(process.stdout); delete process.env.TESSERA_QUIET;
  (process.stdout as any).write = (s: any) => { lines.push(String(s)); return true; };
  try { await app.inject({ method: 'GET', url: '/api/patients/P03', headers: { cookie: doc } }); await app.inject({ method: 'GET', url: '/fhir/r4/Observation?patient=P03', headers: { cookie: doc } }); }
  finally { (process.stdout as any).write = w; process.env.TESSERA_QUIET = '1'; }
  const log = lines.join('');
  assert.ok(/"route":"\/api\/patients\/:id"/.test(log), 'request not logged by route template');
  assert.ok(!/P03|100587|Deshmukh|patient=/.test(log), 'log carries an id or health data');
  assert.equal((await app.inject({ method: 'GET', url: '/api/metrics', headers: { cookie: doc } })).statusCode, 403);
  const mr = await app.inject({ method: 'GET', url: '/api/metrics', headers: { cookie: adm } }); const m = mr.body;
  assert.equal(mr.statusCode, 200, m);
  assert.match(m, /tessera_http_requests_total\{route="\/api\/patients\/:id",status="200"\} \d+/);
  assert.ok(!/P0\d|PT-/.test(m), 'metrics carry ids');
  env.ALLOW_TOTP_REUSE = false;
});
