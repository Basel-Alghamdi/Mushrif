import type { Hono } from "hono";
import { riyadhDate } from "@rasd/schemas";
import { audit } from "../audit.js";
import { requireHead, type Actor, type AppEnv } from "../auth.js";
import { sql } from "../db.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { isUuid, readBody } from "../parse.js";
import { loadWorkspaces } from "../workspace.js";
import { buildReport, loadDistrict, sendReminders } from "./district.js";

type Citation = { entity: string; id: string; date: string };

// Grounded answers computed directly from the database. The OpenAI-backed assistant replaces the wording, not the grounding:
// every number still comes from these queries and carries a citation (SPEC §7.3).
async function districtAnswer(head: Actor) {
  const today = riyadhDate();
  const { members } = await loadDistrict(sql, head.districtId);
  const [{ pending }] = await sql`select count(*)::int as pending from invitations where district_id = ${head.districtId} and status = 'pending' and expires_at > now()`;
  if (!members.length) return { text: `لم تنضم أي عضوة بعد. توجد ${pending} دعوات بانتظار القبول.`, citations: [] as Citation[] };
  const report = buildReport(members, pending, today);
  const missing = members.filter(item => item.summary.submission === "missing").map(item => item.summary.name);
  const incomplete = members.filter(item => item.summary.completion < 85).map(item => `${item.summary.name} (${item.summary.completion}٪)`);
  const text = [
    report.summaryText,
    missing.length ? `لم تحدّث ملفها اليوم: ${missing.join("، ")}.` : "حدّثت جميع العضوات ملفاتهن اليوم.",
    incomplete.length ? `ملفات دون ٨٥٪ اكتمال: ${incomplete.join("، ")}.` : "",
  ].filter(Boolean).join("\n");
  const citations = members.map(item => ({ entity: "cluster", id: item.summary.clusterId, date: today }));
  return { text, citations };
}

async function clusterAnswer(actor: Actor) {
  const today = riyadhDate();
  const workspace = (await loadWorkspaces(sql, [actor.clusterId!])).get(actor.clusterId!)!;
  const missingAbsence = workspace.schools.filter(school => !school.absenceToday).map(school => school.name);
  const missingPlans = workspace.plans.filter(plan => plan.status !== "uploaded").map(plan => plan.label);
  const text = [
    `اكتمال ملفك ${workspace.completion}٪ ويضم ${workspace.schools.length} مدارس.`,
    missingAbsence.length ? `لم يُثبّت الغياب اليوم في: ${missingAbsence.join("، ")}.` : "ثُبّت الغياب في جميع المدارس اليوم.",
    missingPlans.length ? `خطط لم تُرفع: ${missingPlans.join("، ")}.` : "رُفعت جميع الخطط.",
    workspace.cluster.submittedToday ? "حدّثتِ ملفك اليوم." : "لم تحدّثي ملفك اليوم بعد.",
  ].join("\n");
  return { text, citations: [{ entity: "cluster", id: workspace.cluster.id, date: today }] };
}

