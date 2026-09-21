import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, ({ port }) => console.log(`Rasd API: http://localhost:${port}`));
