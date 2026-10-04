import postgres from "postgres";
import { env } from "./env.js";

// Column names are snake_case in Postgres and camelCase in code; postgres.camel converts both ways.
// prepare:false keeps us compatible with Supabase's transaction pooler (port 6543).
export const sql = postgres(env.databaseUrl, {
  prepare: false,
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  idle_timeout: 20,
  transform: postgres.camel,
  onnotice: () => {},
});

export type Sql = postgres.Sql | postgres.TransactionSql;
export type Row = Record<string, any>;

/** Runs `fn` atomically: in a new transaction on the root client, or in a savepoint inside an open transaction. */
export const atomically = <T>(db: Sql, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  ("savepoint" in db ? db.savepoint(fn) : db.begin(fn)) as Promise<T>;
