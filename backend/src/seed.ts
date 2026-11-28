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

const root = new URL('../../tessera/', import.meta.url);
const ctx: any = { window: {}, console };
vm.createContext(ctx);
for (const f of ['data.js', 'data2.js', 'data3.js', 'data4.js']) vm.runInContext(readFileSync(new URL(f, root), 'utf8'), ctx, { filename: f });
const SEED = ctx.window.TESSERA_SEED;

const db = ownerPool(); const c = await db.connect();
await c.query('begin');
await c.query('truncate app.sessions, app.btg_grants, app.care_relationships, app.patients, app.users cascade');

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
  await c.query(`insert into app.patients (id, token, dek_wrapped, name_enc, dob_enc, mrn_enc, phone_enc, member_id_enc, payer_enc, clinical_enc, name_idx, mrn_idx, age, sex, dept, consults, unit, bed, status, code, attending)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [p.id, patientToken(p.mrn), kms.wrap(dek), encField(dek, p.name), encField(dek, p.dob), encField(dek, p.mrn), encField(dek, p.phone), encField(dek, p.memberId), encField(dek, p.payer), encField(dek, clinical),
      blindIndex(p.name), blindIndex(p.mrn), p.age, p.sex, p.dept ?? null, p.consults ?? [], p.unit ?? null, p.bed ?? null, p.status ?? null, p.code ?? null, p.attending ?? null]);
}

// Care relationships, mirroring careRel() in tessera/app.js
const groups = SEED.unitGroups || {};
let n = 0;
const rel = async (uid: string, pid: string, kind: string) => { await c.query('insert into app.care_relationships values ($1,$2,$3) on conflict do nothing', [uid, pid, kind]); n++; };
for (const u of SEED.users) for (const p of SEED.patients) {
  if (u.role === 'doctor') {
    if (p.dept === u.dept) await rel(u.id, p.id, 'department');
    if ((p.consults || []).includes(u.dept)) await rel(u.id, p.id, 'consult');
    if (u.dept === 'EMER' && (SEED.er || []).some((e: any) => e.patient === p.id)) await rel(u.id, p.id, 'emergency');
  }
  if (u.role === 'nurse') {
    if (p.unit && (p.unit === u.unit || (groups[u.unit] || []).includes(p.unit))) await rel(u.id, p.id, 'unit');
    if (u.unit === 'PERIOP' && (SEED.ot || []).some((o: any) => o.patient === p.id)) await rel(u.id, p.id, 'theatre');
  }
}
await c.query('commit'); c.release(); await db.end();
writeFileSync(new URL('../.dev-credentials.json', import.meta.url), JSON.stringify(creds, null, 1), { mode: 0o600 });
console.log(`seeded ${SEED.users.length} users, ${SEED.patients.length} patients, ${n} care relationships; development credentials in backend/.dev-credentials.json (git-ignored)`);
