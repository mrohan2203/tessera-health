/* Database access. The API connects as tessera_app (no DDL, row-level security on patients,
   insert-only audit). Every request that touches health data runs in one transaction that:
     1. sets the caller's identity for row-level security (app.user_id, app.role, app.patient_id)
     2. does the work
     3. writes the audit row
   If the audit insert fails, the whole transaction rolls back: no access without a record. */
import pg from 'pg';
import { env } from './env.ts';

export const appPool = new pg.Pool({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_app', password: env.APP_PASSWORD, max: 10 });
export const ownerPool = () => new pg.Pool({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD, max: 2 });

export interface Actor { id: string; role: string; patient_id?: string | null; }
export interface AuditEntry { action: string; resource?: string; patient_token?: string; purpose?: string; outcome?: string; detail?: string; }

export async function withAudit<T>(actor: Actor | null, ip: string, work: (c: pg.PoolClient, audit: (e: AuditEntry) => void) => Promise<T>): Promise<T> {
  const c = await appPool.connect();
  const entries: AuditEntry[] = [];
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.role', $2, true), set_config('app.patient_id', $3, true)", [actor?.id ?? '', actor?.role ?? 'anonymous', actor?.patient_id ?? '']);
    const out = await work(c, (e) => entries.push(e));
    for (const e of entries) {
      await c.query('insert into audit.log (actor, role, action, resource, patient_token, purpose, outcome, detail, ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [actor?.id ?? 'anonymous', actor?.role ?? '—', e.action, e.resource ?? '', e.patient_token ?? '', e.purpose ?? '', e.outcome ?? 'success', e.detail ?? '', ip]);
    }
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally { c.release(); }
}

/* Denials must be recorded even though the request fails: written in their own transaction. */
export async function auditOnly(actor: Actor | null, ip: string, e: AuditEntry) { await withAudit(actor, ip, async (_c, a) => { a(e); }); }
