import "./env.js";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { warmJwks } from "./auth.js";
import { sql } from "./db.js";
import { env } from "./env.js";

/** Connections opened at start, so the first clicks after a deploy do not each wait for one. */
const WARM_CONNECTIONS = 4;

serve({ fetch: app.fetch, port: env.port }, ({ port }) => {
  console.log(`Rasd API: http://localhost:${port}`);
  // The database and Supabase are far away: open connections and fetch the token signing keys before anyone asks.
  Promise.all([...Array.from({ length: WARM_CONNECTIONS }, () => sql`select 1`), warmJwks()])
    .catch(error => console.error("warm-up failed (requests will connect on demand):", error instanceof Error ? error.message : error));
});
