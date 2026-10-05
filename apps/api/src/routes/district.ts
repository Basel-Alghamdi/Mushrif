import type { Context, Hono } from "hono";
import { riyadhDate, toWesternDigits, validators } from "@rasd/schemas";
import { activationDeadline, createMemberAccount, parseMemberInput, randomPassword, revokeSessions } from "../accounts.js";

/** After a reset she has a few days to choose a new password; afterwards the head resets again. */
const RESET_WINDOW_DAYS = 3;
import { audit, auditContext } from "../audit.js";
import { requireHead, supabaseAdmin, type Actor, type AppEnv } from "../auth.js";
import { sql, type Row, type Sql } from "../db.js";
import { emailConfigured, messageEmail, sendEmails } from "../email.js";
import { env } from "../env.js";
import { ApiError, invalid, ok } from "../errors.js";
import { memberInDistrict } from "../ownership.js";
import { cleanText, isUuid, normalizeEmail, parseDate, readBody } from "../parse.js";
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

/** One member's summary (the team list shape). */
export async function loadMemberSummary(db: Sql, districtId: string, clusterId: string) {
  const [district] = await db`select submission_deadline::text as deadline from districts where id = ${districtId}`;
  const workspace = (await loadWorkspaces(db, [clusterId])).get(clusterId)!;
  return memberSummary(workspace, (district?.deadline as string | null) ?? null);
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
    ? `يضم النطاق ${count} عضوات مفعّلات و${schools} مدارس مسجلة. حدّثت ${submitted} من ${count} عضوات ملفاتهن اليوم${late ? ` (${late} بعد الموعد)` : ""}، وثُبّت الغياب في ${absenceDone} من ${schools} مدارس. مجموع تقارير الزيارات ${visits}، ومتوسط اكتمال الملفات ${average}٪.${pendingInvitations ? ` توجد ${pendingInvitations} دعوات بانتظار القبول.` : ""}`
    : "لم تنضم أي عضوة إلى النطاق بعد.";
  return {
    date, summaryText, memberCount: count, schoolCount: schools,
    stats: [
      { label: "عضوة مفعّلة", value: count }, { label: "حدّثت اليوم", value: submitted }, { label: "مدرسة", value: schools },
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
  const lines = [["المؤشر", "القيمة"], ...report.stats.map(stat => [stat.label, stat.value]), [], ["العضوة", "العنقود", "المدارس", "تثبيت الغياب", "الزيارات", "اكتمال الملف", "تحديث اليوم"],
    ...report.rows.map(row => [row.name, row.clusterLabel, row.schools, row.absence, row.visits, `${row.completion}%`, { submitted: "حدّثت", late: "متأخرة", missing: "لم تحدّث" }[row.submission]])];
  return "﻿" + lines.map(line => line.map(escape).join(",")).join("\n");
};

const entityLabels: Record<string, string> = {
  profile_field: "البيانات الأولية", school: "المدارس", school_custom_field: "حقول المدرسة", staff_tile: "الهيئة التعليمية والإدارية",
  leadership_role: "القيادة المدرسية", leadership_field: "القيادة المدرسية", pd_program: "التطوير المهني", custom_section: "قسم مخصص",
  section_field: "قسم مخصص", school_field_overrides: "تخصيص حقول المدرسة", cluster: "ملف العنقود", evaluation_indicators: "التقويم المدرسي",
  madrasati_indicators: "مؤشرات مدرستي", discipline_indicators: "مؤشرات الانضباط", discipline_support_plan: "خطة دعم الانضباط",
  absence_confirmation: "تثبيت الغياب", visit_report: "تقرير زيارة", plan: "الخطط", daily_submission: "تحديث اليوم",
  invitation: "الانضمام", member_contact: "بيانات التواصل", reminder: "تذكير", document: "الملفات", member: "الحساب", account: "الحساب",
};
const actionLabels: Record<string, string> = {
  create: "إضافة", update: "تعديل", delete: "حذف", restore: "استعادة", reorder: "إعادة ترتيب", absence_toggle: "تحديث",
  submit: "إرسال", accept: "قبول الدعوة", send: "إرسال", apply: "اعتماد", activate: "تفعيل", reset_password: "إعادة تعيين كلمة المرور", assign: "إضافة",
};
const sourceLabels: Record<string, string> = { web: "الويب", mobile: "الجوال", ingest: "الاستيراد الذكي", agent: "المساعد", system: "النظام" };

function timelineEntry(row: Row) {
  const after = row.after as Record<string, unknown> | string | boolean | null;
  let body = "";
  if (row.entity === "absence_confirmation") body = after === true ? "تم تثبيت الغياب" : "أُلغي تثبيت الغياب";
  else if (row.entity === "daily_submission") body = "أرسلت العضوة تحديث ملفها إلى رئيسة النطاق";
  else if (row.entity === "account") body = row.action === "activate" ? "اختارت كلمة المرور وفعّلت حسابها" : "ستختار كلمة مرور جديدة عند دخولها القادم";
  else if (after && typeof after === "object" && !Array.isArray(after)) body = String(after.label ?? after.name ?? after.role ?? after.type ?? after.body ?? "");
  else if (row.field && after !== null && after !== undefined) body = String(after).slice(0, 120);
  return {
    id: String(row.id), kind: row.entity, title: `${actionLabels[row.action] ?? row.action} · ${entityLabels[row.entity] ?? row.entity}`,
    body, at: row.at, source: row.source, sourceLabel: sourceLabels[row.source] ?? row.source, actorName: row.actorName ?? "",
    flagged: row.action === "delete",
  };
}

const MESSAGE_SUBJECTS = { reminder: "تذكير من رئيسة النطاق — رَصد", login: "حسابك في منصة رَصد جاهز" };

/**
 * Sends each member her own message: to her email in one Resend batch (when Resend is set up; replies go to the head),
 * and always as a notification in the app. Every message is recorded in reminders and audited.
 */
export async function sendReminders(
  c: Context<AppEnv>, db: Sql, head: Actor, messages: { memberId: string; body: string }[],
  options: { kind?: "login" | "reminder"; agentRunId?: string | null } = {},
) {
  const ids = [...new Set(messages.map(message => message.memberId))];
  const members = await db`
    select p.id, p.name, p.email, c.id as cluster_id from profiles p join clusters c on c.member_id = p.id
    where p.id = any(${db.array(ids)}::uuid[]) and p.district_id = ${head.districtId}`;
  if (members.length !== ids.length) throw invalid({ memberIds: "إحدى العضوات غير موجودة في نطاقك" });
  const byId = new Map(members.map(member => [String(member.id), member]));
  const kind = options.kind ?? "reminder";

  let channel: "app" | "email" = "app";
  const failed: string[] = [];
  if (emailConfigured()) {
    try {
      await sendEmails(messages.map(message => ({
        to: String(byId.get(message.memberId)!.email),
        subject: MESSAGE_SUBJECTS[kind],
        html: messageEmail(message.body, { url: `${env.appUrl.replace(/\/$/, "")}/login`, label: "الدخول إلى رَصد" }),
        replyTo: head.email,
      })));
      channel = "email";
    } catch (error) {
      console.error("reminder emails failed", error instanceof Error ? error.message : error);
      failed.push(...messages.map(message => String(byId.get(message.memberId)!.name)));
    }
  }

  const reminders: Row[] = [];
  for (const message of messages) {
    const member = byId.get(message.memberId)!;
    const [reminder] = await db`insert into reminders ${db({ districtId: head.districtId, fromUserId: head.id, toUserId: member.id, channel, body: message.body, agentRunId: options.agentRunId ?? null })} returning *`;
    await db`insert into notifications ${db({ userId: member.id, kind: "reminder", text: message.body, level: "attention" })}`;
    await audit(c, db, { action: "send", entity: "reminder", entityId: String(reminder.id), clusterId: String(member.clusterId), after: { body: message.body, channel, kind }, source: options.agentRunId ? "agent" : "web" });
    reminders.push(reminder);
  }
  return { reminders, emailed: channel === "email" ? reminders.length : 0, failed };
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

  // Her visit reports with the school and the full text (the timeline only records that a report was added).
  app.get("/district/members/:id/visits", async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    const rows = await sql`
      select v.id, v.school_id, s.name as school_name, v.type, v.text, v.beneficiaries, v.sessions, v.blockers, v.source, v.created_at
      from visit_reports v join schools s on s.id = v.school_id
      where v.cluster_id = ${clusterId} order by v.created_at desc limit 200`;
    return c.json(ok(rows));
  });

  // Accounts without an invitation (decision 3): she signs in with this email and chooses her password the first time.
  app.post("/district/members", async c => {
    const head = requireHead(c);
    const input = parseMemberInput(await readBody(c));
    const { clusterId } = await sql.begin(tx => createMemberAccount(tx, { ...input, districtId: head.districtId }, auditContext(c)));
    return c.json(ok(await loadMemberSummary(sql, head.districtId, clusterId)), 201);
  });

  // She chooses a new password at her next sign-in (decision 2).
  app.post("/district/members/:id/reset-password", async c => {
    const head = requireHead(c);
    const memberId = c.req.param("id");
    const clusterId = await memberInDistrict(sql, head, memberId);
    // The old password stops working first (outside any transaction), then she gets a short window to choose a new one
    // and every existing session ends — so whoever held the account before the reset is locked out.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(memberId, { password: randomPassword() });
    if (error) throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر إعادة تعيين كلمة المرور — أعيدي المحاولة");
    await sql.begin(async tx => {
      await tx`update profiles set activated_at = null, activation_expires_at = ${activationDeadline(RESET_WINDOW_DAYS)} where id = ${memberId}`;
      await revokeSessions(tx, memberId);
      await audit(c, tx, { action: "reset_password", entity: "account", entityId: memberId, clusterId });
    });
    return c.json(ok({ reset: true }));
  });

  // Account details the head may change. An email change also moves the login email; name and الصفة stay in sync
  // with the matching profile fields, and البريد الوزاري follows only a ministry address.
  app.patch("/district/members/:id/contact", async c => {
    const head = requireHead(c);
    const memberId = c.req.param("id");
    const body = await readBody(c);
    const text = (value: unknown, max: number) => (typeof value === "string" ? cleanText(value).slice(0, max) : undefined);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : undefined;
    const phone = typeof body.phone === "string" ? toWesternDigits(cleanText(body.phone)).slice(0, 40) : undefined;
    const name = text(body.name, 200);
    const title = text(body.title, 200);
    const clusterLabel = text(body.clusterLabel, 200);
    const fields: Record<string, string> = {};
    if (email !== undefined && validators.loginEmail(email)) fields.email = validators.loginEmail(email)!;
    if (name !== undefined && !name) fields.name = "الاسم مطلوب";
    if (Object.keys(fields).length) throw invalid(fields);
    const profileChanges = Object.fromEntries(Object.entries({ email, phone, name, title }).filter(([, value]) => value !== undefined)) as Record<string, string>;
    if (!Object.keys(profileChanges).length && clusterLabel === undefined) throw invalid({ body: "لا توجد تغييرات للحفظ" });
    const clusterId = await memberInDistrict(sql, head, memberId);
    const [before] = await sql`select p.email, p.phone, p.name, p.title, c.label as cluster_label from profiles p join clusters c on c.member_id = p.id where p.id = ${memberId}`;
    if (email !== undefined && email !== before.email) {
      const [taken] = await sql`select id from profiles where email = ${email} and id <> ${memberId}`;
      if (taken) throw new ApiError(409, "EMAIL_TAKEN", "البريد مستخدم لحساب آخر", { email: "البريد مستخدم لحساب آخر" });
      const { error } = await supabaseAdmin.auth.admin.updateUserById(memberId, { email, email_confirm: true });
      if (error) throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر تحديث البريد في نظام الدخول");
    }
    const fieldKeys: Record<string, string> = { phone: "phone", name: "fullName", title: "title" };
    if (email !== undefined && /@moe\.gov\.sa$/i.test(email)) fieldKeys.email = "email";
    const updated = await sql.begin(async tx => {
      const [row] = Object.keys(profileChanges).length
        ? await tx`update profiles set ${tx(profileChanges)} where id = ${memberId} returning id, name, email, phone, title`
        : await tx`select id, name, email, phone, title from profiles where id = ${memberId}`;
      for (const [key, value] of Object.entries(profileChanges)) {
        if (!fieldKeys[key]) continue;
        await tx`update profile_fields set value = ${value} where cluster_id = ${clusterId} and field_key = ${fieldKeys[key]} and deleted_at is null`;
      }
      if (clusterLabel !== undefined) await tx`update clusters set label = ${clusterLabel} where id = ${clusterId}`;
      const changes = { ...profileChanges, ...(clusterLabel !== undefined ? { clusterLabel } : {}) };
      await audit(c, tx, { action: "update", entity: "member_contact", entityId: memberId, clusterId, before, after: changes });
      return { ...row, clusterLabel: clusterLabel ?? before.clusterLabel };
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

  // { messages: [{ memberId, body }], kind } — each member gets her own text; { memberIds, body } sends one text to all.
  app.post("/district/reminders", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const kind = body.kind === "login" ? "login" : "reminder";
    let messages: { memberId: string; body: string }[];
    if (Array.isArray(body.messages)) {
      messages = body.messages.map(item => {
        const entry = (item ?? {}) as Record<string, unknown>;
        return { memberId: String(entry.memberId ?? ""), body: typeof entry.body === "string" ? entry.body.trim().slice(0, 4000) : "" };
      });
      if (!messages.length || messages.length > 200 || !messages.every(item => isUuid(item.memberId) && item.body)) throw invalid({ messages: "اختاري عضوة واحدة على الأقل، ولكل واحدة رسالة" });
    } else {
      const memberIds = body.memberIds;
      if (!Array.isArray(memberIds) || !memberIds.length || !memberIds.every(isUuid)) throw invalid({ memberIds: "اختاري عضوة واحدة على الأقل" });
      const text = typeof body.body === "string" && body.body.trim() ? body.body.trim().slice(0, 4000) : "يرجى استكمال تحديث اليوم.";
      messages = (memberIds as string[]).map(memberId => ({ memberId, body: text }));
    }
    const result = await sql.begin(tx => sendReminders(c, tx, head, messages, { kind }));
    return c.json(ok({ sent: result.reminders.length, emailed: result.emailed, emailConfigured: emailConfigured(), failed: result.failed, reminders: result.reminders }), 201);
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

