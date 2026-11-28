/* Phase 5: write-once audit checkpoints. The hash chain in the database proves no single row was
   edited, but someone with schema rights could rebuild the whole chain. So every few minutes the head
   of the chain (last row number and hash, row count) is signed with a key the database never holds
   and written where it cannot be changed: a write-once directory locally (files created exclusively,
   then made read-only), an S3 bucket with Object Lock in compliance mode in production. Each checkpoint
   also signs the previous one, so a deleted checkpoint is noticed. Verification compares the live
   chain against every checkpoint. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export interface Checkpoint { seq: number; hash: string; count: number; at: string; prev: string; sig: string; }
export interface WormStore { put(name: string, body: string): Promise<void>; list(): Promise<string[]>; get(name: string): Promise<string>; }

export class LocalWorm implements WormStore {
  dir: string;
  constructor(dir: string) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  async put(name: string, body: string) { const f = join(this.dir, name); writeFileSync(f, body, { flag: 'wx', mode: 0o444 }); chmodSync(f, 0o444); } // 'wx': never overwrites
  async list() { return readdirSync(this.dir).filter((f) => /^checkpoint-\d{12}\.json$/.test(f)).sort(); }
  async get(name: string) { return readFileSync(join(this.dir, name), 'utf8'); }
}
/* Production: S3 PutObject with x-amz-object-lock-mode=COMPLIANCE and a retain-until date beyond the
   retention period (six years for HIPAA documentation), in a bucket created with Object Lock. Not
   wired here; it needs the AWS deployment (Phase 5b). */

const sign = (key: Buffer, c: Omit<Checkpoint, 'sig'>) => createHmac('sha256', key).update(JSON.stringify([c.seq, c.hash, c.count, c.at, c.prev])).digest('hex');
const name = (seq: number) => `checkpoint-${String(seq).padStart(12, '0')}.json`;

export async function writeCheckpoint(db: any, store: WormStore, key: Buffer) {
  const head = (await db.query('select seq, hash from audit.log order by seq desc limit 1')).rows[0];
  if (!head) return null;
  const count = +(await db.query('select count(*) from audit.log')).rows[0].count;
  const names = await store.list();
  const last = names.length ? JSON.parse(await store.get(names[names.length - 1])) as Checkpoint : null;
  if (last && last.seq === +head.seq) return last; // nothing new
  const c = { seq: +head.seq, hash: head.hash, count, at: new Date().toISOString(), prev: last ? last.sig : '' };
  const cp = { ...c, sig: sign(key, c) };
  await store.put(name(cp.seq), JSON.stringify(cp));
  return cp;
}

export async function verifyCheckpoints(db: any, store: WormStore, key: Buffer) {
  const problems: string[] = []; let prev = '';
  const names = await store.list();
  const chain = (await db.query('select * from audit.verify()')).rows[0];
  if (!chain.ok) problems.push(`hash chain broken at row ${chain.broken_at}`);
  const max = +((await db.query('select coalesce(max(seq), 0) as m from audit.log')).rows[0].m);
  for (const n of names) {
    const cp = JSON.parse(await store.get(n)) as Checkpoint;
    const { sig, ...rest } = cp;
    if (!timingSafeEqual(Buffer.from(sign(key, rest)), Buffer.from(String(sig).padEnd(64, '0').slice(0, 64)))) problems.push(`${n}: signature invalid`);
    if (cp.prev !== prev) problems.push(`${n}: does not follow the previous checkpoint (one is missing or replaced)`);
    prev = cp.sig;
    if (cp.seq > max) { problems.push(`${n}: the log ends at row ${max}, before this checkpoint (rows were removed)`); continue; }
    const row = (await db.query('select hash from audit.log where seq = $1', [cp.seq])).rows[0];
    if (!row) problems.push(`${n}: row ${cp.seq} is missing`);
    else if (row.hash !== cp.hash) problems.push(`${n}: row ${cp.seq} no longer matches (the chain was rebuilt)`);
    const cnt = +(await db.query('select count(*) from audit.log where seq <= $1', [cp.seq])).rows[0].count;
    if (cnt !== cp.count) problems.push(`${n}: ${cp.count} rows were signed up to ${cp.seq}, ${cnt} are there now`);
  }
  return { ok: problems.length === 0, checkpoints: names.length, chain: chain.ok, problems };
}
