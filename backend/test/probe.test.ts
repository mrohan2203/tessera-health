/* Phase 5: automated security probe. Walks every route the API registers and tries what an attacker
   would: no session, a forged or stale session, missing CSRF header, a hostile origin, other people's
   records (IDOR), injection in every parameter, oversized bodies, and error messages that leak
   internals. Complements the rule tests; it is not a substitute for an independent penetration test. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { env } from '../src/env.ts';
import { build } from '../src/server.ts';
import { appPool } from '../src/db.ts';
import { totp } from '../src/crypto.ts';

process.env.TESSERA_QUIET = '1'; env.ALLOW_TOTP_REUSE = true; env.RATE_LIMITS = false;
const root = new URL('..', import.meta.url).pathname;
let creds: any = {};
const app = build();
const H = { 'x-tessera': '1', 'content-type': 'application/json' };
const ck = (r: any) => { const c = r.cookies.find((x: any) => x.name === 'tessera_sid'); return c ? `tessera_sid=${c.value}` : ''; };
async function as(u: string) {
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: u, password: creds[u].password } });
  const b = await app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { ...H, cookie: ck(a) }, payload: { code: totp(creds[u].totpSecret) } });
  return ck(b);
}
const PUBLIC = new Set(['GET /api/health', 'GET /api/ready', 'GET /fhir/r4/metadata', 'GET /api/auth/config', 'GET /api/auth/oidc/start', 'GET /api/auth/oidc/callback', 'POST /api/auth/password', 'POST /api/auth/mfa', 'POST /api/auth/logout']);
const fill = (url: string) => url.replace(/:id/g, 'P01').replace(/:type/g, 'Patient');
const LEAK = /stack|at [A-Za-z]+ \(|node_modules|syntax error|pg_|relation "|column "|SELECT |TypeError|ReferenceError/i;

before(async () => { execSync('npm run -s seed', { cwd: root, stdio: 'ignore' }); creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8')); await app.ready(); });
after(async () => { await app.close(); await appPool.end(); });

test('every non-public route refuses a request with no session, a forged session, or a stale one', async () => {
  const routes: string[] = (app as any).routesList.filter((r: string) => !/HEAD|OPTIONS/.test(r.split(' ')[0]));
  assert.ok(routes.length >= 30, `only ${routes.length} routes found`);
  const stale = await as('grace.rn'); assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...H, cookie: stale }, payload: {} })).statusCode, 200);
  const tried: string[] = [];
  for (const r of routes) {
    const [method, url] = r.split(' ');
    if (PUBLIC.has(`${method} ${url}`)) continue;
    for (const cookie of ['', 'tessera_sid=forged-token-value', stale]) {
      const res = await app.inject({ method: method as any, url: fill(url) + (url.includes('changes') ? '?since=2020-01-01T00:00:00Z' : url === '/fhir/r4/:type' ? '?patient=P01' : ''), headers: { ...H, cookie }, payload: method === 'GET' ? undefined : {} });
      assert.ok([401, 403].includes(res.statusCode), `${method} ${url} with ${cookie === stale ? 'a signed-out' : cookie ? 'a forged' : 'no'} session → ${res.statusCode}`);
      assert.ok(!/Malhotra|100241/.test(res.body), `${method} ${url} leaked data`);
    }
    tried.push(r);
  }
  assert.equal(tried.length, routes.length - PUBLIC.size, 'a route was skipped'); // 21 protected routes today
});

test('writes need the CSRF header and the app origin', async () => {
  const c = await as('elena.cardio');
  for (const url of ['/api/records', '/api/patients/P01/btg', '/api/auth/logout', '/api/fhir/authorize']) {
    assert.equal((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', cookie: c }, payload: {} })).statusCode, 403, `${url} without X-Tessera`);
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...H, cookie: c, origin: 'https://evil.example' }, payload: {} })).statusCode, 403, `${url} from another origin`);
  }
  const pre = await app.inject({ method: 'OPTIONS', url: '/api/records', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.notEqual(pre.headers['access-control-allow-origin'], 'https://evil.example');
  assert.equal(pre.headers['access-control-allow-credentials'], undefined);
});

test("one user cannot reach another's records by changing ids (IDOR)", async () => {
  const pt = await as('radha.patient');
  for (const url of ['/api/patients/P01', '/fhir/r4/Patient/P01', '/fhir/r4/Observation?patient=P01', '/fhir/r4/DocumentReference?patient=P01']) {
    const r = await app.inject({ method: 'GET', url, headers: { cookie: pt } });
    assert.ok(r.statusCode === 403 || (r.statusCode === 200 && JSON.parse(r.body).total === 0), `${url} → ${r.statusCode}`);
    assert.ok(!/Malhotra|Penicillin|100241/.test(r.body), `${url} leaked`);
  }
  const w = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: pt }, payload: { writes: [{ coll: 'notes', key: 'N-X', patient: 'P01', version: 0, body: { id: 'N-X', patient: 'P01' } }] } });
  assert.equal(JSON.parse(w.body).results[0].ok, false);
  const nurse = await as('grace.rn');
  const todo = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: nurse }, payload: { writes: [{ coll: 'todos', key: 'U-2001', patient: '', version: 0, body: [] }] } });
  assert.equal(JSON.parse(todo.body).results[0].status, 403, "wrote another user's list");
});

test('injection and malformed input are refused without leaking internals', async () => {
  const c = await as('elena.cardio');
  const evil = ["' or 1=1 --", "P01'; drop table app.patients; --", '../../etc/passwd', '%00', '<script>alert(1)</script>', '{"$gt":""}', 'P01) union select * from app.users --'];
  for (const x of evil) {
    for (const url of [`/api/patients/${encodeURIComponent(x)}`, `/api/search?q=${encodeURIComponent(x)}`, `/fhir/r4/Observation?patient=${encodeURIComponent(x)}`, `/fhir/r4/Patient?identifier=${encodeURIComponent(x)}`, `/api/changes?since=${encodeURIComponent(x)}`, `/api/audit?limit=${encodeURIComponent(x)}`]) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie: c } });
      assert.ok(r.statusCode < 500, `${url} → ${r.statusCode}`);
      assert.ok(!LEAK.test(r.body), `${url} leaked internals: ${r.body.slice(0, 120)}`);
    }
    const w = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: c }, payload: { writes: [{ coll: x, key: x, patient: x, version: x, body: x }] } });
    assert.ok(w.statusCode < 500 && !LEAK.test(w.body), `records write with ${x} → ${w.statusCode} ${w.body.slice(0, 120)}`);
  }
  assert.ok((await app.inject({ method: 'GET', url: '/api/patients/P01', headers: { cookie: c } })).statusCode === 200, 'tables survived');
  const big = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: c }, payload: { writes: [{ coll: 'notes', key: 'N', patient: 'P01', version: 0, body: 'x'.repeat(600 * 1024) }] } });
  assert.equal(big.statusCode, 413, 'oversized body accepted');
  const bad = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: c }, body: '{not json', });
  assert.ok(bad.statusCode === 400 && !LEAK.test(bad.body));
  const many = await app.inject({ method: 'POST', url: '/api/records', headers: { ...H, cookie: c }, payload: { writes: Array.from({ length: 51 }, () => ({})) } });
  assert.equal(many.statusCode, 400);
});

test('every response carries the security headers; cookies are locked down', async () => {
  for (const url of ['/api/health', '/api/patients/P01', '/fhir/r4/metadata', '/api/nope']) {
    const r = await app.inject({ method: 'GET', url });
    assert.equal(r.headers['cache-control'], 'no-store', url); assert.equal(r.headers['x-content-type-options'], 'nosniff', url);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', url); assert.match(String(r.headers['content-security-policy']), /default-src 'none'.*frame-ancestors 'none'/, url);
  }
  const a = await app.inject({ method: 'POST', url: '/api/auth/password', headers: H, payload: { username: 'elena.cardio', password: creds['elena.cardio'].password } });
  const sc = String(a.headers['set-cookie']);
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/api/);
  const nf = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
  assert.equal(nf.statusCode, 404); assert.ok(!LEAK.test(nf.body));
});
