import "./env.js";
import { serve } from "@hono/node-server";
import { seedAccounts } from "./accounts.js";
import { app } from "./app.js";
import { env } from "./env.js";

seedAccounts();

const port = Number(env("PORT") ?? 4000);
serve({ fetch: app.fetch, port }, ({ port }) => console.log(`Rasd API: http://localhost:${port}`));
