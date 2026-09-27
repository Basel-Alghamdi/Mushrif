import type { Context, Hono } from "hono";
import { riyadhDate, toWesternDigits, validators } from "@rasd/schemas";
import { audit } from "../audit.js";
import { requireHead, supabaseAdmin, type Actor, type AppEnv } from "../auth.js";
import { sql, type Row, type Sql } from "../db.js";
import { emailConfigured, escapeHtml, rtlEmail, sendEmail } from "../email.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { isUuid, parseDate, readBody } from "../parse.js";
import { loadWorkspaces, memberSummary, type Workspace } from "../workspace.js";

export async function loadDistrict(db: Sql, districtId: string, date = riyadhDate()) {
  const [district] = await db`select id, name, submission_deadline::text as deadline from districts where id = ${districtId}`;
  const clusters = await db`select c.id from clusters c where c.district_id = ${districtId}`;
  const workspaces = await loadWorkspaces(db, clusters.map(row => String(row.id)), date);
  const deadline = (district?.deadline as string | null) ?? null;
  const members = [...workspaces.values()]
    .map(workspace => ({ workspace, summary: memberSummary(workspace, deadline) }))
    .sort((a, b) => a.summary.name.localeCompare(b.summary.name, "ar"));
  return { district, deadline, members };
}

async function memberInDistrict(db: Sql, head: Actor, memberId: string) {
  if (!isUuid(memberId)) throw notFound("العضوة غير موجودة");
  const [row] = await db`select c.id as cluster_id from clusters c where c.member_id = ${memberId} and c.district_id = ${head.districtId}`;
  if (!row) throw notFound("العضوة غير موجودة");
  return String(row.clusterId);
}

export function buildReport(members: { summary: ReturnType<typeof memberSummary>; workspace: Workspace }[], pendingInvitations: number, date: string) {
  const count = members.length;
  const schools = members.reduce((sum, item) => sum + item.summary.schoolCount, 0);
  const submitted = members.filter(item => item.summary.submission !== "missing").length;
  const late = members.filter(item => item.summary.submission === "late").length;
  const absenceDone = members.reduce((sum, item) => sum + item.summary.absence, 0);
  const visits = members.reduce((sum, item) => sum + item.summary.visits, 0);
  const average = count ? Math.round(members.reduce((sum, item) => sum + item.summary.completion, 0) / count) : 0;
  const summaryText = count
    ? `يضم النطاق ${count} عضوات مفعّلات و${schools} مدارس مسجلة. أرسلت ${submitted} من ${count} عضوات تحديث اليوم${late ? ` (${late} بعد الموعد)` : ""}، وثُبّت الغياب في ${absenceDone} من ${schools} مدارس. مجموع تقارير الزيارات ${visits}، ومتوسط اكتمال الملفات ${average}٪.${pendingInvitations ? ` توجد ${pendingInvitations} دعوات بانتظار القبول.` : ""}`
    : "لم تنضم أي عضوة إلى النطاق بعد.";
  return {
    date, summaryText, memberCount: count, schoolCount: schools,
    stats: [
      { label: "عضوة مفعّلة", value: count }, { label: "أرسلت اليوم", value: submitted }, { label: "مدرسة", value: schools },
      { label: "تثبيت الغياب", value: `${absenceDone} / ${schools}` }, { label: "تقارير الزيارات", value: visits }, { label: "متوسط الاكتمال", value: `${average}%` },
    ],
    rows: members.map(({ summary, workspace }) => ({
      memberId: summary.id, name: summary.name, clusterLabel: summary.clusterLabel, schools: summary.schoolCount,
      absence: summary.absence, visits: summary.visits, completion: summary.completion, submission: summary.submission,
      customSections: workspace.sections.map(section => ({ label: section.label, fields: section.fields.map(field => ({ label: field.label, value: field.value })) })),
    })),
  };
}

export const reportCsv = (report: ReturnType<typeof buildReport>) => {
  const escape = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = [["المؤشر", "القيمة"], ...report.stats.map(stat => [stat.label, stat.value]), [], ["العضوة", "العنقود", "المدارس", "تثبيت الغياب", "الزيارات", "اكتمال الملف", "حالة الإرسال"],
    ...report.rows.map(row => [row.name, row.clusterLabel, row.schools, row.absence, row.visits, `${row.completion}%`, { submitted: "أرسلت", late: "متأخرة", missing: "لم ترسل" }[row.submission]])];
  return "﻿" + lines.map(line => line.map(escape).join(",")).join("\n");
};

