/* The audit chain must stay intact when many requests write at once. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { withAudit, appPool } from '../src/db.ts';
after(async () => { await appPool.end(); });
test('50 concurrent audited transactions keep the chain verifiable', async () => {
  await Promise.all(Array.from({ length: 50 }, (_, i) => withAudit({ id: 'U-1001', role: 'admin' }, '127.0.0.1', async (c, a) => { await c.query('select pg_sleep(random() * 0.02)'); a({ action: 'concurrency-test', detail: String(i) }); })));
  const r = (await appPool.query('select * from audit.verify()')).rows[0];
  assert.equal(r.ok, true, `chain broken at ${r.broken_at}`);
  const gaps = (await appPool.query('select count(*) from (select seq - lag(seq) over (order by seq) as d from audit.log) x where d <> 1')).rows[0].count;
  assert.equal(gaps, '0', 'row numbers have gaps');
});