export function aiRoutes(app: Hono<AppEnv>) {
  app.post("/ai/chat", async c => {
    const actor = c.get("actor");
    const body = await readBody(c);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw invalid({ message: "اكتبي سؤالك" });
    const answer = actor.role === "head" ? await districtAnswer(actor) : await clusterAnswer(actor);
    await sql`insert into chat_messages ${sql({ userId: actor.id, role: "user", text: message.slice(0, 4000) })}`;
    await sql`insert into chat_messages ${sql({ userId: actor.id, role: "assistant", text: answer.text, citations: sql.json(answer.citations) })}`;
    return c.json(ok({ ...answer, grounded: true }));
  });

  app.get("/ai/summary", async c => {
    const actor = c.get("actor");
    const answer = actor.role === "head" ? await districtAnswer(actor) : await clusterAnswer(actor);
    return c.json(ok({ ...answer, generatedAt: new Date(), grounded: true }));
  });

  // ───────── approval-gated agent (SPEC §7.4): propose has no side effects ─────────
  app.post("/ai/agent/propose", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const action = body.action;
    if (action !== "remind" && action !== "report" && action !== "gaps") throw invalid({ action: "إجراء غير معروف" });
    const { members } = await loadDistrict(sql, head.districtId);
    let plan: { step: string; ok: boolean }[];
    let payload: Record<string, unknown>;
    if (action === "remind") {
      const targets = members.filter(item => item.summary.submission === "missing").map(item => ({ memberId: item.summary.id, name: item.summary.name }));
      const message = typeof body.body === "string" && body.body.trim() ? body.body.trim() : "يرجى استكمال تحديث اليوم وإرساله لرئيسة النطاق.";
      plan = [{ step: `تحديد المتأخرات (${targets.length})`, ok: true }, { step: "صياغة الرسالة", ok: true }, { step: "بانتظار الموافقة", ok: false }];
      payload = { targets, message };
    } else if (action === "report") {
      const report = buildReport(members, 0, riyadhDate());
      plan = [{ step: "جمع تحديثات اليوم", ok: true }, { step: "استخراج الأرقام", ok: true }, { step: "صياغة الملخص التنفيذي", ok: true }, { step: "بانتظار الموافقة", ok: false }];
      payload = { summaryText: report.summaryText, stats: report.stats };
    } else {
      const gaps = members
        .map(item => ({ memberId: item.summary.id, name: item.summary.name, completion: item.summary.completion, missingPlans: item.workspace.plans.filter(p => p.status !== "uploaded").length }))
        .filter(item => item.completion < 85 || item.missingPlans > 0)
        .sort((a, b) => a.completion - b.completion);
      plan = [{ step: `مراجعة ${members.length} ملفات`, ok: true }, { step: `ترتيب النواقص (${gaps.length})`, ok: true }, { step: "بانتظار الموافقة", ok: false }];
      payload = { gaps };
    }
    const [run] = await sql`insert into agent_runs ${sql({ districtId: head.districtId, userId: head.id, action, plan: sql.json(plan), payload: sql.json(payload as never) })} returning *`;
    return c.json(ok(run), 201);
  });

  app.post("/ai/agent/:id/approve", async c => {
    const head = requireHead(c);
    const id = c.req.param("id");
    const result = await sql.begin(async tx => {
      const [run] = isUuid(id) ? await tx`select * from agent_runs where id = ${id} and district_id = ${head.districtId} and action in ('remind', 'report', 'gaps') for update` : [];
      if (!run) throw notFound("الإجراء غير موجود");
      if (run.status !== "proposed") throw new ApiError(409, "ALREADY_DECIDED", "تم البت في هذا الإجراء مسبقاً");
      const payload = run.payload as Record<string, any>;
      let summary: string;
      if (run.action === "remind") {
        const ids = (payload.targets as { memberId: string }[]).map(target => target.memberId);
        const sent = ids.length ? await sendReminders(c, tx, head, ids, String(payload.message), String(run.id)) : [];
        summary = `أُرسل ${sent.length} تذكيرات`;
      } else if (run.action === "report") {
        const [report] = await tx`insert into consolidated_reports ${tx({ districtId: head.districtId, date: riyadhDate(), summaryText: String(payload.summaryText), stats: tx.json(payload.stats), generatedBy: head.id })} returning id`;
        summary = "أُنشئت مسودة التقرير المجمّع";
        await audit(c, tx, { action: "export", entity: "consolidated_report", entityId: String(report.id), clusterId: null, source: "agent" });
      } else {
        summary = `قائمة النواقص جاهزة (${(payload.gaps as unknown[]).length} ملفات)`;
      }
      const [next] = await tx`update agent_runs set status = 'executed', result_summary = ${summary}, decided_at = now() where id = ${run.id} returning *`;
      await audit(c, tx, { action: "approve", entity: "agent_run", entityId: String(run.id), clusterId: null, after: { action: run.action, summary }, source: "agent" });
      return next;
    });
    return c.json(ok(result));
  });

  app.post("/ai/agent/:id/reject", async c => {
    const head = requireHead(c);
    const id = c.req.param("id");
    const [run] = isUuid(id) ? await sql`update agent_runs set status = 'rejected', decided_at = now() where id = ${id} and district_id = ${head.districtId} and status = 'proposed' and action in ('remind', 'report', 'gaps') returning *` : [];
    if (!run) throw notFound("الإجراء غير موجود");
    return c.json(ok(run));
  });
}