const entityLabels: Record<string, string> = {
  profile_field: "البيانات الأولية", school: "المدارس", school_custom_field: "حقول المدرسة", staff_tile: "الهيئة التعليمية والإدارية",
  leadership_role: "القيادة المدرسية", leadership_field: "القيادة المدرسية", pd_program: "التطوير المهني", custom_section: "قسم مخصص",
  section_field: "قسم مخصص", school_field_overrides: "تخصيص حقول المدرسة", cluster: "ملف العنقود", evaluation_indicators: "التقويم المدرسي",
  madrasati_indicators: "مؤشرات مدرستي", discipline_indicators: "مؤشرات الانضباط", discipline_support_plan: "خطة دعم الانضباط",
  absence_confirmation: "تثبيت الغياب", visit_report: "تقرير زيارة", plan: "الخطط", daily_submission: "تحديث اليوم",
  invitation: "الانضمام", member_contact: "بيانات التواصل", reminder: "تذكير",
};
const actionLabels: Record<string, string> = {
  create: "إضافة", update: "تعديل", delete: "حذف", restore: "استعادة", reorder: "إعادة ترتيب", absence_toggle: "تحديث",
  submit: "إرسال", accept: "قبول الدعوة", send: "إرسال", apply: "اعتماد",
};
const sourceLabels: Record<string, string> = { web: "الويب", mobile: "الجوال", ingest: "الاستيراد الذكي", agent: "المساعد", system: "النظام" };

function timelineEntry(row: Row) {
  const after = row.after as Record<string, unknown> | string | boolean | null;
  let body = "";
  if (row.entity === "absence_confirmation") body = after === true ? "تم تثبيت الغياب" : "أُلغي تثبيت الغياب";
  else if (row.entity === "daily_submission") body = "أرسلت العضوة تحديث ملفها إلى رئيسة النطاق";
  else if (after && typeof after === "object" && !Array.isArray(after)) body = String(after.label ?? after.name ?? after.role ?? after.type ?? after.body ?? "");
  else if (row.field && after !== null && after !== undefined) body = String(after).slice(0, 120);
  return {
    id: String(row.id), kind: row.entity, title: `${actionLabels[row.action] ?? row.action} · ${entityLabels[row.entity] ?? row.entity}`,
    body, at: row.at, source: row.source, sourceLabel: sourceLabels[row.source] ?? row.source, actorName: row.actorName ?? "",
    flagged: row.action === "delete",
  };
}

