/* Phase 5: load test against a running API (npm run dev, with RATE_LIMITS=0 and ALLOW_TOTP_REUSE=1 for
   local runs). Virtual users across clinical and front-office roles sign in, then for DURATION seconds
   open charts, read the census and the changes feed, and write vitals and notes. Reports throughput and
   latency per kind of request, errors, and whether the audit chain is still intact afterwards.
   Usage: npm run loadtest -- [users=40] [seconds=30] */
import { readFileSync } from 'node:fs';
import { totp } from '../src/crypto.ts';
import { appPool } from '../src/db.ts';

const BASE = process.env.API || 'http://localhost:8787';
const USERS = +(process.argv[2] || 40), SECS = +(process.argv[3] || 30);
const creds = JSON.parse(readFileSync(new URL('../.dev-credentials.json', import.meta.url), 'utf8'));
const pool = ['elena.cardio', 'samuel.gmed', 'grace.rn', 'farid.er', 'caroline.surgery', 'jamal.periop', 'nadia.pharm', 'sofia.frontdesk', 'ben.lab'];
const lat: Record<string, number[]> = {}; let errors = 0, refused = 0; const codes: Record<string, number> = {};
async function call(kind: string, cookie: string, method: string, path: string, body?: any) {
  const t = performance.now();
  const r = await fetch(BASE + path, { method, headers: { cookie, ...(method !== 'GET' ? { 'x-tessera': '1', 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t; (lat[kind] ||= []).push(ms); codes[r.status] = (codes[r.status] || 0) + 1;
  if (r.status >= 500) errors++;
  return r;
}
async function signIn(u: string) {
  const a = await fetch(BASE + '/api/auth/password', { method: 'POST', headers: { 'x-tessera': '1', 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: creds[u].password }) });
  const c1 = (a.headers.get('set-cookie') || '').split(';')[0];
  const b = await fetch(BASE + '/api/auth/mfa', { method: 'POST', headers: { 'x-tessera': '1', 'content-type': 'application/json', cookie: c1 }, body: JSON.stringify({ code: totp(creds[u].totpSecret) }) });
  if (b.status !== 200) throw new Error(`sign-in ${u}: ${b.status} ${await b.text()}`);
  return (b.headers.get('set-cookie') || '').split(';')[0];
}
async function vu(i: number, until: number) {
  const u = pool[i % pool.length]; const cookie = await signIn(u);
  const boot = await (await call('bootstrap', cookie, 'GET', '/api/bootstrap')).json();
  const pids: string[] = (boot.patients || []).map((p: any) => p.id); let since = boot.now; const versions = boot.versions || {};
  let n = 0;
  while (performance.now() < until) {
    const pid = pids[n++ % Math.max(1, pids.length)];
    const roll = Math.random();
    if (['doctor', 'nurse', 'pharmacist'].includes(boot.user.role) && pid && roll < 0.35) await call('chart', cookie, 'GET', `/api/patients/${pid}`);
    else if (roll < 0.55) { const r = await (await call('changes', cookie, 'GET', `/api/changes?since=${encodeURIComponent(since)}`)).json(); since = r.now || since; Object.assign(versions, r.versions || {}); }
    else if (roll < 0.62) await call('bootstrap', cookie, 'GET', '/api/bootstrap');
    else if (boot.user.role === 'nurse' && pid && roll < 0.8) {
      const key = `vitalsLog|${pid}`; const cur = (await (await call('chart', cookie, 'GET', `/api/patients/${pid}`)).json());
      const log = (cur.records && cur.records.vitalsLog[pid]) || []; const v = cur.versions ? cur.versions[key] || 0 : 0;
      const r = await (await call('write', cookie, 'POST', '/api/records', { writes: [{ coll: 'vitalsLog', key: pid, patient: pid, version: v, body: [...log, { at: Date.now(), hr: 70 + (n % 30), rr: 16, spo2: 97, sbp: 120, dbp: 78, temp: 98.4, by: 'load test' }] }] })).json();
      if (!r.results[0].ok) refused++;
    } else if (boot.user.role === 'doctor' && pid && roll < 0.8) {
      const id = `N-LT-${i}-${n}`;
      const r = await (await call('write', cookie, 'POST', '/api/records', { writes: [{ coll: 'notes', key: id, patient: pid, version: 0, body: { id, patient: pid, author: boot.user.name, kind: 'Progress note', at: new Date().toISOString(), signed: true, text: 'Load test note', addenda: [] } }] })).json();
      if (!r.results[0].ok) refused++;
    } else await call('me', cookie, 'GET', '/api/me');
  }
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const t0 = performance.now(); const until = t0 + SECS * 1000;
await Promise.all(Array.from({ length: USERS }, (_, i) => vu(i, until).catch((e) => { errors++; console.error(String(e).slice(0, 200)); })));
const secs = (performance.now() - t0) / 1000; const all = Object.values(lat).flat();
console.log(`${USERS} users · ${secs.toFixed(1)} s · ${all.length} requests · ${(all.length / secs).toFixed(0)} req/s · ${errors} server errors · ${refused} writes refused (version conflicts between users are expected)`);
console.log('status codes', JSON.stringify(codes));
for (const [k, xs] of Object.entries(lat)) console.log(`${k.padEnd(10)} n=${String(xs.length).padStart(5)}  p50 ${pct(xs, 50).toFixed(0).padStart(4)} ms  p95 ${pct(xs, 95).toFixed(0).padStart(4)} ms  p99 ${pct(xs, 99).toFixed(0).padStart(4)} ms`);
const chain = (await appPool.query('select * from audit.verify()')).rows[0];
console.log(`audit chain after load: ${chain.ok ? 'intact' : 'BROKEN at ' + chain.broken_at} (${chain.checked} rows)`);
await appPool.end();
process.exit(errors || !chain.ok ? 1 : 0);
