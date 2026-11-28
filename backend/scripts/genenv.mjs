// Writes backend/.env with random development secrets (never committed). Production gets these from
// AWS Secrets Manager and uses AWS KMS instead of KEK_HEX.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
const f = new URL('../.env', import.meta.url);
if (existsSync(f)) process.exit(0);
const r = (n) => randomBytes(n).toString('hex');
writeFileSync(f, [`PGPORT=54329`, `OWNER_PASSWORD=${r(18)}`, `APP_PASSWORD=${r(18)}`, `KEK_HEX=${r(32)}`, `INDEX_KEY_HEX=${r(32)}`, `SESSION_PEPPER_HEX=${r(32)}`, `AUDIT_SIGNING_KEY_HEX=${r(32)}`, `API_PORT=8787`, `APP_ORIGIN=http://localhost:8765`, ''].join('\n'), { mode: 0o600 });
console.log('wrote backend/.env with random development secrets');