export async function sendReminders(c: Context<AppEnv>, db: Sql, head: Actor, memberIds: string[], message: string, agentRunId: string | null = null) {
  const members = await db`
    select p.id, p.name, p.email, c.id as cluster_id from profiles p join clusters c on c.member_id = p.id
    where p.id = any(${db.array(memberIds)}::uuid[]) and p.district_id = ${head.districtId}`;
  if (members.length !== new Set(memberIds).size) throw invalid({ memberIds: "إحدى العضوات غير موجودة في نطاقك" });
  const sent: Row[] = [];
  for (const member of members) {
    let channel: "app" | "email" = "app";
    if (emailConfigured()) {
      try {
        await sendEmail({ to: member.email, subject: "تذكير من رئيسة النطاق — رَصد", html: rtlEmail(`<p>مرحباً ${escapeHtml(member.name)}</p><p>${escapeHtml(message)}</p>`) });
        channel = "email";
      } catch (error) { console.error("reminder email failed", error); }
    }
    const [reminder] = await db`insert into reminders ${db({ districtId: head.districtId, fromUserId: head.id, toUserId: member.id, channel, body: message, agentRunId })} returning *`;
    await db`insert into notifications ${db({ userId: member.id, kind: "reminder", text: message, level: "attention" })}`;
    await audit(c, db, { action: "send", entity: "reminder", entityId: String(reminder.id), clusterId: String(member.clusterId), after: { body: message, channel }, source: agentRunId ? "agent" : "web" });
    sent.push(reminder);
  }
  return sent;
}
export function districtRoutes(app: Hono<AppEnv>) {
  app.get("/district/team", async c => {
    const head = requireHead(c);
    const { members } = await loadDistrict(sql, head.districtId);
    const invitations = await sql`
      select id, name, email, cluster_label, delivery_status, expires_at, created_at,
        case when status = 'pending' and expires_at <= now() then 'expired' else status end as status
      from invitations where district_id = ${head.districtId} and status in ('pending', 'expired') order by created_at desc`;
    return c.json(ok({ members: members.map(item => item.summary), invitations }));
  });

  app.get("/district/overview", async c => {
    const head = requireHead(c);
    const { members } = await loadDistrict(sql, head.districtId);
    const schools = members.flatMap(item => item.workspace.schools);
    const weekStart = new Date(Date.now() - 6 * 86_400_000);
    const week = await sql`
      select date::text as date, count(*)::int as count from daily_submissions ds join clusters c on c.id = ds.cluster_id
      where c.district_id = ${head.districtId} and ds.date >= ${riyadhDate(weekStart)}::date group by date order by date`;
    const disciplineValues = members.map(item => item.summary.discipline).filter((value): value is number => value !== null);
    return c.json(ok({
      kpis: {
        members: members.length,
        submitted: members.filter(item => item.summary.submission !== "missing").length,
        late: members.filter(item => item.summary.submission === "late").length,
        absenceDone: schools.filter(school => school.absenceToday).length,
        schools: schools.length,
        discipline: disciplineValues.length ? Math.round(disciplineValues.reduce((sum, value) => sum + value, 0) / disciplineValues.length) : null,
        visits: members.reduce((sum, item) => sum + item.summary.visits, 0),
      },
      tierSplit: ["تميز", "تقدم", "انطلاق", "تهيئة"].map(tier => ({ tier, count: schools.filter(school => school.tier === tier).length })),
      weekBars: week,
    }));
  });

  app.get("/district/members", async c => {
    const head = requireHead(c);
    const filter = c.req.query("filter") ?? "all";
    const query = c.req.query("q")?.trim() ?? "";
    const { members } = await loadDistrict(sql, head.districtId);
    const rows = members.map(item => item.summary).filter(member =>
      (!query || member.name.includes(query) || member.email.includes(query.toLowerCase()) || member.clusterLabel.includes(query)) &&
      (filter === "all" || (filter === "complete" && member.completion >= 85) || (filter === "incomplete" && member.completion < 85) ||
        (filter === "submitted" && member.submission !== "missing") || (filter === "lowDiscipline" && member.discipline !== null && member.discipline < 85)));
    return c.json(ok(rows, { total: rows.length }));
  });

  // Full cluster file including national IDs and phones: every read is audited (SPEC Part 8).
  app.get("/district/members/:id", async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    const [district] = await sql`select submission_deadline::text as deadline from districts where id = ${head.districtId}`;
    const workspace = (await loadWorkspaces(sql, [clusterId])).get(clusterId)!;
    await audit(c, sql, { action: "read_pii", entity: "cluster", entityId: clusterId, clusterId });
    return c.json(ok({ summary: memberSummary(workspace, (district?.deadline as string | null) ?? null), phone: workspace.cluster.memberPhone, workspace }));
  });

  app.get("/district/members/:id/timeline", async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    const rows = await sql`
      select a.*, p.name as actor_name from audit_log a left join profiles p on p.id = a.actor_id
      where a.cluster_id = ${clusterId} and a.action <> 'read_pii' order by a.at desc limit 200`;
    return c.json(ok(rows.map(timelineEntry)));
  });

  app.get("/district/members/:id/attachments", async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    const rows = await sql`select id, owner_type, owner_id, name, kind, mime_type, size_bytes, uploaded_at from attachments where cluster_id = ${clusterId} and deleted_at is null order by uploaded_at desc`;
    return c.json(ok(rows));
  });

  // The only member data the head may write (EDITABILITY H-3). Email changes also move the login email.
  app.patch("/district/members/:id/contact", async c => {
    const head = requireHead(c);
    const memberId = c.req.param("id");
    const body = await readBody(c);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
    const phone = typeof body.phone === "string" ? toWesternDigits(body.phone.trim()) : undefined;
    const fields: Record<string, string> = {};
    if (email !== undefined && (!email || validators.email(email))) fields.email = validators.email(email) ?? "البريد مطلوب";
    if (phone !== undefined && validators.phone(phone)) fields.phone = validators.phone(phone)!;
    if (Object.keys(fields).length) throw invalid(fields);
    if (email === undefined && phone === undefined) throw invalid({ body: "لا توجد تغييرات للحفظ" });
    const clusterId = await memberInDistrict(sql, head, memberId);
    const [before] = await sql`select email, phone from profiles where id = ${memberId}`;
    if (email !== undefined && email !== before.email) {
      const [taken] = await sql`select id from profiles where email = ${email} and id <> ${memberId}`;
      if (taken) throw new ApiError(409, "EMAIL_TAKEN", "البريد مستخدم لحساب آخر", { email: "البريد مستخدم لحساب آخر" });
      const { error } = await supabaseAdmin.auth.admin.updateUserById(memberId, { email, email_confirm: true });
      if (error) throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر تحديث البريد في نظام الدخول");
    }
    const changes = { ...(email !== undefined ? { email } : {}), ...(phone !== undefined ? { phone } : {}) };
    const updated = await sql.begin(async tx => {
      const [row] = await tx`update profiles set ${tx(changes)} where id = ${memberId} returning id, name, email, phone`;
      for (const [key, value] of Object.entries(changes)) {
        await tx`update profile_fields set value = ${value} where cluster_id = ${clusterId} and field_key = ${key} and deleted_at is null`;
      }
      await audit(c, tx, { action: "update", entity: "member_contact", entityId: memberId, clusterId, before, after: changes });
      return row;
    });
    return c.json(ok(updated));
  });

  app.get("/district/submissions", async c => {
    const head = requireHead(c);
    const today = riyadhDate();
    const date = c.req.query("date") ? parseDate(c.req.query("date"), today) : today;
    const { members, deadline } = await loadDistrict(sql, head.districtId, date);
    const statuses = members.map(({ summary }) => ({ memberId: summary.id, name: summary.name, initials: summary.initials, clusterLabel: summary.clusterLabel, status: summary.submission, submittedAt: summary.submittedAt }));
    return c.json(ok({
      date, deadline, statuses,
      counts: { submitted: statuses.filter(item => item.status === "submitted").length, late: statuses.filter(item => item.status === "late").length, missing: statuses.filter(item => item.status === "missing").length },
    }));
  });

  app.post("/district/reminders", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const memberIds = body.memberIds;
    if (!Array.isArray(memberIds) || !memberIds.length || !memberIds.every(isUuid)) throw invalid({ memberIds: "اختاري عضوة واحدة على الأقل" });
    const message = typeof body.body === "string" && body.body.trim() ? body.body.trim().slice(0, 1000) : "يرجى استكمال تحديث اليوم.";
    const sent = await sql.begin(tx => sendReminders(c, tx, head, memberIds as string[], message));
    return c.json(ok({ sent: sent.length, reminders: sent }), 201);
  });

  app.post("/district/imports/:kind", c => {
    requireHead(c);
    throw new ApiError(501, "NOT_IMPLEMENTED", "استيراد ملفات المؤشرات قيد التطوير — لم يُحفظ شيء بعد");
  });

  app.get("/district/report", async c => {
    const head = requireHead(c);
    const today = riyadhDate();
    const date = c.req.query("date") ? parseDate(c.req.query("date"), today) : today;
    const { members } = await loadDistrict(sql, head.districtId, date);
    const [{ pending }] = await sql`select count(*)::int as pending from invitations where district_id = ${head.districtId} and status = 'pending' and expires_at > now()`;
    return c.json(ok(buildReport(members, pending, date)));
  });

  app.post("/district/report/generate", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const today = riyadhDate();
    const date = body.date ? parseDate(body.date, today) : today;
    const format = body.format === "excel" ? "excel" : "text";
    const { members } = await loadDistrict(sql, head.districtId, date);
    const [{ pending }] = await sql`select count(*)::int as pending from invitations where district_id = ${head.districtId} and status = 'pending' and expires_at > now()`;
    const report = buildReport(members, pending, date);
    const saved = await sql.begin(async tx => {
      const [row] = await tx`insert into consolidated_reports ${tx({
        districtId: head.districtId, date, summaryText: report.summaryText, stats: tx.json(report.stats), memberCount: report.memberCount,
        schoolCount: report.schoolCount, format, generatedBy: head.id,
      })} returning id, generated_at`;
      await audit(c, tx, { action: "export", entity: "consolidated_report", entityId: String(row.id), clusterId: null, after: { date, format } });
      return row;
    });
    return c.json(ok({ id: saved.id, generatedAt: saved.generatedAt, format, report, content: format === "excel" ? reportCsv(report) : report.summaryText }), 201);
  });
}

export function notificationRoutes(app: Hono<AppEnv>) {
  app.get("/notifications", async c => {
    const actor = c.get("actor");
    const rows = await sql`select id, kind, text, level, read_at, created_at from notifications where user_id = ${actor.id} order by created_at desc limit 30`;
    return c.json(ok(rows, { unread: rows.filter(row => !row.readAt).length }));
  });
  app.post("/notifications/read", async c => {
    const actor = c.get("actor");
    await sql`update notifications set read_at = now() where user_id = ${actor.id} and read_at is null`;
    return c.json(ok({ read: true }));
  });
}

