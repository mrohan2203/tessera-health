/* npm run audit:checkpoint — write a signed write-once checkpoint of the audit chain now.
   npm run audit:verify     — check the live chain against every checkpoint. */
import { appPool } from './db.ts';
import { env } from './env.ts';
import { LocalWorm, writeCheckpoint, verifyCheckpoints } from './worm.ts';
const key = Buffer.from(env.AUDIT_SIGNING_KEY_HEX, 'hex'); const store = new LocalWorm(env.WORM_DIR);
if (!env.AUDIT_SIGNING_KEY_HEX) { console.error('AUDIT_SIGNING_KEY_HEX is not set'); process.exit(1); }
if (process.argv[2] === 'checkpoint') { const c = await writeCheckpoint(appPool, store, key); console.log(c ? `checkpoint at row ${c.seq}` : 'empty log'); }
else { const r = await verifyCheckpoints(appPool, store, key); console.log(JSON.stringify(r, null, 1)); process.exitCode = r.ok ? 0 : 1; }
await appPool.end();
