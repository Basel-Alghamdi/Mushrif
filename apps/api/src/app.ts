import { Hono } from "hono";
import { cors } from "hono/cors";
import { messages } from "@rasd/schemas";
import { authenticate, requireMember, type AppEnv } from "./auth.js";
import { sql } from "./db.js";
import { env } from "./env.js";
import { ApiError, fail, ok } from "./errors.js";
import { accessRoutes } from "./routes/access.js";
import { aiRoutes } from "./routes/ai.js";
import { chatRoutes } from "./routes/chat.js";
import { districtRoutes, notificationRoutes } from "./routes/district.js";
import { documentRoutes } from "./routes/documents.js";
import { memberRoutes } from "./routes/member.js";

export const app = new Hono<AppEnv>();

app.use("*", cors({
  origin: origin => (env.corsOrigins.includes(origin) ? origin : null),
  allowHeaders: ["Content-Type", "Authorization", "X-Rasd-Source"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));

app.get("/health", async c => {
  await sql`select 1`;
  return c.json({ status: "ok", service: "rasd-api", version: "v1" });
});

const api = new Hono<AppEnv>();
api.use("*", async (c, next) => (c.req.path.startsWith("/api/v1/public/") ? next() : authenticate(c, next)));

accessRoutes(api);
memberRoutes(api);
districtRoutes(api);
notificationRoutes(api);
aiRoutes(api);
documentRoutes(api);
chatRoutes(api);

// Not built yet (smart import). They answer honestly instead of pretending to succeed.
const notYet = (message: string) => () => { throw new ApiError(501, "NOT_IMPLEMENTED", message); };
api.get("/ingest/jobs", async c => {
  const actor = requireMember(c);
  return c.json(ok(await sql`select * from ingest_jobs where cluster_id = ${actor.clusterId} and deleted_at is null order by created_at desc`));
});
api.post("/ingest/upload", notYet("الاستيراد الذكي قيد التطوير — لم يُرفع أي ملف"));
api.post("/ingest/apply", notYet("الاستيراد الذكي قيد التطوير"));

app.route("/api/v1", api);

app.notFound(c => c.json(fail("NOT_FOUND", "المسار غير موجود"), 404));

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json(fail(error.code, error.message, error.fields, error.details), error.status);
  const pg = error as { code?: string; constraint_name?: string };
  if (pg.code === "23505") {
    if (pg.constraint_name === "schools_ministry_no_unique") return c.json(fail("DUPLICATE", messages.ministryNoTaken, { ministryNo: messages.ministryNoTaken }), 409);
    return c.json(fail("DUPLICATE", "القيمة مستخدمة مسبقاً"), 409);
  }
  if (pg.code === "23514" || pg.code === "22P02" || pg.code === "23502" || pg.code === "22001") {
    return c.json(fail("VALIDATION_ERROR", "البيانات غير صحيحة"), 422);
  }
  console.error(error);
  return c.json(fail("INTERNAL", "حدث خطأ غير متوقع — أعيدي المحاولة"), 500);
});
