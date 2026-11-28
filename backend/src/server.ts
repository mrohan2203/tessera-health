/* Tessera API, Phase 2: the security core.
   Sign-in is two steps (password, then a 6-digit authenticator code). The session is an HttpOnly,
   SameSite=Strict cookie whose token is stored only as a peppered hash; it locks after IDLE_MINUTES
   without a request and expires after 12 hours. Every route that touches health data authenticates,
   authorises (role + care relationship, deny by default, then row-level security in Postgres) and
   writes its audit row in the same transaction. State-changing requests must carry X-Tessera: 1
   (with SameSite=Strict this blocks cross-site request forgery).
   Development identity: local users with passwords and TOTP. Production: the OIDC provider (Okta or
   Entra ID) issues identity and MFA; the session and every rule below stay the same. */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { appPool, withAudit, auditOnly, type Actor } from './db.ts';
import { kms, sealWithKek, decText, decJson, openWithKek, blindIndex, verifyPassword, totpStep, newSessionToken, sessionHash } from './crypto.ts';
import { take } from './ratelimit.ts';
import { LocalWorm, writeCheckpoint, verifyCheckpoints } from './worm.ts';
export const auditKey = () => (env.AUDIT_SIGNING_KEY_HEX ? Buffer.from(env.AUDIT_SIGNING_KEY_HEX, 'hex') : null);
export const worm = () => new LocalWorm(env.WORM_DIR);
import { pkce, randomState, authorizeUrl, exchange, verifyIdToken } from './oidc.ts';
import { metrics, logLine } from './observe.ts';
import { env } from './env.ts';
import { COLLS, ARRAY_COLLS, readable, check, RuleError, type Coll } from './records.ts';
import { encField, newDek, patientToken } from './crypto.ts';
import { POLICY, ORG_ROLES, project, projectItem } from './policy.ts';
import { relationsFor } from './care.ts';
import { FHIR_TYPES, capability, patient, resourcesFor, bundle, outcome, allows } from './fhir.ts';
import { analyse } from './sentinel.ts';
import { readFileSync } from 'node:fs';
const UNIT_GROUPS: Record<string, string[]> = JSON.parse(readFileSync(new URL('../seed/initial-state.json', import.meta.url), 'utf8')).unitGroups || {};

const COOKIE = 'tessera_sid';
const PURPOSE: Record<string, string> = { doctor: 'Treatment', nurse: 'Treatment', pharmacist: 'Treatment', patient: 'Individual access', admin: 'Operations', quality: 'Operations' };
const CHART_ROLES = new Set(['doctor', 'nurse', 'pharmacist']);
const BTG_ROLES = new Set(['doctor', 'nurse']);
const AUDIT_ROLES = new Set(['admin', 'quality']);

