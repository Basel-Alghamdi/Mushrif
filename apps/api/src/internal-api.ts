// The agent's way into the head's API: the same routes the web app calls (same checks, transactions and audit), run
// in-process as رئيسة النطاق with source "agent". It is never mounted on the network app; a request without the private
// symbol, or one that came over the network (node's `incoming` binding), is refused. Only routes in the agent's
// catalog answer — matched by method and the route's own path, never by the raw URL.
import { Hono } from "hono";
import { routePath } from "hono/route";
import { catalogEntry } from "./agent/catalog.js";
import { errorResponse } from "./app.js";
import { loadActor, type Actor, type AppEnv } from "./auth.js";
import { fail, forbidden } from "./errors.js";
import { districtRoutes } from "./routes/district.js";
import { documentRoutes } from "./routes/documents.js";
import { folderRoutes } from "./routes/folders.js";
import { kpiRoutes } from "./routes/kpis.js";
import { memberRoutes } from "./routes/member.js";

const INTERNAL = Symbol("rasd.internal");
type InternalBindings = { [INTERNAL]?: { actor: Actor; ip: string | null }; incoming?: unknown };

export const internalApi = new Hono<AppEnv>();

internalApi.use("*", async (c, next) => {
  const bindings = c.env as InternalBindings | undefined;
  const internal = bindings?.[INTERNAL];
  if (!internal || bindings?.incoming) return c.json(fail("UNAUTHENTICATED", "هذا المسار داخلي"), 401);
  c.set("actor", internal.actor);
  c.set("source", "agent");
  c.set("ip", internal.ip);
  await next();
});

// Fails closed: a route outside the catalog (chat, reminders, uploads…) never runs, even if a module registers it here.
internalApi.use("*", async (c, next) => {
  if (!catalogEntry(c.req.method, routePath(c, -1))) return c.json(fail("NOT_FOUND", "هذا الإجراء غير متاح للمساعد"), 404);
  await next();
});

districtRoutes(internalApi);
memberRoutes(internalApi);
documentRoutes(internalApi);
folderRoutes(internalApi);
kpiRoutes(internalApi);

internalApi.onError(errorResponse);
internalApi.notFound(c => c.json(fail("NOT_FOUND", "المسار غير موجود"), 404));

export type InternalResult = { status: number; data: unknown; error: { code: string; message: string; fields?: Record<string, string> } | null };

/** One request as the head (JSON in, JSON out). The path is built by the catalog, never taken from the model. */
export async function callInternal(head: Actor, method: string, path: string, body?: unknown, ip: string | null = null): Promise<InternalResult> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await internalApi.fetch(new Request(`http://agent.internal${path}`, init), { [INTERNAL]: { actor: head, ip } });
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return { status: 502, data: null, error: { code: "NOT_JSON", message: "استجابة غير متوقعة" } };
  }
  const json = await response.json() as { data?: unknown; error?: InternalResult["error"] };
  return { status: response.status, data: json.data ?? null, error: json.error ?? null };
}

/** The head as she is now — re-read for every turn and every approval, never taken from a stored payload. */
export async function currentHead(id: string): Promise<Actor> {
  const row = await loadActor(id);
  if (!row || row.role !== "head" || row.deletedAt) throw forbidden("هذه العملية متاحة لرئيسة النطاق فقط");
  const { activatedAt: _activated, sessionsValidAfter: _sessions, deletedAt: _deleted, ...actor } = row;
  return actor;
}
