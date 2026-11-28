/* Phase 5: encrypted backups and a restore drill.
   backup: pg_dump of the whole database (custom format), encrypted with a fresh key that is wrapped by
   the master key, written to backend/backups/ (git-ignored, mode 600). Most columns are already
   ciphertext; this also covers the audit log and the plain routing columns.
   drill:  decrypts the newest backup, restores it into a scratch database, and proves it is usable:
   the audit chain verifies, row counts match the backup's manifest, and a patient's identifiers decrypt
   with the master key. Then drops the scratch database and reports how long it took.
   In AWS: RDS automated backups with point-in-time recovery, plus this logical backup to S3 with
   Object Lock; the drill runs against a restored instance. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import pg from 'pg';
import { kms, newDek, sealBytes, openBytes, decText } from './crypto.ts';
import { env } from './env.ts';

const BIN = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@15/bin';
const DIR = new URL('../backups/', import.meta.url).pathname;
const pgEnv = { ...process.env, PGPASSWORD: env.OWNER_PASSWORD, PGHOST: 'localhost', PGPORT: String(env.PGPORT), PGUSER: 'postgres', LC_ALL: 'en_US.UTF-8' };
const counts = async (db: string) => {
  const c = new pg.Client({ host: 'localhost', port: env.PGPORT, database: db, user: 'postgres', password: env.OWNER_PASSWORD }); await c.connect();
  try { const q = async (t: string) => +(await c.query(`select count(*) from ${t}`)).rows[0].count;
    return { patients: await q('app.patients'), records: await q('app.records'), ops: await q('app.ops'), users: await q('app.users'), audit: await q('audit.log') }; }
  finally { await c.end(); }
};

export async function backup() {
  mkdirSync(DIR, { recursive: true });
  const manifest = await counts('tessera');
  const dump = execFileSync(`${BIN}/pg_dump`, ['-Fc', 'tessera'], { env: pgEnv, maxBuffer: 1 << 30 });
  const dek = newDek(); const wrapped = kms.wrap(dek);
  const head = Buffer.from(JSON.stringify({ v: 1, at: new Date().toISOString(), manifest, wrapped: wrapped.toString('base64') }));
  const len = Buffer.alloc(4); len.writeUInt32BE(head.length);
  const file = `${DIR}tessera-${new Date().toISOString().replace(/[:.]/g, '-')}.dump.enc`;
  writeFileSync(file, Buffer.concat([Buffer.from('TSRB'), len, head, sealBytes(dek, dump)]), { mode: 0o600 });
  return { file, bytes: dump.length, manifest };
}

export async function drill(file?: string) {
  const t0 = Date.now();
  const f = file || DIR + readdirSync(DIR).filter((x) => x.endsWith('.dump.enc')).sort().pop();
  const buf = readFileSync(f);
  if (buf.subarray(0, 4).toString() !== 'TSRB') throw new Error('not a Tessera backup');
  const hl = buf.readUInt32BE(4); const head = JSON.parse(buf.subarray(8, 8 + hl).toString());
  const dump = openBytes(kms.unwrap(Buffer.from(head.wrapped, 'base64')), buf.subarray(8 + hl));
  const tmp = `${DIR}.drill.dump`; writeFileSync(tmp, dump, { mode: 0o600 });
  const admin = new pg.Client({ host: 'localhost', port: env.PGPORT, database: 'postgres', user: 'postgres', password: env.OWNER_PASSWORD }); await admin.connect();
  try {
    await admin.query('drop database if exists tessera_drill'); await admin.query('create database tessera_drill owner tessera_owner');
    execFileSync(`${BIN}/pg_restore`, ['-d', 'tessera_drill', '--exit-on-error', tmp], { env: pgEnv });
    const got = await counts('tessera_drill');
    const c = new pg.Client({ host: 'localhost', port: env.PGPORT, database: 'tessera_drill', user: 'tessera_owner', password: env.OWNER_PASSWORD }); await c.connect();
    let chain: any, sample = '';
    try {
      chain = (await c.query('select * from audit.verify()')).rows[0];
      const p = (await c.query('select dek_wrapped, name_enc from app.patients order by id limit 1')).rows[0];
      sample = decText(kms.unwrap(p.dek_wrapped), p.name_enc) || '';
    } finally { await c.end(); }
    const same = JSON.stringify(got) === JSON.stringify(head.manifest);
    return { ok: !!chain.ok && same && sample.length > 0, backupAt: head.at, restored: got, manifest: head.manifest, chain: chain.ok, decrypts: sample.length > 0, seconds: (Date.now() - t0) / 1000 };
  } finally { await admin.query('drop database if exists tessera_drill'); await admin.end(); rmSync(tmp, { force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === 'drill') { const r = await drill(); console.log(JSON.stringify({ ...r }, null, 1)); process.exit(r.ok ? 0 : 1); }
  const r = await backup(); console.log(`backup written: ${r.file.replace(DIR, 'backend/backups/')} (${(r.bytes / 1024).toFixed(0)} KB before encryption; ${r.manifest.patients} patients, ${r.manifest.audit} audit rows)`);
}