export function build() {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 512 * 1024 });
  app.register(cookie);
  const routes: string[] = []; app.addHook('onRoute', (r) => { routes.push(`${Array.isArray(r.method) ? r.method.join(',') : r.method} ${r.url}`); }); (app as any).routesList = routes;

  /* Rate limits (Phase 5): sign-in per address, the API per session or address, FHIR per token. */
  app.addHook('onRequest', async (req: any, reply) => {
    (req as any)._t0 = process.hrtime.bigint();
    if (!env.RATE_LIMITS || req.url === '/api/health' || req.url === '/api/ready') return;
    const kind = req.url.startsWith('/api/auth/') ? 'auth' : req.url.startsWith('/fhir/') ? 'fhir' : 'api';
    const who = kind === 'fhir' && req.headers.authorization ? 'tok:' + sessionHash(String(req.headers.authorization)).toString('hex').slice(0, 16) : kind === 'api' && req.cookies?.tessera_sid ? 'sid:' + sessionHash(req.cookies.tessera_sid).toString('hex').slice(0, 16) : 'ip:' + req.ip;
    const r = take(kind, who);
    if (!r.ok) {
      metrics.inc('rate_limited_total', { kind });
      if (r.auditNow) await auditOnly(null, req.ip, { action: 'rate-limited', outcome: 'denied', detail: `${kind} limit for ${who.slice(0, 4)}…` });
      return reply.code(429).header('Retry-After', String(r.retryAfter)).send({ error: 'Too many requests. Try again shortly.' });
    }
  });
  /* One structured log line per request: route template, status, time, role. Never an id, a query
     string or a body, so no health data reaches the logs. */
  app.addHook('onResponse', async (req: any, reply) => {
    const ms = Number(process.hrtime.bigint() - ((req as any)._t0 || process.hrtime.bigint())) / 1e6;
    const route = req.routeOptions?.url || 'unmatched';
    metrics.inc('http_requests_total', { route, status: String(reply.statusCode) }); metrics.observe('http_request_ms', ms, { route });
    logLine({ msg: 'request', method: req.method, route, status: reply.statusCode, ms: Math.round(ms * 10) / 10 });
  });

  // Security headers, CORS for the app origin only, CSRF header on writes
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'").header('Cross-Origin-Resource-Policy', 'same-site');
    if (env.PRODUCTION) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.headers.origin;
    if (req.url.startsWith('/fhir/')) { // token API for outside apps: any origin, no cookies across sites, read-only
      reply.header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Headers', 'Authorization').header('Access-Control-Allow-Methods', 'GET');
      if (req.method === 'OPTIONS') return reply.code(204).send();
      if (req.method !== 'GET') return reply.code(405).send({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'Read-only API' }] });
      return;
    }
    if (origin === env.APP_ORIGIN) reply.header('Access-Control-Allow-Origin', origin).header('Access-Control-Allow-Credentials', 'true').header('Vary', 'Origin');
    if (req.method === 'OPTIONS') { reply.header('Access-Control-Allow-Methods', 'GET, POST').header('Access-Control-Allow-Headers', 'Content-Type, X-Tessera').header('Access-Control-Max-Age', '600'); return reply.code(204).send(); }
    if (req.method !== 'GET' && req.headers['x-tessera'] !== '1') return reply.code(403).send({ error: 'missing X-Tessera header' });
    if (origin && origin !== env.APP_ORIGIN) return reply.code(403).send({ error: 'origin not allowed' });
  });

  /* ---------- sessions ---------- */
  const setCookie = (reply: any, token: string) => reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: env.PRODUCTION, path: '/api', maxAge: 12 * 3600 });
  async function session(req: any, need: 'password' | 'active') {
    const t = req.cookies[COOKIE]; if (!t) return null;
    const { rows } = await appPool.query(`select s.id_hash, s.stage, s.last_seen, s.expires_at, s.revoked_at, u.id, u.role, u.name, u.username, u.dept, u.unit, u.title, u.patient_id, u.status
      from app.sessions s join app.users u on u.id = s.user_id where s.id_hash = $1`, [sessionHash(t)]);
    const s = rows[0]; if (!s || s.revoked_at || s.status !== 'active' || new Date(s.expires_at) < new Date()) return null;
    if (need === 'active' && s.stage !== 'active') return null;
    if (need === 'active' && Date.now() - new Date(s.last_seen).getTime() > env.IDLE_MINUTES * 60000) {
      await appPool.query('update app.sessions set revoked_at = now() where id_hash = $1', [s.id_hash]);
      await auditOnly({ id: s.id, role: s.role }, req.ip, { action: 'session-timeout', outcome: 'success' });
      return null;
    }
    if (need === 'active') await appPool.query('update app.sessions set last_seen = now() where id_hash = $1', [s.id_hash]);
    return s;
  }
  const requireUser = async (req: any, reply: any) => { const s = await session(req, 'active'); if (!s) { reply.code(401).send({ error: 'sign-in required' }); return null; } return s; };
  const actor = (s: any): Actor => ({ id: s.id, role: s.role, patient_id: s.patient_id });
  const publicUser = (s: any) => ({ id: s.id, name: s.role === "patient" ? null : s.name /* portal names come from the encrypted record via /api/bootstrap */, username: s.username, role: s.role, dept: s.dept, unit: s.unit, title: s.title, patientId: s.patient_id });

  /* ---------- sign-in: password, then authenticator code ---------- */
  /* ---------- sign-in through the identity provider (Phase 5) ---------- */
  const oidcCfg = () => ({ issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET, redirect: env.OIDC_REDIRECT });
  app.get('/api/auth/config', async () => ({ oidc: !!env.OIDC_ISSUER, issuer: env.OIDC_ISSUER ? new URL(env.OIDC_ISSUER).host : null }));
  app.get('/api/auth/oidc/start', async (_req: any, reply) => {
    if (!env.OIDC_ISSUER) return reply.code(404).send({ error: 'No identity provider is configured.' });
    const state = randomState(), nonce = randomState(), { verifier, challenge } = pkce();
    await appPool.query("delete from app.oidc_pending where created_at < now() - interval '10 minutes'");
    await appPool.query('insert into app.oidc_pending (state_hash, nonce, verifier_enc) values ($1,$2,$3)', [sessionHash(state), nonce, sealWithKek(verifier)]);
    return reply.redirect(await authorizeUrl(oidcCfg(), state, nonce, challenge), 302);
  });
  app.get('/api/auth/oidc/callback', async (req: any, reply) => {
    const dev = env.PRODUCTION ? '' : `&api=${encodeURIComponent(`http://localhost:${env.API_PORT}`)}`; // deployed builds set TESSERA_CONFIG.apiBase instead
    const back = (err?: string) => reply.redirect(env.APP_ORIGIN + '/?mode=live' + dev + (err ? `&signin_error=${encodeURIComponent(err)}` : '#home'), 302);
    if (!env.OIDC_ISSUER) return reply.code(404).send({ error: 'No identity provider is configured.' });
    const { code, state, error } = req.query || {};
    const p = state ? (await appPool.query("delete from app.oidc_pending where state_hash = $1 and created_at > now() - interval '10 minutes' returning nonce, verifier_enc", [sessionHash(String(state))])).rows[0] : null;
    const deny = async (why: string, u?: any) => { await auditOnly(u ? { id: u.id, role: u.role } : null, req.ip, { action: 'sign-in', outcome: 'denied', detail: `identity provider: ${why}`.slice(0, 200) }); return back('denied'); };
    if (error) return deny(`provider returned ${String(error).slice(0, 40)}`);
    if (!p) return deny('unknown or expired sign-in (state)');
    let claims: any;
    try { claims = await verifyIdToken(oidcCfg(), await exchange(oidcCfg(), String(code || ''), openWithKek(p.verifier_enc)), p.nonce); }
    catch (e) { return deny((e as Error).message); }
    const name = String(claims[env.OIDC_USER_CLAIM] || claims.email || '').toLowerCase().replace(/@.*$/, '');
    const u = (await appPool.query('select * from app.users where lower(username) = $1', [name])).rows[0];
    if (!u) return deny(`no Tessera account for "${name.slice(0, 40)}"`);
    if (u.status !== 'active') return deny('account suspended', u);
    const token = newSessionToken();
    await appPool.query("insert into app.sessions (id_hash, user_id, stage, expires_at, ip, ua) values ($1,$2,'active', now() + interval '12 hours', $3, $4)", [sessionHash(token), u.id, req.ip, String(req.headers['user-agent'] || '').slice(0, 200)]);
    await auditOnly({ id: u.id, role: u.role }, req.ip, { action: 'sign-in', outcome: 'success', detail: `identity provider ${new URL(env.OIDC_ISSUER).host} · amr ${(claims.amr || []).join(',')}` });
    setCookie(reply, token);
    return back();
  });

  app.post('/api/auth/password', async (req: any, reply) => {
    if (env.OIDC_ISSUER) return reply.code(403).send({ error: 'Sign in through your organisation\'s identity provider.' });
    const { username, password } = req.body || {};
    const { rows } = await appPool.query('select * from app.users where username = $1', [String(username || '')]);
    const u = rows[0];
    const fail = async (why: string) => { await auditOnly(u ? { id: u.id, role: u.role } : null, req.ip, { action: 'sign-in', outcome: 'denied', detail: why }); return reply.code(401).send({ error: 'Username or password is incorrect, or the account is locked.' }); };
    if (!u) return fail(`unknown user ${String(username).slice(0, 40)}`);
    if (u.status !== 'active') return fail('account suspended');
    if (u.locked_until && new Date(u.locked_until) > new Date()) return fail('locked after repeated failures');
    if (!verifyPassword(String(password || ''), u.password_hash)) {
      await appPool.query('update app.users set failed_logins = failed_logins + 1, locked_until = case when failed_logins + 1 >= 5 then now() + interval \'15 minutes\' else locked_until end where id = $1', [u.id]);
      return fail('wrong password');
    }
    const token = newSessionToken();
    await appPool.query("insert into app.sessions (id_hash, user_id, stage, expires_at, ip, ua) values ($1,$2,'password', now() + interval '5 minutes', $3, $4)", [sessionHash(token), u.id, req.ip, String(req.headers['user-agent'] || '').slice(0, 200)]);
    setCookie(reply, token);
    return { next: 'mfa' };
  });

  app.post('/api/auth/mfa', async (req: any, reply) => {
    const s = await session(req, 'password'); if (!s || s.stage !== 'password') return reply.code(401).send({ error: 'Start again with your password.' });
    const { rows } = await appPool.query('select totp_secret_enc, totp_last_step from app.users where id = $1', [s.id]);
    const step = totpStep(openWithKek(rows[0].totp_secret_enc), String((req.body || {}).code || ''));
    const reused = step !== null && step <= Number(rows[0].totp_last_step) && !(env.ALLOW_TOTP_REUSE && !env.PRODUCTION);
    if (step === null || reused) {
      await appPool.query('update app.users set failed_logins = failed_logins + 1, locked_until = case when failed_logins + 1 >= 5 then now() + interval \'15 minutes\' else locked_until end where id = $1', [s.id]);
      await auditOnly(actor(s), req.ip, { action: 'sign-in', outcome: 'denied', detail: reused ? 'authenticator code already used' : 'wrong authenticator code' });
      return reply.code(401).send({ error: reused ? 'That code was already used. Wait for the next one.' : 'That code is not right. Codes change every 30 seconds.' });
    }
    await appPool.query('update app.users set totp_last_step = greatest(totp_last_step, $2) where id = $1', [s.id, step]); // each code works once
    // Rotate the token at privilege change so a pre-MFA token can never become a full session
    await appPool.query('update app.sessions set revoked_at = now() where id_hash = $1', [s.id_hash]);
    const token = newSessionToken();
    await appPool.query("insert into app.sessions (id_hash, user_id, stage, expires_at, ip, ua) values ($1,$2,'active', now() + interval '12 hours', $3, $4)", [sessionHash(token), s.id, req.ip, String(req.headers['user-agent'] || '').slice(0, 200)]);
    await appPool.query('update app.users set failed_logins = 0, locked_until = null where id = $1', [s.id]);
    await auditOnly(actor(s), req.ip, { action: 'sign-in', outcome: 'success', detail: 'password + authenticator' });
    setCookie(reply, token);
    return { user: publicUser(s) };
  });

  app.post('/api/auth/logout', async (req: any, reply) => {
    const s = await session(req, 'password');
    if (s) { await appPool.query('update app.sessions set revoked_at = now() where id_hash = $1', [s.id_hash]); await auditOnly(actor(s), req.ip, { action: 'sign-out' }); }
    reply.clearCookie(COOKIE, { path: '/api' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => { const s = await requireUser(req, reply); if (!s) return; return { user: publicUser(s) }; });

  /* ---------- patients ---------- */
  const decode = (row: any, full: boolean) => {
    const dek = kms.unwrap(row.dek_wrapped);
    const base: any = { id: row.id, token: row.token, name: decText(dek, row.name_enc), mrn: decText(dek, row.mrn_enc), dob: decText(dek, row.dob_enc), age: row.age, sex: row.sex, dept: row.dept, consults: row.consults, unit: row.unit, bed: row.bed, status: row.status, code: row.code, attending: row.attending };
    if (full) Object.assign(base, decJson(dek, row.clinical_enc), { phone: decText(dek, row.phone_enc), memberId: decText(dek, row.member_id_enc), payer: decText(dek, row.payer_enc) });
    return base;
  };
  const accessOf = async (c: any, userId: string, pid: string) => {
    const r = await c.query(`select (select string_agg(kind, ',') from app.care_relationships where user_id = $1 and patient_id = $2) as rel,
      (select max(expires_at) from app.btg_grants where user_id = $1 and patient_id = $2 and expires_at > now()) as btg`, [userId, pid]);
    return r.rows[0];
  };

  /* Records for the caller: patient-linked ones for the given patients (row-level security has already
     limited the patients), and operational ones, all decrypted, filtered by policy and projected. */
  // The organisation key is cached unwrapped, but re-checked on each use: if it was replaced (rotation,
  // or a reseed in development) the new one is unwrapped instead of failing to decrypt
  let opsDek: Buffer | null = null, opsWrapped: Buffer | null = null;
  const orgKey = async (c: any) => {
    const r = (await c.query("select wrapped from app.keys where name = 'ops'")).rows[0];
    if (!r) throw new Error('organisation key missing: run the seed');
    if (!opsWrapped || !opsWrapped.equals(r.wrapped)) { opsDek = kms.unwrap(r.wrapped); opsWrapped = r.wrapped; }
    return opsDek!;
  };
  const emptyRecords = () => { const r: any = {}; COLLS.forEach((k) => { r[k] = POLICY[k].scalar ? null : ARRAY_COLLS.has(k) ? [] : {}; }); return r; };
  async function loadRecords(c: any, s: any, pids: string[], withOps = true, since: Date | null = null) {
    const role = s.role;
    const out: any = { records: emptyRecords(), versions: {} };
    if (pids.length) {
      const { rows } = await c.query('select r.coll, r.key, r.patient_id, r.version, r.body_enc, p.dek_wrapped from app.records r join app.patients p on p.id = r.patient_id where r.patient_id = any($1) and ($2::timestamptz is null or r.updated_at > $2) order by r.ord', [pids, since]);
      const deks = new Map<string, Buffer>();
      for (const r of rows) {
        if (!POLICY[r.coll]) continue;
        if (!deks.has(r.patient_id)) deks.set(r.patient_id, kms.unwrap(r.dek_wrapped));
        const raw = decJson(deks.get(r.patient_id)!, r.body_enc);
        if (!readable(role, r.coll, raw)) continue;
        const body = projectItem(role, r.coll, raw); if (body == null) continue;
        if (ARRAY_COLLS.has(r.coll)) out.records[r.coll].push(body); else out.records[r.coll][r.key] = body;
        out.versions[`${r.coll}|${r.key}`] = r.version;
      }
    }
    if (withOps) {
      const dek = await orgKey(c);
      const { rows } = await c.query('select coll, key, version, body_enc from app.ops where ($1::timestamptz is null or updated_at > $1) order by ord', [since]);
      for (const r of rows) {
        const pol = POLICY[r.coll]; if (!pol || !pol.read.includes(role)) continue;
        if (pol.perUser && r.key !== s.id) continue;
        const body = decJson(dek, r.body_enc);
        if (pol.scalar) out.records[r.coll] = body; else if (pol.arr) out.records[r.coll].push(body); else out.records[r.coll][r.key] = body;
        out.versions[`${r.coll}|${r.key}`] = r.version;
      }
    }
    return out;
  }

  app.get('/api/patients', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (!CHART_ROLES.has(s.role) && s.role !== 'patient') { await auditOnly(actor(s), req.ip, { action: 'list-patients', outcome: 'denied', detail: `role ${s.role}` }); return reply.code(403).send({ error: 'Your role has no patient list.' }); }
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const { rows } = await c.query('select * from app.patients order by id'); // row-level security decides which rows exist for this caller
      const list = rows.map((r: any) => decode(r, false));
      audit({ action: 'list-patients', resource: 'patients', patient_token: list.map((p: any) => p.token).join(' '), purpose: PURPOSE[s.role], detail: `${list.length} returned` });
      return { patients: list };
    });
  });

  app.get('/api/patients/:id', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const pid = String(req.params.id);
    if (!CHART_ROLES.has(s.role) && !(s.role === 'patient' && s.patient_id === pid)) {
      await auditOnly(actor(s), req.ip, { action: 'chart-denied', resource: pid, outcome: 'denied', detail: `role ${s.role} cannot open charts` });
      return reply.code(403).send({ error: 'Your role cannot open charts.' });
    }
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const { rows } = await c.query('select * from app.patients where id = $1', [pid]);
      if (!rows.length) {
        const exists = (await c.query('select app.patient_exists($1) as e', [pid])).rows[0].e;
        audit({ action: 'chart-denied', resource: pid, outcome: 'denied', detail: exists ? 'no care relationship' : 'no such patient' });
        reply.code(exists ? 403 : 404);
        // The break-the-glass screen gets the same minimal header as search: no name, MRN or date of birth
        const header = exists && BTG_ROLES.has(s.role) ? (await c.query('select * from app.patient_header($1)', [pid])).rows[0] : null;
        return header ? { error: 'Not in your care. Emergency access (break the glass) is available and will be reviewed.', btg: true, header } : { error: 'Not available.' };
      }
      const a = s.role === 'patient' ? { rel: 'self' } : await accessOf(c, s.id, pid);
      const via = a.rel ? 'care' : a.btg ? 'btg' : s.role === 'pharmacist' ? 'pharmacy' : 'care';
      let p = decode(rows[0], true);
      if (s.role === 'pharmacist') p = { id: p.id, token: p.token, name: p.name, mrn: p.mrn, age: p.age, sex: p.sex, unit: p.unit, bed: p.bed, weightKg: p.weightKg, allergies: p.allergies, allergiesUnknown: p.allergiesUnknown, meds: p.meds, labs: (p.labs || []).filter((l: any) => /creatinine|egfr|potassium|inr/i.test(l.test)) };
      audit({ action: 'view-chart', resource: s.role === 'pharmacist' ? 'medication profile' : 'chart', patient_token: rows[0].token, purpose: via === 'btg' ? 'Emergency (break-the-glass)' : PURPOSE[s.role], detail: `access: ${via}${a.btg ? `, grant until ${new Date(a.btg).toISOString()}` : ''}` });
      const recs = await loadRecords(c, s, [pid], false); // operational records come with the census
      return { patient: p, access: via, ...recs };
    });
  });

  /* ---------- break the glass ---------- */
  app.post('/api/patients/:id/btg', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const pid = String(req.params.id); const { reason, justification } = req.body || {};
    if (!BTG_ROLES.has(s.role)) { await auditOnly(actor(s), req.ip, { action: 'break-the-glass', resource: pid, outcome: 'denied', detail: `role ${s.role}` }); return reply.code(403).send({ error: 'Your role cannot use emergency access.' }); }
    if (!reason || String(justification || '').trim().length < 20) return reply.code(400).send({ error: 'Choose a reason and write at least 20 characters of justification.' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      if (!(await c.query('select app.patient_exists($1) as e', [pid])).rows[0].e) { reply.code(404); return { error: 'Not available.' }; }
      const g = await c.query(`insert into app.btg_grants (user_id, patient_id, reason, justification, expires_at) values ($1,$2,$3,$4, now() + make_interval(hours => $5)) returning id, expires_at`, [s.id, pid, String(reason).slice(0, 80), String(justification).slice(0, 1000), env.BTG_HOURS]);
      const tokRow = await c.query('select token from app.patients where id = $1', [pid]); // visible now: the grant is in this transaction
      audit({ action: 'break-the-glass', resource: pid, patient_token: tokRow.rows[0]?.token || '', purpose: 'Emergency (break-the-glass)', detail: `${reason}: ${String(justification).slice(0, 200)} · grant ${g.rows[0].id} until ${new Date(g.rows[0].expires_at).toISOString()}` });
      await outbox(c, 'email', null, 'admin', 'Break-the-glass access to review', `Emergency access to ${tokRow.rows[0]?.token || 'a record'} was used and needs review. Open Tessera, Audit log.`);
      return { grant: g.rows[0].id, expires: g.rows[0].expires_at };
    });
  });

  app.get('/api/btg', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (!AUDIT_ROLES.has(s.role)) { await auditOnly(actor(s), req.ip, { action: 'btg-review-list', outcome: 'denied' }); return reply.code(403).send({ error: 'Not permitted.' }); }
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const { rows } = await c.query('select g.id, g.user_id, u.name as user_name, g.patient_id, app.patient_token(g.patient_id) as token, g.reason, g.justification, g.granted_at, g.expires_at, g.reviewed_by, g.reviewed_at, g.review_outcome from app.btg_grants g join app.users u on u.id = g.user_id order by g.granted_at desc limit 200');
      audit({ action: 'btg-review-list', detail: `${rows.length} grants` });
      return { grants: rows };
    });
  });
  app.post('/api/btg/:id/review', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (!AUDIT_ROLES.has(s.role)) return reply.code(403).send({ error: 'Not permitted.' });
    const outcome = (req.body || {}).outcome; if (!['appropriate', 'inappropriate'].includes(outcome)) return reply.code(400).send({ error: 'outcome must be appropriate or inappropriate' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const r = await c.query('update app.btg_grants set reviewed_by = $1, reviewed_at = now(), review_outcome = $2 where id = $3 and reviewed_at is null and user_id <> $1 returning user_id', [s.id, outcome, +req.params.id]);
      if (!r.rowCount) { reply.code(409); return { error: 'Already reviewed, not found, or your own access.' }; }
      audit({ action: 'btg-review', resource: String(req.params.id), detail: outcome });
      return { ok: true };
    });
  });

  /* ---------- audit log ---------- */
  app.get('/api/audit', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (!AUDIT_ROLES.has(s.role)) { await auditOnly(actor(s), req.ip, { action: 'view-audit', outcome: 'denied' }); return reply.code(403).send({ error: 'Not permitted.' }); }
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const lim = Math.min(500, Math.max(1, +(req.query.limit || 100)));
      const q = String(req.query.q || '').slice(0, 80), act = String(req.query.action || '').slice(0, 40);
      const { rows } = await c.query("select seq, ts, actor, role, action, resource, patient_token, purpose, outcome, detail, hash from audit.log where ($2 = '' or action = $2) and ($3 = '' or actor ilike '%' || $3 || '%' or action ilike '%' || $3 || '%' or patient_token ilike '%' || $3 || '%' or detail ilike '%' || $3 || '%') order by seq desc limit $1", [lim, act, q]);
      audit({ action: 'view-audit', detail: `${rows.length} rows${act || q ? ' (filtered)' : ''}` }); // reading the audit log is itself audited
      return { events: rows };
    });
  });
  app.get('/api/audit/verify', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (!AUDIT_ROLES.has(s.role)) return reply.code(403).send({ error: 'Not permitted.' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const r = (await c.query('select * from audit.verify()')).rows[0];
      const cp = auditKey() ? await verifyCheckpoints(c, worm(), auditKey()!) : null; // the chain against the signed write-once checkpoints
      audit({ action: 'verify-audit-chain', detail: (r.ok ? `intact (${r.checked})` : `broken at ${r.broken_at}`) + (cp ? ` · ${cp.checkpoints} checkpoints ${cp.ok ? 'match' : 'MISMATCH'}` : '') });
      return { ...r, checkpoints: cp };
    });
  });

  /* ---------- bootstrap for the app's live adapter ----------
     The census the app's screens run on. Clinical roles: the full record of every patient they may
     open (row-level security decides); pharmacists a medication profile; the front desk, billing,
     insurance, lab, pathology and radiology a projection for their job; quality de-identified tokens.
     Each patient disclosed gets its own audit row; opening a chart later writes its own view-chart row. */
  const projectPharm = (p: any) => ({ id: p.id, token: p.token, name: p.name, mrn: p.mrn, age: p.age, sex: p.sex, dept: p.dept, unit: p.unit, bed: p.bed, status: p.status, code: p.code, attending: p.attending, weightKg: p.weightKg, heightCm: p.heightCm, allergies: p.allergies, allergiesUnknown: p.allergiesUnknown, meds: p.meds, labs: (p.labs || []).filter((l: any) => /creatinine|egfr|potassium|inr/i.test(l.test)), _projection: 'medication-profile' });
  const directory = async (c: any) => (await c.query("select id, name, username, role, dept, unit, title, status from app.users order by id")).rows.map((u: any) => u.role === 'patient' ? { ...u, name: null } : u);
  app.get('/api/bootstrap', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const cfg = { idleMinutes: env.IDLE_MINUTES, btgHours: env.BTG_HOURS };
    const censusRole = CHART_ROLES.has(s.role) || s.role === 'patient' || ORG_ROLES.includes(s.role);
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const users = await directory(c);
      const now = (await c.query('select now() as n')).rows[0].n; // the changes feed starts here
      if (!censusRole) { const recs = await loadRecords(c, s, []); return { now, user: publicUser(s), users, patients: [], btg: [], config: cfg, ...recs }; }
      const { rows } = await c.query('select * from app.patients order by id');
      const rel = CHART_ROLES.has(s.role) ? (await c.query('select patient_id, string_agg(kind, \',\') as kinds from app.care_relationships where user_id = $1 group by patient_id', [s.id])).rows : [];
      const btg = BTG_ROLES.has(s.role) ? (await c.query('select patient_id, reason, justification, granted_at, expires_at from app.btg_grants where user_id = $1 and expires_at > now()', [s.id])).rows : [];
      const patients = rows.map((r: any) => {
        let p = decode(r, true);
        if (s.role === 'pharmacist') p = projectPharm(p);
        else if (ORG_ROLES.includes(s.role)) p = project(s.role, p);
        const k = rel.find((x: any) => x.patient_id === r.id);
        p._access = s.role === 'patient' ? 'self' : k ? 'care' : btg.some((g: any) => g.patient_id === r.id) ? 'btg' : s.role === 'pharmacist' ? 'pharmacy' : ORG_ROLES.includes(s.role) ? 'role' : 'care';
        p._rel = k ? k.kinds : '';
        audit({ action: 'census', resource: s.role === 'quality' ? 'de-identified token' : ORG_ROLES.includes(s.role) ? `${s.role} projection` : s.role === 'pharmacist' ? 'medication profile and medication records' : 'worklist record and clinical records', patient_token: r.token, purpose: p._access === 'btg' ? 'Emergency (break-the-glass)' : PURPOSE[s.role] || 'Operations', detail: `access: ${p._access}` });
        return p;
      });
      const recs = await loadRecords(c, s, patients.map((p: any) => p.id));
      return { now, user: publicUser(s), users, patients, btg, config: cfg, ...recs };
    });
  });

  /* Quality works de-identified. Naming patients needs a stated purpose; each name revealed is audited. */
  app.post('/api/reveal', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (s.role !== 'quality') return reply.code(403).send({ error: 'Not permitted.' });
    const purpose = String((req.body || {}).purpose || '').trim(); const ids = ((req.body || {}).ids || []).map(String).slice(0, 200);
    if (purpose.length < 5) return reply.code(400).send({ error: 'State the purpose.' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const { rows } = await c.query('select * from app.patients where id = any($1)', [ids]);
      const names = rows.map((r: any) => { const p = decode(r, false); audit({ action: 'phi-reveal', resource: 'identified view', patient_token: r.token, purpose: purpose.slice(0, 80), detail: 'name and MRN revealed' }); return { id: p.id, name: p.name, mrn: p.mrn }; });
      return { patients: names };
    });
  });

  /* Registration (front desk) and unknown emergency arrivals (ER doctor or nurse). Identifiers are
     encrypted under a new data key; the duplicate check matches date of birth by blind index and then
     compares names in memory; the MRN comes from a server sequence. */
  const norm = (x: string) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
  const lev = (a: string, b: string) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const users0 = async (c: any) => (await c.query('select id, role, dept, unit, status from app.users')).rows;
  async function recomputeCare(c: any, pid: string, p: any) {
    const b = (await c.query('select * from app.patient_boards($1)', [pid])).rows[0];
    const want = relationsFor(await users0(c), p, { unitGroups: UNIT_GROUPS, onEr: b.on_er, inOt: b.in_ot });
    await c.query('delete from app.care_relationships where patient_id = $1', [pid]);
    for (const r of want) await c.query('insert into app.care_relationships values ($1,$2,$3) on conflict do nothing', [r.user, pid, r.kind]);
    return want.length;
  }
  app.post('/api/patients/register', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const b = req.body || {}, p = b.patient || {};
    const unknown = !!p.unidentified;
    if (!(s.role === 'receptionist' || (unknown && BTG_ROLES.has(s.role)))) { await auditOnly(actor(s), req.ip, { action: 'mpi-register', outcome: 'denied', detail: `role ${s.role}` }); return reply.code(403).send({ error: 'Your role cannot register patients.' }); }
    if (!/^[A-Z][A-Z0-9-]{1,24}$/.test(String(p.id || ''))) return reply.code(400).send({ error: 'Bad patient id.' });
    if (!unknown && (!p.name || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.dob || '')))) return reply.code(400).send({ error: 'Name and date of birth are required.' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      if ((await c.query('select app.patient_exists($1) as e', [p.id])).rows[0].e) { reply.code(409); return { error: 'That patient id is taken.' }; }
      if (!unknown) {
        const cands = (await c.query('select * from app.patients where dob_idx = $1', [blindIndex('dob|' + p.dob)])).rows.map((r: any) => decode(r, false));
        const m = cands.find((x: any) => lev(norm(x.name), norm(p.name)) <= 2);
        if (m && !b.force) { audit({ action: 'mpi-duplicate-warning', patient_token: m.token, detail: 'possible duplicate at registration' }); reply.code(409); return { error: `Possible duplicate: ${m.name}, MRN ${m.mrn}.`, duplicate: { id: m.id, name: m.name, mrn: m.mrn } }; }
      }
      const n = (await c.query("select nextval('app.mrn_seq') as n")).rows[0].n;
      const mrn = unknown ? `T-${n}` : String(n);
      const dek = newDek();
      const clinical = { problems: p.problems || [], allergies: p.allergies || [], allergiesUnknown: !!p.allergiesUnknown, vitals: p.vitals || {}, meds: p.meds || [], labs: p.labs || [], weightKg: p.weightKg || 0, heightCm: p.heightCm || 0, bloodGroup: p.bloodGroup || 'Unknown', unidentified: unknown, alias: p.alias || '' };
      const row = { id: p.id, token: patientToken(mrn), age: p.age ?? null, sex: p.sex ?? null, dept: p.dept || (unknown ? 'EMER' : 'GMED'), consults: p.consults || [], unit: p.unit || null, bed: p.bed || null, status: p.status || (unknown ? 'Emergency' : 'Outpatient'), code: p.code || 'Full code', attending: p.attending || null };
      await c.query(`insert into app.patients (id, token, dek_wrapped, name_enc, dob_enc, mrn_enc, phone_enc, member_id_enc, payer_enc, clinical_enc, name_idx, mrn_idx, dob_idx, age, sex, dept, consults, unit, bed, status, code, attending)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [row.id, row.token, kms.wrap(dek), encField(dek, p.name || 'Unknown'), encField(dek, p.dob || ''), encField(dek, mrn), encField(dek, p.phone || ''), encField(dek, p.memberId || ''), encField(dek, p.payer || ''), encField(dek, clinical),
          blindIndex(p.name || mrn), blindIndex(mrn), p.dob ? blindIndex('dob|' + p.dob) : null, row.age, row.sex, row.dept, row.consults, row.unit, row.bed, row.status, row.code, row.attending]);
      const nrel = await recomputeCare(c, row.id, row);
      audit({ action: unknown ? 'mpi-register-unknown' : 'mpi-register', patient_token: row.token, detail: `${unknown ? 'temporary MRN issued' : b.force ? 'duplicate warning overridden' : 'no duplicate found'} · ${nrel} care relationships` });
      return { id: row.id, mrn, token: row.token };
    });
  });

  /* Hospital-wide search: exact match on the keyed hash (blind index) of an MRN or full name, so the
     database never needs plaintext to search. Returns a minimal header and whether the caller has access. */
  app.get('/api/search', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (!BTG_ROLES.has(s.role)) return reply.code(403).send({ error: 'Not permitted.' });
    const q = String(req.query.q || '').trim(); if (q.length < 3) return reply.code(400).send({ error: 'Enter a full MRN or full name.' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const { rows } = await c.query('select id, token, age, sex, dept, unit from app.patients_directory($1)', [blindIndex(q)]);
      audit({ action: 'search-patients', resource: 'hospital-wide', patient_token: rows.map((r: any) => r.token).join(' '), purpose: PURPOSE[s.role], detail: `${rows.length} match(es)` });
      return { matches: rows };
    });
  });

  /* ---------- record writes ----------
     The app sends what changed; each item is authorised (role policy, then row-level security for
     patient-linked records), checked against the rules, encrypted, version-checked and audited in its
     own transaction. A refused item comes back with the stored version so the app can put it back. */
  app.post('/api/records', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const writes = (req.body || {}).writes;
    if (!Array.isArray(writes) || writes.length > 50) return reply.code(400).send({ error: 'Send 1 to 50 writes.' });
    const results = [];
    for (const w of writes) results.push(w && w.coll === 'users' ? await writeUser(s, req.ip, w) : await writeOne(s, req.ip, w));
    return { results };
  });
  const IDENTITY = ['name', 'dob', 'mrn', 'phone', 'payer', 'memberId'], ADT = ['unit', 'bed', 'status', 'dept', 'consults', 'age', 'attending'];
  async function writeOne(s: any, ip: string, w: any) {
    const coll = w && w.coll as Coll, key = String((w && w.key) || ''), pid = String((w && w.patient) || '');
    const pol = POLICY[coll];
    const base = pol ? { coll, key: key.slice(0, 160) } : {}; // never echo an unknown collection or key back
    if (!pol || !key || key.length > 160) return { ...base, ok: false, status: 400, error: 'Bad write.' };
    if (!pol.write.includes(s.role)) { await auditOnly(actor(s), ip, { action: `write-${coll}`, resource: key, outcome: 'denied', detail: `role ${s.role}` }); return { ...base, ok: false, status: 403, error: 'Your role cannot change this.' }; }
    const uname = (await appPool.query('select name from app.users where id = $1', [s.id])).rows[0].name;
    if (!pol.pt) return writeOps(s, ip, w, coll, key, uname);
    if (!pid) return { ...base, ok: false, status: 400, error: 'Bad write.' };
    if (pol.pt === 'key' && key !== pid) return { ...base, ok: false, status: 400, error: 'Key must be the patient.' };
    if (pol.pt === 'mar' && key.split('|')[0] !== pid) return { ...base, ok: false, status: 400, error: 'MAR slot belongs to another patient.' };
    return withAudit(actor(s), ip, async (c, audit) => {
      const pr = (await c.query('select * from app.patients where id = $1', [pid])).rows[0];
      if (!pr) { audit({ action: `write-${coll}`, resource: key, outcome: 'denied', detail: 'no care relationship' }); return { ...base, ok: false, status: 403, error: 'Not in your care.' }; }
      const dek = kms.unwrap(pr.dek_wrapped);
      const cur = (await c.query('select patient_id, version, body_enc from app.records where coll = $1 and key = $2', [coll, key])).rows[0];
      const old = cur ? decJson(dek, cur.body_enc) : null;
      const current = cur ? { version: cur.version, body: projectItem(s.role, coll, old) } : null;
      if (cur && cur.patient_id !== pid) return { ...base, ok: false, status: 409, error: 'Record belongs to another patient.' };
      if ((cur ? cur.version : 0) !== Number(w.version || 0)) { audit({ action: `write-${coll}`, resource: key, patient_token: pr.token, outcome: 'denied', detail: `version conflict (have ${w.version || 0}, stored ${cur ? cur.version : 0})` }); return { ...base, ok: false, status: 409, error: 'Someone else changed this record. The latest version is shown.', current }; }
      const link = pol.pt === 'order' ? 'orders' : pol.pt === 'discharge' ? 'discharges' : null;
      if (link) { const o = (await c.query('select patient_id from app.records where coll = $1 and key = $2', [link, key])).rows[0]; if (!o || o.patient_id !== pid) return { ...base, ok: false, status: 400, error: 'No such record for this patient.' }; }
      // A role that reads a projection writes back only what it can see: hidden fields are kept
      let next = w.body;
      if (old && coll === 'patientPatches') next = { ...old, ...next };
      if (old && coll === 'sdoh' && s.role === 'receptionist') next = { ...next, answers: { ...(old.answers || {}), ...(next.answers || {}) } };
      const patient = { ...decJson(dek, pr.clinical_enc) };
      const planRow = coll === 'orders' ? (await c.query("select body_enc from app.records where coll = 'carePlans' and key = $1", [pid])).rows[0] : null;
      const siblings = async (sc: string) => sc === 'appts' ? (await c.query('select * from app.appointments_for_check()')).rows.map((r: any) => ({ key: r.key, body: decJson(kms.unwrap(r.dek_wrapped), r.body_enc) })) : [];
      const ops = async (oc: string) => { const k = await orgKey(c); return (await c.query('select body_enc from app.ops where coll = $1 order by ord', [oc])).rows.map((r: any) => decJson(k, r.body_enc)); };
      try { await check(coll, next, { role: s.role, userId: s.id, userName: uname, key, patient, old, plan: planRow ? decJson(dek, planRow.body_enc) : null, siblings, ops }); }
      catch (e) {
        if (!(e instanceof RuleError)) throw e;
        audit({ action: `write-${coll}`, resource: key, patient_token: pr.token, outcome: 'denied', detail: e.message.slice(0, 200) });
        return { ...base, ok: false, status: e.status, error: e.message, current };
      }
      const enc = encField(dek, next);
      if (cur) await c.query('update app.records set version = version + 1, body_enc = $3, updated_by = $4, updated_at = now() where coll = $1 and key = $2', [coll, key, enc, s.id]);
      else await c.query('insert into app.records (coll, key, patient_id, body_enc, created_by, updated_by) values ($1,$2,$3,$4,$5,$5)', [coll, key, pid, enc, s.id]);
      let extra = '';
      // Identity and admission/transfer changes also update the patient row (encrypted identifiers,
      // blind indexes) and the care relationships, so search and access follow the patient
      if (coll === 'patientPatches') {
        const changed = Object.keys(next).filter((k) => JSON.stringify((old || {})[k]) !== JSON.stringify(next[k]));
        const enc2 = (v: any) => encField(dek, v ?? '');
        if (changed.some((k) => IDENTITY.includes(k))) {
          const nm = next.name, mr = next.mrn, dob = next.dob;
          if (nm != null) await c.query('update app.patients set name_enc = $2, name_idx = $3 where id = $1', [pid, enc2(nm), blindIndex(nm)]);
          if (mr != null) await c.query('update app.patients set mrn_enc = $2, mrn_idx = $3 where id = $1', [pid, enc2(mr), blindIndex(mr)]);
          if (dob != null) await c.query('update app.patients set dob_enc = $2, dob_idx = $3 where id = $1', [pid, enc2(dob), dob ? blindIndex('dob|' + dob) : null]);
          for (const [k, col] of [['phone', 'phone_enc'], ['payer', 'payer_enc'], ['memberId', 'member_id_enc']]) if (next[k] != null) await c.query(`update app.patients set ${col} = $2 where id = $1`, [pid, enc2(next[k])]);
          extra += ' · identity updated';
        }
        if (changed.some((k) => ADT.includes(k))) {
          const merged = { ...pr, ...Object.fromEntries(ADT.filter((k) => next[k] !== undefined).map((k) => [k, next[k]])) };
          await c.query('update app.patients set unit = $2, bed = $3, status = $4, dept = $5, consults = $6, age = $7, attending = $8 where id = $1', [pid, merged.unit, merged.bed, merged.status, merged.dept, merged.consults || [], merged.age, merged.attending]);
          extra += ` · care relationships now ${await recomputeCare(c, pid, merged)}`;
        }
      }
      if ((coll === 'er' || coll === 'ot') && !cur) extra += ` · care relationships now ${await recomputeCare(c, pid, pr)}`;
      await notify(c, coll, old, next, pr.token);
      const version = (cur ? cur.version : 0) + 1;
      audit({ action: `write-${coll}`, resource: key, patient_token: pr.token, purpose: PURPOSE[s.role] || 'Operations', detail: (cur ? `updated to v${version}` : 'created') + extra });
      return { ...base, ok: true, version };
    });
  }
  async function writeOps(s: any, ip: string, w: any, coll: string, key: string, uname: string) {
    const base = { coll, key };
    return withAudit(actor(s), ip, async (c, audit) => {
      const dek = await orgKey(c);
      const cur = (await c.query('select version, body_enc from app.ops where coll = $1 and key = $2', [coll, key])).rows[0];
      const old = cur ? decJson(dek, cur.body_enc) : null;
      const current = cur ? { version: cur.version, body: old } : null;
      if ((cur ? cur.version : 0) !== Number(w.version || 0)) { audit({ action: `write-${coll}`, resource: key, outcome: 'denied', detail: 'version conflict' }); return { ...base, ok: false, status: 409, error: 'Someone else changed this. The latest version is shown.', current }; }
      const ops = async (oc: string) => (await c.query('select body_enc from app.ops where coll = $1 order by ord', [oc])).rows.map((r: any) => decJson(dek, r.body_enc));
      try { await check(coll, w.body, { role: s.role, userId: s.id, userName: uname, key, patient: null, old, ops }); }
      catch (e) {
        if (!(e instanceof RuleError)) throw e;
        audit({ action: `write-${coll}`, resource: key, outcome: 'denied', detail: e.message.slice(0, 200) });
        return { ...base, ok: false, status: e.status, error: e.message, current };
      }
      const enc = encField(dek, JSON.stringify(w.body === undefined ? null : w.body)); // always JSON text, so strings and null round-trip
      if (cur) await c.query('update app.ops set version = version + 1, body_enc = $3, updated_by = $4, updated_at = now() where coll = $1 and key = $2', [coll, key, enc, s.id]);
      else await c.query('insert into app.ops (coll, key, body_enc, created_by, updated_by) values ($1,$2,$3,$4,$4)', [coll, key, enc, s.id]);
      // An approved role request changes the account itself, here and nowhere else
      let extra = '';
      if (coll === 'roleRequests' && w.body.status === 'approved' && old && old.status === 'pending') {
        const [role, sc] = String(old.to).split(':');
        await c.query('update app.users set role = $2, dept = $3, unit = $4, title = $5 where id = $1', [old.user, role, role === 'doctor' ? sc : null, role === 'nurse' ? sc : null, old.toLabel || null]);
        await c.query('update app.sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [old.user]);
        const u = (await c.query('select id, role, dept, unit, status from app.users where id = $1', [old.user])).rows;
        await c.query('delete from app.care_relationships where user_id = $1', [old.user]);
        let n = 0;
        for (const pt of (await c.query('select * from app.patients_routing()')).rows) for (const r of relationsFor(u, pt, { unitGroups: UNIT_GROUPS, onEr: pt.on_er, inOt: pt.in_ot })) { await c.query('insert into app.care_relationships values ($1,$2,$3) on conflict do nothing', [r.user, pt.id, r.kind]); n++; }
        extra = ` · ${old.user} is now ${role}${sc ? ' ' + sc : ''}; ${n} care relationships; their sessions ended`;
      }
      await notify(c, coll, old, w.body, '');
      const version = (cur ? cur.version : 0) + 1;
      audit({ action: `write-${coll}`, resource: key, purpose: 'Operations', detail: (cur ? `updated to v${version}` : 'created') + extra });
      return { ...base, ok: true, version };
    });
  }
  /* Accounts: administrators suspend and reactivate (never themselves). Role and scope change only
     through an approved role request, so a direct edit of those fields is accepted only when it matches
     what the approval already applied. */
  async function writeUser(s: any, ip: string, w: any) {
    const key = String(w.key || ''), base = { coll: 'users', key };
    if (s.role !== 'admin') { await auditOnly(actor(s), ip, { action: 'write-users', resource: key, outcome: 'denied', detail: `role ${s.role}` }); return { ...base, ok: false, status: 403, error: 'Only administrators manage accounts.' }; }
    return withAudit(actor(s), ip, async (c, audit) => {
      const u = (await c.query('select id, role, dept, unit, title, status from app.users where id = $1', [key])).rows[0];
      if (!u) return { ...base, ok: false, status: 404, error: 'No such account.' };
      const next = w.body || {}, current = { version: 0, body: u };
      for (const k of ['role', 'dept', 'unit']) if ((next[k] ?? null) !== (u[k] ?? null)) { audit({ action: 'write-users', resource: key, outcome: 'denied', detail: `direct ${k} change` }); return { ...base, ok: false, status: 403, error: 'Role and scope change only through an approved role request.', current }; }
      if (next.status && next.status !== u.status) {
        if (key === s.id) return { ...base, ok: false, status: 403, error: 'You cannot suspend your own account.', current };
        if (!['active', 'suspended'].includes(next.status)) return { ...base, ok: false, status: 400, error: 'Unknown status.' };
        await c.query('update app.users set status = $2 where id = $1', [key, next.status]);
        if (next.status === 'suspended') await c.query('update app.sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [key]);
        audit({ action: next.status === 'suspended' ? 'user-suspend' : 'user-reactivate', resource: key, detail: next.status === 'suspended' ? 'sessions ended' : '' });
      }
      return { ...base, ok: true, version: 0 };
    });
  }

  /* ---------- outbound messages (Phase 4b) ----------
     Pager, email and SMS leave the hospital, so they are built only from tokens and fixed text: never
     a name, MRN or clinical value. A test scans every message. Delivery is a separate worker. */
  async function outbox(c: any, channel: string, toUser: string | null, toRole: string | null, subject: string, body: string) {
    await c.query('insert into app.outbox (channel, to_user, to_role, subject, body) values ($1,$2,$3,$4,$5)', [channel, toUser, toRole, subject, body]);
  }
  async function notify(c: any, coll: string, old: any, next: any, token: string) {
    if (coll === 'labOrders' && next.status === 'Released' && !(old && old.status === 'Released') && String(next.flag || '').length > 1)
      await outbox(c, 'pager', next.by || null, null, 'Critical lab result', `Critical result for ${token}. Open Tessera, Critical results. Reply is not monitored.`);
    if (coll === 'results' && !old) await outbox(c, 'pager', next.to || null, next.to ? null : 'doctor', 'Critical result', `Critical result for ${token} needs acknowledgement. Open Tessera.`);
    if (coll === 'bedRequests' && !old) await outbox(c, 'pager', null, 'receptionist', 'Bed request', `An admission is waiting for a bed in ${String(next.unit || '').slice(0, 12)}. Open Tessera, Bed board.`);
    if (coll === 'roleRequests' && !old) await outbox(c, 'email', null, 'admin', 'Role change to approve', 'A role change is waiting for a second administrator. Open Tessera, Users and roles.');
    if (coll === 'supportReq' && !old) await outbox(c, 'email', null, 'admin', 'Support access request', 'The platform team asked for temporary support access. Open Tessera to approve or decline.');
    if (coll === 'appts' && !old) await outbox(c, 'sms', null, `patient:${token}`, 'Appointment reminder', 'You have an upcoming visit at Bayview. Reply C to confirm or call (415) 555-0100.');
  }
  app.get('/api/outbox', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (s.role !== 'admin') return reply.code(403).send({ error: 'Not permitted.' });
    return withAudit(actor(s), req.ip, async (c, audit) => { const { rows } = await c.query('select * from app.outbox order by id desc limit 200'); audit({ action: 'view-outbox', detail: `${rows.length} messages` }); return { messages: rows }; });
  });

  /* ---------- changes feed (Phase 4b) ----------
     What changed since a moment, for this caller only (row-level security, policy and projection as
     for the census). The app polls it so one person's work reaches everyone else's screen. */
  app.get('/api/changes', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const since = new Date(String(req.query.since || ''));
    if (isNaN(+since)) return reply.code(400).send({ error: 'since must be a timestamp' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const now = (await c.query('select now() as n')).rows[0].n;
      const census = CHART_ROLES.has(s.role) || s.role === 'patient' || ORG_ROLES.includes(s.role);
      const pids = census ? (await c.query('select id, token from app.patients')).rows : [];
      const recs = await loadRecords(c, s, pids.map((p: any) => p.id), true, since);
      const touched = new Set<string>();
      for (const [coll, v] of Object.entries(recs.records)) { if (!POLICY[coll] || !POLICY[coll].pt) continue; for (const x of (Array.isArray(v) ? v : Object.entries(v as any).map(([k, b]) => ({ ...(b as any), _key: k })))) { const pid = (x as any).patient || ((x as any)._key || '').split('|')[0]; if (pid) touched.add(pid); } }
      const toks = pids.filter((p: any) => touched.has(p.id)).map((p: any) => p.token);
      if (toks.length) audit({ action: 'sync', resource: 'changes feed', patient_token: toks.join(' '), purpose: PURPOSE[s.role] || 'Operations', detail: `${Object.keys(recs.versions).length} records changed` });
      return { now, ...recs };
    });
  });

  /* ---------- FHIR R4 read API (Phase 4b) ----------
     Two ways in: the Tessera session cookie, or a Bearer token for an app the administrator approved,
     issued when a signed-in user authorises it (POST /api/fhir/authorize). A token acts as that user:
     the same role, care relationships, row-level security and projection, narrowed further by the
     app's scopes. Revoking the app in Hospital configuration kills its tokens. Every read is audited. */
  const FHIR_BASE = `http://localhost:${env.API_PORT}/fhir/r4`;
  const interopApps = async (c: any) => { const k = await orgKey(c); const r = (await c.query("select body_enc from app.ops where coll = 'interop' and key = 'apps'")).rows[0]; return r ? decJson(k, r.body_enc) || [] : []; };
  app.post('/api/fhir/authorize', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const appId = String((req.body || {}).app || '');
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const a = (await interopApps(c)).find((x: any) => x.id === appId);
      if (!a || !/^Approved/.test(a.status)) { audit({ action: 'fhir-authorize', resource: appId, outcome: 'denied', detail: a ? `app ${a.status}` : 'unknown app' }); reply.code(403); return { error: 'That app is not approved for this hospital.' }; }
      const patientApp = /^patient\//.test(a.scopes);
      if (patientApp ? s.role !== 'patient' : !CHART_ROLES.has(s.role)) { audit({ action: 'fhir-authorize', resource: a.name, outcome: 'denied', detail: `role ${s.role}` }); reply.code(403); return { error: patientApp ? 'Only the patient can connect this app.' : 'Your role cannot connect clinical apps.' }; }
      const token = newSessionToken();
      await c.query("insert into app.fhir_tokens (token_hash, app_id, user_id, scopes, expires_at) values ($1,$2,$3,$4, now() + interval '1 hour')", [sessionHash(token), a.id, s.id, a.scopes]);
      audit({ action: 'fhir-authorize', resource: a.name, purpose: PURPOSE[s.role], detail: `scopes ${a.scopes}` });
      return { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: a.scopes, ...(patientApp ? { patient: s.patient_id } : {}), fhir_base: FHIR_BASE };
    });
  });
  async function fhirCaller(req: any, reply: any) {
    const h = String(req.headers.authorization || '');
    const fail = (code: number, text: string) => { reply.code(code).header('Content-Type', 'application/fhir+json'); reply.send(outcome(code === 401 ? 'login' : 'forbidden', text)); return null; };
    if (/^Bearer\s+/i.test(h)) {
      const t = (await appPool.query(`select t.*, u.role, u.name, u.username, u.dept, u.unit, u.title, u.patient_id, u.status from app.fhir_tokens t join app.users u on u.id = t.user_id where t.token_hash = $1`, [sessionHash(h.replace(/^Bearer\s+/i, ''))])).rows[0];
      if (!t || t.revoked_at || new Date(t.expires_at) < new Date() || t.status !== 'active') return fail(401, 'Token is invalid, expired or revoked.');
      const c = await appPool.connect();
      try { const a = (await interopApps(c)).find((x: any) => x.id === t.app_id); if (!a || !/^Approved/.test(a.status)) return fail(401, 'This app was revoked; its tokens no longer work.'); return { s: { id: t.user_id, role: t.role, patient_id: t.patient_id, name: t.name }, scopes: t.scopes, app: a.name }; }
      finally { c.release(); }
    }
    const s = await session(req, 'active');
    if (!s) return fail(401, 'Sign in, or send a Bearer token from POST /api/fhir/authorize.');
    if (!CHART_ROLES.has(s.role) && s.role !== 'patient') return fail(403, 'Your role has no FHIR access.');
    return { s, scopes: s.role === 'patient' ? 'patient/*.read' : 'user/*.read', app: 'Tessera app' };
  }
  const fhirSend = (reply: any, body: any, code = 200) => reply.code(code).header('Content-Type', 'application/fhir+json').send(body);
  async function fhirPatient(c: any, k: any, pid: string) {
    const row = (await c.query('select * from app.patients where id = $1', [pid])).rows[0]; // row-level security
    if (!row) return null;
    let p = decode(row, true);
    const patch = (await loadRecords(c, k.s, [pid], false)).records.patientPatches[pid]; if (patch) p = { ...p, ...patch };
    if (k.s.role === 'pharmacist') p = projectPharm(p);
    return { row, p };
  }
  app.get('/fhir/r4/metadata', async (_req, reply) => fhirSend(reply, capability(FHIR_BASE)));
  app.get('/fhir/r4/:type/:id', async (req: any, reply) => {
    const k = await fhirCaller(req, reply); if (!k) return;
    if (req.params.type !== 'Patient') return fhirSend(reply, outcome('not-supported', 'Read by id is supported for Patient; search other types with ?patient='), 400);
    if (!allows(k.scopes, 'Patient')) return fhirSend(reply, outcome('forbidden', 'Scope does not include Patient.'), 403);
    if (k.s.role === 'patient' && req.params.id !== k.s.patient_id) return fhirSend(reply, outcome('forbidden', 'Patient apps can read only that patient.'), 403);
    const out = await withAudit(actor(k.s), req.ip, async (c, audit) => {
      const r = await fhirPatient(c, k, String(req.params.id));
      if (!r) { audit({ action: 'fhir-read', resource: `Patient/${req.params.id}`, outcome: 'denied', detail: `${k.app}: no access` }); return [403, outcome('forbidden', 'Not available.')] as [number, any]; }
      audit({ action: 'fhir-read', resource: 'Patient', patient_token: r.row.token, purpose: PURPOSE[k.s.role], detail: k.app });
      return [200, patient(r.p)] as [number, any];
    });
    return fhirSend(reply, out[1], out[0]); // sent only after the audit row is committed
  });
  app.get('/fhir/r4/:type', async (req: any, reply) => {
    const k = await fhirCaller(req, reply); if (!k) return;
    const type = String(req.params.type);
    if (!(FHIR_TYPES as readonly string[]).includes(type)) return fhirSend(reply, outcome('not-supported', `${type} is not supported.`), 404);
    if (!allows(k.scopes, type)) return fhirSend(reply, outcome('forbidden', `Scope does not include ${type}.`), 403);
    const out = await withAudit(actor(k.s), req.ip, async (c, audit) => {
      let pid = String(req.query.patient || '').replace(/^Patient\//, '');
      if (type === 'Patient') {
        const ident = String(req.query.identifier || '').replace(/^urn:tessera:mrn\|/, '');
        if (!ident && !pid) return [400, outcome('required', 'Search Patient by identifier.')] as [number, any];
        if (ident) { const m = (await c.query('select id from app.patients_directory($1)', [blindIndex(ident)])).rows[0]; pid = m ? m.id : ''; }
      } else if (!pid) return [400, outcome('required', 'Search needs ?patient=')] as [number, any];
      if (k.s.role === 'patient' && pid && pid !== k.s.patient_id) return [403, outcome('forbidden', 'Patient apps can read only that patient.')] as [number, any];
      const r = pid ? await fhirPatient(c, k, pid) : null;
      if (!r) { if (pid) audit({ action: 'fhir-read', resource: `${type}?patient=${pid}`, outcome: 'denied', detail: `${k.app}: no access` }); return [200, bundle(FHIR_BASE, [])] as [number, any]; }
      const recs = (await loadRecords(c, k.s, [pid], false)).records;
      const list = type === 'Patient' ? [patient(r.p)] : resourcesFor(r.p, recs, new Set([type]), req.query.category ? String(req.query.category) : undefined);
      audit({ action: 'fhir-read', resource: type, patient_token: r.row.token, purpose: PURPOSE[k.s.role], detail: `${k.app}: ${list.length} resource(s)` });
      return [200, bundle(FHIR_BASE, list)] as [number, any];
    });
    return fhirSend(reply, out[1], out[0]); // sent only after the audit row is committed
  });

  /* ---------- Privacy Sentinel (Phase 4b) ----------
     Rules over the real audit log. The privacy officer (administrator) sees tokens; naming a patient
     needs a written reason and is itself audited. */
  let scan: { at: number; alerts: any[]; events: number } | null = null; // the last scan, kept a minute
  async function privacyCtx(c: any) {
    const k = await orgKey(c);
    const cfg = Object.fromEntries((await c.query("select key, body_enc from app.ops where coll = 'privacyConfig'")).rows.map((r: any) => [r.key, decJson(k, r.body_enc)]));
    const tok = async (pid: string) => (await c.query('select app.patient_token($1) as t', [pid])).rows[0].t;
    const vipTokens = new Set<string>(); for (const pid of cfg.vip || []) { const t = await tok(pid); if (t) vipTokens.add(t); }
    const relatives: Record<string, string[]> = {}; for (const [u, pids] of Object.entries(cfg.staffRelations || {})) relatives[u] = (await Promise.all((pids as string[]).map(tok))).filter(Boolean);
    const names = Object.fromEntries((await c.query("select id, name from app.users where role <> 'patient'")).rows.map((r: any) => [r.id, r.name]));
    return { vipTokens, relatives, names, tz: 'America/Los_Angeles' };
  }
  app.get('/api/privacy/alerts', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    if (s.role !== 'admin') { await auditOnly(actor(s), req.ip, { action: 'privacy-scan', outcome: 'denied' }); return reply.code(403).send({ error: 'Not permitted.' }); }
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const fresh = req.query.refresh === '1' || !scan || Date.now() - scan.at > 60000;
      if (fresh) {
        // Only rows a rule can use: denials, emergency access, chart and FHIR reads, writes, reveals, and
        // non-clinical census rows (for the after-hours rule). Clinicians' census rows, the bulk of the
        // log, are left out. Indexed by time.
        const rows = (await c.query(`select seq, ts, actor, role, action, resource, patient_token, outcome, detail, purpose from audit.log
          where ts > now() - interval '30 days' and (outcome = 'denied' or action in ('break-the-glass', 'view-chart', 'fhir-read', 'phi-reveal') or action like 'write-%'
            or (action = 'census' and role not in ('doctor', 'nurse', 'pharmacist', 'patient'))) order by seq`)).rows;
        scan = { at: Date.now(), alerts: analyse(rows, await privacyCtx(c)), events: rows.length };
      }
      audit({ action: 'privacy-scan', detail: `${scan!.events} relevant events, ${scan!.alerts.length} alerts${fresh ? '' : ' (cached)'}` });
      return { alerts: scan!.alerts, scannedAt: new Date(scan!.at).toISOString() };
    });
  });
  app.post('/api/privacy/reveal', async (req: any, reply) => {
    const s = await requireUser(req, reply); if (!s) return;
    const token = String((req.body || {}).token || ''), why = String((req.body || {}).why || '').trim();
    if (s.role !== 'admin') return reply.code(403).send({ error: 'Not permitted.' });
    if (!/^PT-[0-9A-F]{6}$/.test(token) || why.length < 10) return reply.code(400).send({ error: 'Give the token and a privacy investigation reason (at least 10 characters).' });
    return withAudit(actor(s), req.ip, async (c, audit) => {
      const id = (await c.query('select id from app.patients_by_token($1)', [token])).rows[0]?.id;
      if (!id) { reply.code(404); return { error: 'No such token.' }; }
      const r = (await c.query('select * from app.patient_identity($1)', [id])).rows[0];
      const dek = kms.unwrap(r.dek_wrapped);
      audit({ action: 'privacy-identity-reveal', patient_token: token, purpose: 'Privacy investigation', detail: why.slice(0, 200) });
      return { name: decText(dek, r.name_enc), mrn: decText(dek, r.mrn_enc) };
    });
  });

  app.get('/api/health', async () => ({ ok: true }));
  /* Readiness: the database answers, the key service unwraps, and the audit chain head is readable. */
  app.get('/api/ready', async (_req, reply) => {
    const checks: Record<string, boolean> = {};
    try { await appPool.query('select 1'); checks.database = true; } catch { checks.database = false; }
    try { const c = await appPool.connect(); try { await orgKey(c); checks.keys = true; } finally { c.release(); } } catch { checks.keys = false; }
    try { await appPool.query('select max(seq) from audit.log'); checks.audit = true; } catch { checks.audit = false; }
    const ok = Object.values(checks).every(Boolean);
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
  /* Metrics in Prometheus text format: counts and timings by route template and status, no ids.
     Needs METRICS_TOKEN (scraper) or an administrator session. */
  app.get('/api/metrics', async (req: any, reply) => {
    const tok = process.env.METRICS_TOKEN;
    const okTok = tok && req.headers.authorization === `Bearer ${tok}`;
    if (!okTok) { const s = await session(req, 'active'); if (!s || s.role !== 'admin') return reply.code(403).send({ error: 'Not permitted.' }); }
    return reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.render());
  });
  app.setErrorHandler((err, _req, reply) => { if (!err.statusCode || err.statusCode >= 500) console.error('[api error]', err.message); reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : 'Something went wrong. Nothing was changed.' }); });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = build();
  await app.listen({ port: env.API_PORT, host: 'localhost' });
  // Signed write-once checkpoint of the audit chain every 5 minutes
  const cp = async () => { try { if (auditKey()) await writeCheckpoint(appPool, worm(), auditKey()!); } catch (e) { logLine({ msg: 'audit checkpoint failed', error: (e as Error).message }); } };
  await cp(); setInterval(cp, 5 * 60000).unref(); // same site as the app on localhost, so the SameSite=Strict cookie is sent
  console.log(`Tessera API on http://localhost:${env.API_PORT} (app origin ${env.APP_ORIGIN})`);
}
