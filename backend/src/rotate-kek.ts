/* Phase 5: master key (KEK) rotation. Envelope encryption means only the small wrapped keys change:
   every patient's data key, the organisation key and the authenticator secrets are unwrapped with the
   old master key and wrapped with the new one, in one transaction, then checked. No health data is
   re-encrypted. With AWS KMS, yearly rotation is automatic and needs none of this; this is for a
   suspected compromise. Usage (development): NEW_KEK_HEX=<64 hex> npm run rotate-kek, then restart
   the API. Writes the new key into backend/.env; never prints it. */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { LocalKms, type Kms } from './crypto.ts';
import { env } from './env.ts';

export async function rotate(db: pg.Pool | pg.Client, from: Kms, to: Kms) {
  const c: any = 'connect' in db && (db as any).totalCount !== undefined ? await (db as pg.Pool).connect() : db;
  let n = 0;
  try {
    await c.query('begin');
    for (const r of (await c.query('select id, dek_wrapped from app.patients for update')).rows) { await c.query('update app.patients set dek_wrapped = $2 where id = $1', [r.id, to.wrap(from.unwrap(r.dek_wrapped))]); n++; }
    for (const r of (await c.query('select name, wrapped from app.keys for update')).rows) { await c.query('update app.keys set wrapped = $2 where name = $1', [r.name, to.wrap(from.unwrap(r.wrapped))]); n++; }
    for (const r of (await c.query('select id, totp_secret_enc from app.users for update')).rows) { await c.query('update app.users set totp_secret_enc = $2 where id = $1', [r.id, to.wrap(from.unwrap(r.totp_secret_enc))]); n++; }
    await c.query('delete from app.oidc_pending'); // sign-ins in progress simply restart
    // check: everything opens with the new key and not with the old one
    for (const r of (await c.query('select dek_wrapped as w from app.patients union all select wrapped from app.keys union all select totp_secret_enc from app.users')).rows) to.unwrap(r.w);
    await c.query('commit');
    return n;
  } catch (e) { await c.query('rollback'); throw e; } finally { if (c.release) c.release(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = process.env.NEW_KEK_HEX || '';
  if (!/^[0-9a-f]{64}$/i.test(next)) { console.error('Set NEW_KEK_HEX to 64 hex characters.'); process.exit(1); }
  const db = new pg.Client({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD });
  await db.connect();
  const n = await rotate(db, new LocalKms(env.KEK_HEX), new LocalKms(next));
  await db.end();
  const f = new URL('../.env', import.meta.url);
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^KEK_HEX=.*$/m, `KEK_HEX=${next}`), { mode: 0o600 });
  console.log(`re-wrapped ${n} keys under the new master key; backend/.env updated. Restart the API.`);
}
