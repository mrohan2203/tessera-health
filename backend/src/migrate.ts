/* Creates the roles and database (once, as the local superuser) and applies migrations/*.sql in
   order as tessera_owner. Safe to re-run: applied migrations are recorded in public.schema_migrations. */
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { env } from './env.ts';

const su = new pg.Client({ host: 'localhost', port: env.PGPORT, database: 'postgres', user: 'postgres', password: env.OWNER_PASSWORD });
await su.connect();
const role = async (name: string, pw: string) => {
  const r = await su.query('select 1 from pg_roles where rolname = $1', [name]);
  if (!r.rowCount) await su.query(`create role ${name} login password '${pw.replace(/'/g, "''")}'`);
};
await role('tessera_owner', env.OWNER_PASSWORD);
await role('tessera_app', env.APP_PASSWORD);
if (!(await su.query("select 1 from pg_database where datname = 'tessera'")).rowCount) await su.query('create database tessera owner tessera_owner');
await su.end();

const suDb = new pg.Client({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'postgres', password: env.OWNER_PASSWORD });
await suDb.connect();
await suDb.query('create extension if not exists pgcrypto');
await suDb.query('revoke all on database tessera from public');
await suDb.query('grant connect on database tessera to tessera_app');
await suDb.end();

const own = new pg.Client({ host: 'localhost', port: env.PGPORT, database: 'tessera', user: 'tessera_owner', password: env.OWNER_PASSWORD });
await own.connect();
await own.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
const done = new Set((await own.query('select name from public.schema_migrations')).rows.map((r) => r.name));
const dir = new URL('../migrations/', import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  await own.query('begin');
  try { await own.query(readFileSync(new URL(f, dir), 'utf8')); await own.query('insert into public.schema_migrations (name) values ($1)', [f]); await own.query('commit'); console.log('applied', f); }
  catch (e) { await own.query('rollback'); console.error('failed', f, (e as Error).message); process.exitCode = 1; break; }
}
await own.end();
