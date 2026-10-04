// Applies supabase/migrations/*.sql in order, each in its own transaction.
// Applied versions are recorded in supabase_migrations.schema_migrations — the same table the Supabase CLI uses,
// so `supabase db push` / `supabase migration list` agree with this runner later.
// Needs only a database URL: DIRECT_DATABASE_URL (direct connection, port 5432) or, failing that, DATABASE_URL.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import "../src/load-env.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL to run migrations (see .env.example)");
  process.exit(1);
}
const directory = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const sql = postgres(databaseUrl, { prepare: false, onnotice: () => {} });

try {
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`;
  const applied = new Set((await sql`select version from supabase_migrations.schema_migrations`).map(row => String(row.version)));
  const files = readdirSync(directory).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  let count = 0;
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (applied.has(version)) continue;
    const content = readFileSync(`${directory}${file}`, "utf8");
    await sql.begin(async tx => {
      await tx.unsafe(content);
      await tx`insert into supabase_migrations.schema_migrations (version, statements, name) values (${version}, ${[content]}, ${rest.join("_")})`;
    });
    console.log(`applied ${file}`);
    count += 1;
  }
  console.log(count ? `${count} migration(s) applied` : "database is up to date");
} finally {
  await sql.end();
}
