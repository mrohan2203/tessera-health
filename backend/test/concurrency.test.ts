/* The audit chain must stay intact when many requests write at once. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { withAudit, appPool } from '../src/db.ts';
import { env } from '../src/env.ts';
env.RATE_LIMITS = false; process.env.TESSERA_QUIET = '1';
after(async () => { await appPool.end(); });
test('50 concurrent audited transactions keep the chain verifiable', async () => {
  await Promise.all(Array.from({ length: 50 }, (_, i) => withAudit({ id: 'U-1001', role: 'admin' }, '127.0.0.1', async (c, a) => { await c.query('select pg_sleep(random() * 0.02)'); a({ action: 'concurrency-test', detail: String(i) }); })));
  const r = (await appPool.query('select * from audit.verify()')).rows[0];
  assert.equal(r.ok, true, `chain broken at ${r.broken_at}`);
  // The 50 rows were written one after another: consecutive numbers, each linked to the one before.
  // (Across the whole log a rolled-back transaction can leave a gap in numbering; the hash links, not
  // the numbers, are what prove nothing was removed.)
  const mine = (await appPool.query("select seq from audit.log where action = 'concurrency-test' order by seq desc limit 50")).rows.map((r) => +r.seq).reverse();
  assert.equal(mine[49] - mine[0], 49, 'the concurrent rows are not consecutive');
});
