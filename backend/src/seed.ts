/* Seeds the database from the app's own synthetic data (tessera/data*.js), so demo and live mode
   share one dataset. Runs as tessera_owner.
   - Patients: identifiers and clinical content encrypted under a fresh per-patient data key.
   - Care relationships: built with the same rules the app uses (department, consults, unit and unit
     groups, emergency board, operating theatre cases).
   - Users: a random development password and an authenticator (TOTP) secret each, written only to
     backend/.dev-credentials.json (git-ignored). Production accounts come from the identity provider. */
import vm from 'node:vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ownerPool } from './db.ts';
import { kms, newDek, encField, blindIndex, hashPassword, newTotpSecret, sealWithKek, patientToken } from './crypto.ts';
import { POLICY } from './policy.ts';
import { relationsFor } from './care.ts';

const root = new URL('../../tessera/', import.meta.url);
const ctx: any = { window: {}, console };
vm.createContext(ctx);
for (const f of ['data.js', 'data2.js', 'data3.js', 'data4.js']) vm.runInContext(readFileSync(new URL(f, root), 'utf8'), ctx, { filename: f });
const SEED = ctx.window.TESSERA_SEED;

const db = ownerPool(); const c = await db.connect();
await c.query('begin');
await c.query('truncate app.ops_versions, app.ops, app.keys, app.record_versions, app.records, app.sessions, app.btg_grants, app.care_relationships, app.patients, app.users cascade');

const creds: Record<string, { password: string; totpSecret: string; role: string; name: string }> = {};
for (const u of SEED.users) {
  const password = randomBytes(12).toString('base64url'); const secret = newTotpSecret();
  creds[u.username] = { password, totpSecret: secret, role: u.role, name: u.name };
  await c.query('insert into app.users (id, username, name, role, dept, unit, title, patient_id, status, password_hash, totp_secret_enc) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    // A portal account's name is the patient's name, which is PHI: it lives only in the encrypted patient record
    [u.id, u.username, u.role === 'patient' ? 'Patient portal account' : u.name, u.role, u.dept ?? null, u.unit ?? null, u.title ?? null, u.patientId ?? null, u.status === 'suspended' ? 'suspended' : 'active', hashPassword(password), sealWithKek(secret)]);
}

for (const p of SEED.patients) {
  const dek = newDek();
  const clinical = { problems: p.problems, allergies: p.allergies, allergiesUnknown: !!p.allergiesUnknown, vitals: p.vitals, meds: p.meds, labs: p.labs, weightKg: p.weightKg, heightCm: p.heightCm };
  await c.query(`insert into app.patients (id, token, dek_wrapped, name_enc, dob_enc, mrn_enc, phone_enc, member_id_enc, payer_enc, clinical_enc, name_idx, mrn_idx, dob_idx, age, sex, dept, consults, unit, bed, status, code, attending)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [p.id, patientToken(p.mrn), kms.wrap(dek), encField(dek, p.name), encField(dek, p.dob), encField(dek, p.mrn), encField(dek, p.phone), encField(dek, p.memberId), encField(dek, p.payer), encField(dek, { ...clinical, bloodGroup: p.bloodGroup, unidentified: !!p.unidentified, alias: p.alias || '' }),
      blindIndex(p.name), blindIndex(p.mrn), p.dob ? blindIndex('dob|' + p.dob) : null, p.age, p.sex, p.dept ?? null, p.consults ?? [], p.unit ?? null, p.bed ?? null, p.status ?? null, p.code ?? null, p.attending ?? null]);
}

// Care relationships, with the same rules as careRel() in tessera/app.js (src/care.ts)
const FIX = JSON.parse(readFileSync(new URL('../seed/initial-state.json', import.meta.url), 'utf8'));
let n = 0;
for (const p of SEED.patients) for (const r of relationsFor(SEED.users, p, { unitGroups: FIX.unitGroups || {}, onEr: (FIX.er || []).some((e: any) => e.patient === p.id), inOt: (FIX.ot || []).some((o: any) => o.patient === p.id) })) {
  await c.query('insert into app.care_relationships values ($1,$2,$3) on conflict do nothing', [r.user, p.id, r.kind]); n++;
}

/* Records: the app's own starting state (seed/initial-state.json, made by tools/dump_initial_state.py).
   Patient-linked items are encrypted under their patient's key; operational ones under the organisation
   key. Items with no id get a stable _k so the app and the server agree on identity. */
const deks = new Map<string, Buffer>();
for (const p of SEED.patients) { const r = await c.query('select dek_wrapped from app.patients where id = $1', [p.id]); deks.set(p.id, kms.unwrap(r.rows[0].dek_wrapped)); }
const orgDek = newDek();
await c.query("insert into app.keys (name, wrapped) values ('ops', $1)", [kms.wrap(orgDek)]);
const by = (pid?: string) => (pid && SEED.patients.find((p: any) => p.id === pid)?.attending) || SEED.users.find((u: any) => u.role === 'admin').id;
const st = FIX.state;
let nrec = 0, nops = 0;
const rec = async (coll: string, key: string, pid: string, body: unknown) => {
  if (!deks.has(pid)) return;
  await c.query('insert into app.records (coll, key, patient_id, body_enc, created_by, updated_by) values ($1,$2,$3,$4,$5,$5)', [coll, key, pid, encField(deks.get(pid)!, body), by(pid)]); nrec++;
};
const op = async (coll: string, key: string, body: unknown) => {
  await c.query('insert into app.ops (coll, key, body_enc, created_by, updated_by) values ($1,$2,$3,$4,$4)', [coll, key, encField(orgDek, JSON.stringify(body === undefined ? null : body)), by()]); nops++;
};
for (const [coll, pol] of Object.entries(POLICY)) {
  const v = st[coll]; if (v === undefined) continue;
  if (pol.scalar) { await op(coll, '_', v); continue; }
  if (pol.arr) {
    for (const [i, x0] of (v as any[]).entries()) {
      const x = x0 && typeof x0 === 'object' && !x0.id ? { ...x0, _k: `${coll}-${i}` } : x0;
      const key = x.id || x._k;
      if (pol.pt) await rec(coll, key, x.patient, x); else await op(coll, key, x);
    }
    continue;
  }
  for (const [k, x] of Object.entries(v as any)) {
    if (!pol.pt) { await op(coll, k, x); continue; }
    const pid = pol.pt === 'key' ? k : pol.pt === 'mar' ? k.split('|')[0] : pol.pt === 'order' ? (st.orders || []).find((o: any) => o.id === k)?.patient : (st.discharges || []).find((d: any) => d.id === k)?.patient;
    if (pid) await rec(coll, k, pid, x);
  }
}
await c.query('commit'); c.release(); await db.end();
writeFileSync(new URL('../.dev-credentials.json', import.meta.url), JSON.stringify(creds, null, 1), { mode: 0o600 });
console.log(`seeded ${SEED.users.length} users, ${SEED.patients.length} patients, ${n} care relationships, ${nrec} patient records, ${nops} operational records; development credentials in backend/.dev-credentials.json (git-ignored)`);
