import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
const absence = new Map<string, boolean>();
const visits: Array<{ id: string; schoolId: string; type: string; text: string; createdAt: string }> = [];

app.use("*", cors({ origin: "http://localhost:3000" }));
app.get("/health", (c) => c.json({ status: "ok", service: "rasd-api" }));
app.get("/api/overview", (c) => c.json({ schools: 150, members: 25, completion: 88, pending: 3 }));
app.put("/api/schools/:id/absence", async (c) => {
  const body = await c.req.json<{ date?: string; done?: boolean }>();
  if (!body.date || typeof body.done !== "boolean") return c.json({ error: "بيانات التحديث غير مكتملة" }, 400);
  const key = `${c.req.param("id")}:${body.date}`;
  absence.set(key, body.done);
  return c.json({ schoolId: c.req.param("id"), date: body.date, done: body.done, saved: true });
});
app.post("/api/visits", async (c) => {
  const body = await c.req.json<{ schoolId?: string; type?: string; text?: string }>();
  if (!body.schoolId || !body.type || !body.text || body.text.length < 10) return c.json({ error: "أكمل بيانات تقرير الزيارة" }, 400);
  const visit = { id: crypto.randomUUID(), schoolId: body.schoolId, type: body.type, text: body.text, createdAt: new Date().toISOString() };
  visits.push(visit);
  return c.json(visit, 201);
});
app.get("/api/ai/summary", (c) => c.json({ generatedAt: new Date().toISOString(), insights: ["ارتفع اكتمال البيانات بنسبة ٤٪", "ثلاثة أعضاء يحتاجون متابعة اليوم", "مؤشر الانضباط يتحسن في أربع مجموعات"], grounded: true }));
app.post("/api/uploads/presign", async (c) => {
  const body = await c.req.json<{ fileName?: string; mime?: string; size?: number }>();
  if (!body.fileName || !body.mime || !body.size) return c.json({ error: "بيانات الملف غير مكتملة" }, 400);
  if (body.size > 25 * 1024 * 1024) return c.json({ error: "حجم الملف يتجاوز ٢٥ ميجابايت" }, 413);
  return c.json({ mode: "demo", attachmentId: crypto.randomUUID(), message: "اربط بيانات R2 لتفعيل رابط الرفع الموقّع" });
});
app.get("/events", (c) => c.text("event: connected\ndata: {\"ok\":true}\n\n", 200, { "Content-Type": "text/event-stream" }));

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, ({ port }) => console.log(`Rasd API: http://localhost:${port}`));
