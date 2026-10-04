// A real PostgreSQL 17 for local runs and tests (npm embedded-postgres), plus the small part of a Supabase project
// the schema expects: the anon/authenticated/service_role roles, the extensions schema and a minimal auth schema.
// Local only — this never touches a Supabase project.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

export const SUPABASE_SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{"provider": "email", "providers": ["email"]}',
  raw_user_meta_data jsonb not null default '{}',
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists auth.one_time_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_type text not null,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$fn$;
`;

export type LocalPostgres = { url: string; stop: () => Promise<void> };

/** A stale lock file from a hard-killed run would stop the server from starting. */
function removeStaleLock(databaseDir: string) {
  const lock = join(databaseDir, "postmaster.pid");
  if (!existsSync(lock)) return;
  const pid = Number(readFileSync(lock, "utf8").split(/\r?\n/)[0]);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { alive = false; }
  if (!alive) rmSync(lock, { force: true });
}

/**
 * Starts PostgreSQL in `dir/pg` on `port` (initialised on first use) and applies the Supabase shim.
 * `persistent: false` deletes the data directory on stop (tests).
 */
export async function startPostgres(options: { dir: string; port: number; persistent?: boolean; log?: (line: string) => void }): Promise<LocalPostgres> {
  const databaseDir = join(options.dir, "pg");
  const server = new EmbeddedPostgres({
    databaseDir, port: options.port, user: "postgres", password: "postgres", persistent: options.persistent ?? true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: line => options.log?.(line), onError: error => options.log?.(String(error)),
  });
  if (!existsSync(join(databaseDir, "PG_VERSION"))) await server.initialise();
  removeStaleLock(databaseDir);
  await server.start().catch(() => { throw new Error(`PostgreSQL did not start on port ${options.port} (is the port in use?)`); });
  const url = `postgres://postgres:postgres@127.0.0.1:${options.port}/postgres`;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try { await sql.unsafe(SUPABASE_SHIM); } finally { await sql.end(); }
  return { url, stop: () => server.stop() };
}
