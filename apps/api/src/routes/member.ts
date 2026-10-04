import type { Hono } from "hono";
import {
  DEFAULT_LEADERSHIP_ROLE, DEFAULT_STAFF_TILES, EDUCATION_TYPES, MADRASATI_METRICS, NEW_LEADERSHIP_ROLE, PD_KINDS,
  SCHOOL_BASE_FIELDS, TIERS, VISIT_TYPES, messages, riyadhDate, toWesternDigits, validateProfileValue, validators, type ProfileFieldType,
} from "@rasd/schemas";
import { audit } from "../audit.js";
import { requireMember, type AppEnv } from "../auth.js";
import { sql } from "../db.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { ownSchool } from "../ownership.js";
import { assertFresh, isUuid, p, parseDate, parseFields, readBody, reject, type Parser } from "../parse.js";
import { resourceRoutes } from "../resources.js";
import { loadWorkspaces } from "../workspace.js";

// Validation follows the field's built-in key/type, not its (renamable) label. New member-added fields are plain text.
const profileValue: Parser = (value, row) => {
  const type = (row?.fieldType as ProfileFieldType | undefined) ?? "text";
  const key = (row?.fieldKey as string | null | undefined) ?? null;
  const raw = p.text(500)(value) as string;
  const normalized = type === "hijri_date" || key === "nationalId" || key === "phone" || key === "email" ? toWesternDigits(raw.trim()) : raw;
  if (type === "select" && normalized !== "" && !(row?.options as string[]).includes(normalized)) reject("اختاري قيمة من القائمة");
  const error = validateProfileValue(key, type, normalized);
  return error ? reject(error) : normalized;
};

const schoolParsers: Record<string, Parser> = {
  name: p.label("اسم المدرسة مطلوب"),
  stage: p.text(40),
  area: p.text(120),
  ministryNo: p.rule(validators.ministryNo),
  ministryEmail: p.rule(validators.email),
  educationType: p.oneOf(EDUCATION_TYPES),
  specialEdProgram: p.text(120),
  hasGuard: p.bool(),
  classes: p.count(),
  students: p.count(),
  giftedClasses: p.count(),
  giftedStudents: p.count(),
  teachesChinese: p.bool(),
  tier: p.nullable(p.oneOf(TIERS)),
};
const labelValue = { label: p.label(), value: p.text(500) };

export function memberRoutes(app: Hono<AppEnv>) {
  // ───────── whole file ─────────
  app.get("/member/workspace", async c => {
    const actor = requireMember(c);
    const workspace = (await loadWorkspaces(sql, [actor.clusterId])).get(actor.clusterId);
    if (!workspace) throw notFound("ملف العنقود غير موجود");
    return c.json(ok(workspace));
  });

  app.get("/cluster/me", async c => {
    const actor = requireMember(c);
    const workspace = (await loadWorkspaces(sql, [actor.clusterId])).get(actor.clusterId)!;
    return c.json(ok({ ...workspace.cluster, completion: workspace.completion, schoolCount: workspace.schools.length }));
  });

  // ───────── structure: generic child resources ─────────
  resourceRoutes(app, { list: "/cluster/me/profile-fields", create: "/cluster/me/profile-fields", order: "/cluster/me/profile-fields/order", item: "/cluster/me/profile-fields/:id" }, {
    entity: "profile_field", table: "profile_fields", owner: "cluster", missing: "الحقل غير موجود",
    parsers: { label: p.label(), value: profileValue, span: value => (value === 1 || value === 2 ? value : reject("عرض الحقل غير صحيح")) },
    defaults: () => ({ label: "حقل جديد", value: "", span: 1, fieldType: "text" }),
    guardUpdate: (row, values) => { if (row.fieldType === "derived" && "value" in values) throw invalid({ value: "تُحسب تلقائياً" }); },
  });

  resourceRoutes(app, { list: "/cluster/me/schools", create: "/cluster/me/schools", order: "/cluster/me/schools/order", item: "/cluster/me/schools/:id" }, {
    entity: "school", table: "schools", owner: "cluster", missing: "المدرسة غير موجودة",
    parsers: schoolParsers,
    defaults: () => ({ name: "مدرسة جديدة" }),
    afterCreate: async (db, school) => {
      // EDITABILITY S-1: a new school starts with 1 leadership role and 2 staff tiles.
      for (const [index, label] of DEFAULT_STAFF_TILES.entries()) await db`insert into school_staff_tiles ${db({ schoolId: school.id, label, sortOrder: index })}`;
      const [role] = await db`insert into leadership_roles ${db({ schoolId: school.id, role: DEFAULT_LEADERSHIP_ROLE.role, state: DEFAULT_LEADERSHIP_ROLE.state })} returning id`;
      for (const [index, label] of DEFAULT_LEADERSHIP_ROLE.fields.entries()) await db`insert into leadership_fields ${db({ roleId: role.id, label, sortOrder: index })}`;
    },
  });

  resourceRoutes(app, { list: "/schools/:parentId/custom-fields", create: "/schools/:parentId/custom-fields", order: "/schools/:parentId/custom-fields/order", item: "/schools/:parentId/custom-fields/:id" }, {
    entity: "school_custom_field", table: "school_custom_fields", owner: "school", missing: "الحقل غير موجود",
    parsers: labelValue, defaults: () => ({ label: "حقل جديد", value: "" }),
  });

  resourceRoutes(app, { list: "/schools/:parentId/staff-tiles", create: "/schools/:parentId/staff-tiles", order: "/schools/:parentId/staff-tiles/order", item: "/schools/:parentId/staff-tiles/:id" }, {
    entity: "staff_tile", table: "school_staff_tiles", owner: "school", missing: "المؤشر غير موجود",
    parsers: { label: p.label("اسم المؤشر مطلوب"), value: p.count() }, defaults: () => ({ label: "مؤشر جديد", value: 0 }),
  });

  resourceRoutes(app, { list: "/schools/:parentId/leadership", create: "/schools/:parentId/leadership", order: "/schools/:parentId/leadership/order", item: "/schools/:parentId/leadership/:id" }, {
    entity: "leadership_role", table: "leadership_roles", owner: "school", missing: "الدور غير موجود",
    parsers: { role: p.label("اسم الدور مطلوب"), state: p.label("حالة الدور مطلوبة") },
    defaults: () => ({ role: NEW_LEADERSHIP_ROLE.role, state: NEW_LEADERSHIP_ROLE.state }),
    afterCreate: async (db, role) => {
      for (const [index, label] of NEW_LEADERSHIP_ROLE.fields.entries()) await db`insert into leadership_fields ${db({ roleId: role.id, label, sortOrder: index })}`;
    },
  });

  resourceRoutes(app, { list: "/leadership/:parentId/fields", create: "/leadership/:parentId/fields", order: "/leadership/:parentId/fields/order", item: "/leadership/:parentId/fields/:id" }, {
    entity: "leadership_field", table: "leadership_fields", owner: "role", missing: "الحقل غير موجود",
    parsers: labelValue, defaults: () => ({ label: "حقل جديد", value: "" }),
  });

  resourceRoutes(app, { list: "/cluster/me/pd", create: "/pd", order: "/pd/order", item: "/pd/:id" }, {
    entity: "pd_program", table: "pd_programs", owner: "cluster", missing: "البرنامج غير موجود",
    parsers: {
      kind: p.oneOf(Object.keys(PD_KINDS)), label: p.label("اسم البرنامج مطلوب"), count: p.count(),
      reportsUrl: p.rule(validators.url), status: p.oneOf(["uploaded", "missing"]),
    },
    defaults: () => ({ kind: "workshop", label: "برنامج جديد", count: 0, reportsUrl: "", status: "missing" }),
  });

  resourceRoutes(app, { list: "/cluster/me/sections", create: "/cluster/me/sections", order: "/cluster/me/sections/order", item: "/sections/:id" }, {
    entity: "custom_section", table: "custom_sections", owner: "cluster", missing: "القسم غير موجود",
    parsers: { label: p.label("اسم القسم مطلوب") }, defaults: () => ({ label: "قسم جديد" }),
  });

  resourceRoutes(app, { list: "/sections/:parentId/fields", create: "/sections/:parentId/fields", order: "/sections/:parentId/fields/order", item: "/sections/:parentId/fields/:id" }, {
    entity: "section_field", table: "custom_section_fields", owner: "section", missing: "الحقل غير موجود",
    parsers: labelValue, defaults: () => ({ label: "حقل جديد", value: "" }),
  });

  // ───────── cluster-wide school field visibility (S-6) ─────────
  app.get("/schools/:id/field-overrides", async c => {
    const actor = requireMember(c);
    await ownSchool(sql, actor, c.req.param("id"));
    const rows = await sql`select field_key from school_field_overrides where cluster_id = ${actor.clusterId} and hidden`;
    return c.json(ok({ hidden: rows.map(row => row.fieldKey) }));
  });
  app.put("/schools/:id/field-overrides", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const known = new Set(SCHOOL_BASE_FIELDS.map(field => field.key));
    const hidden = body.hidden;
    if (!Array.isArray(hidden) || !hidden.every(key => typeof key === "string" && known.has(key))) throw invalid({ hidden: "قائمة الحقول غير صحيحة" });
    await sql.begin(async tx => {
      await ownSchool(tx, actor, c.req.param("id"));
      const before = (await tx`select field_key from school_field_overrides where cluster_id = ${actor.clusterId} and hidden`).map(row => row.fieldKey);
      await tx`delete from school_field_overrides where cluster_id = ${actor.clusterId}`;
      for (const fieldKey of new Set(hidden as string[])) await tx`insert into school_field_overrides ${tx({ clusterId: actor.clusterId, fieldKey, hidden: true })}`;
      await audit(c, tx, { action: "update", entity: "school_field_overrides", entityId: actor.clusterId, before, after: hidden });
    });
    return c.json(ok({ hidden }));
  });

  // ───────── indicators ─────────
  app.get("/cluster/me/indicators/evaluation", async c => {
    const actor = requireMember(c);
    const workspace = (await loadWorkspaces(sql, [actor.clusterId])).get(actor.clusterId)!;
    return c.json(ok({
      readOnly: true, nafesCardFolderUrl: workspace.cluster.nafesCardFolderUrl,
      schools: workspace.schools.map(school => ({ schoolId: school.id, name: school.name, tier: school.tier, ...school.evaluation })),
    }));
  });
  // Members may only set the Nafes card folder and each school's external-report link/status (I-2, I-3); the rest is imported.
  app.put("/cluster/me/indicators/evaluation", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const values = parseFields(body, { nafesCardFolderUrl: p.rule(validators.url), externalReportUrl: p.rule(validators.url), externalReportStatus: p.oneOf(["uploaded", "missing"]) });
    const result = await sql.begin(async tx => {
      if ("nafesCardFolderUrl" in values) {
        const [before] = await tx`select nafes_card_folder_url from clusters where id = ${actor.clusterId}`;
        await tx`update clusters set nafes_card_folder_url = ${values.nafesCardFolderUrl as string} where id = ${actor.clusterId}`;
        await audit(c, tx, { action: "update", entity: "cluster", entityId: actor.clusterId, field: "nafesCardFolderUrl", before: before.nafesCardFolderUrl, after: values.nafesCardFolderUrl });
      }
      const report = Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("externalReport")));
      if (!Object.keys(report).length) return values;
      if (typeof body.schoolId !== "string") throw invalid({ schoolId: "اختاري المدرسة" });
      const school = await ownSchool(tx, actor, body.schoolId);
      const [row] = await tx`
        insert into evaluation_indicators ${tx({ schoolId: school.id, ...report })}
        on conflict (school_id) do update set ${tx(report)} returning *`;
      await audit(c, tx, { action: "update", entity: "evaluation_indicators", entityId: String(school.id), after: report });
      return row;
    });
    return c.json(ok(result));
  });

  app.get("/cluster/me/indicators/madrasati", async c => {
    const actor = requireMember(c);
    const workspace = (await loadWorkspaces(sql, [actor.clusterId])).get(actor.clusterId)!;
    return c.json(ok(workspace.schools.map(school => ({ schoolId: school.id, metrics: school.madrasati }))));
  });
  app.put("/cluster/me/indicators/madrasati", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const metrics = body.metrics;
    if (!Array.isArray(metrics) || metrics.length !== MADRASATI_METRICS.length || metrics.some(value => validators.percent(value))) throw invalid({ metrics: messages.percent });
    const values = Object.fromEntries(MADRASATI_METRICS.map((metric, index) => [metric.key, metrics[index] as number]));
    const row = await sql.begin(async tx => {
      const school = await ownSchool(tx, actor, String(body.schoolId ?? ""));
      const [before] = await tx`select * from madrasati_indicators where school_id = ${school.id}`;
      const [next] = await tx`
        insert into madrasati_indicators ${tx({ schoolId: school.id, ...values, source: "manual" })}
        on conflict (school_id) do update set ${tx({ ...values, source: "manual" })} returning *`;
      await audit(c, tx, { action: "update", entity: "madrasati_indicators", entityId: String(school.id), before: before ?? null, after: values });
      return next;
    });
    return c.json(ok(row));
  });

  app.get("/cluster/me/indicators/discipline", async c => {
    const actor = requireMember(c);
    const workspace = (await loadWorkspaces(sql, [actor.clusterId])).get(actor.clusterId)!;
    return c.json(ok(workspace.schools.map(school => ({ schoolId: school.id, ...school.discipline }))));
  });
  app.put("/cluster/me/indicators/discipline", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const values = parseFields(body, { daily: p.percent(), weekly: p.percent(), monthly: p.percent(), planStatus: p.oneOf(["approved", "missing"]), planUrl: p.rule(validators.url) });
    if (!Object.keys(values).length) throw invalid({ body: "لا توجد تغييرات للحفظ" });
    const row = await sql.begin(async tx => {
      const school = await ownSchool(tx, actor, String(body.schoolId ?? ""));
      const [before] = await tx`select * from discipline_indicators where school_id = ${school.id}`;
      const [next] = await tx`
        insert into discipline_indicators ${tx({ schoolId: school.id, ...values })}
        on conflict (school_id) do update set ${tx(values)} returning *`;
      await audit(c, tx, { action: "update", entity: "discipline_indicators", entityId: String(school.id), before: before ?? null, after: values });
      return next;
    });
    return c.json(ok(row));
  });

  app.get("/cluster/me/discipline-support-plan", async c => {
    const actor = requireMember(c);
    const [row] = await sql`select * from discipline_support_plans where cluster_id = ${actor.clusterId}`;
    return c.json(ok(row ?? { clusterId: actor.clusterId, text: "", attachmentId: null, updatedAt: null }));
  });
  app.put("/cluster/me/discipline-support-plan", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const { text } = parseFields(body, { text: p.text(1000) }) as { text?: string };
    if (text === undefined) throw invalid({ text: "النص مطلوب" });
    const row = await sql.begin(async tx => {
      const [before] = await tx`select * from discipline_support_plans where cluster_id = ${actor.clusterId}`;
      if (before) assertFresh(body, before);
      const [next] = await tx`
        insert into discipline_support_plans ${tx({ clusterId: actor.clusterId, text })}
        on conflict (cluster_id) do update set text = excluded.text returning *`;
      await audit(c, tx, { action: "update", entity: "discipline_support_plan", entityId: actor.clusterId, field: "text", before: before?.text ?? "", after: text });
      return next;
    });
    return c.json(ok(row));
  });

  // ───────── daily tasks ─────────
  app.get("/cluster/me/absence", async c => {
    const actor = requireMember(c);
    const today = riyadhDate();
    const date = c.req.query("date") ? parseDate(c.req.query("date"), today) : today;
    const rows = await sql`
      select s.id as school_id, coalesce(a.done, false) as done, a.confirmed_at
      from schools s left join absence_confirmations a on a.school_id = s.id and a.date = ${date}::date
      where s.cluster_id = ${actor.clusterId} and s.deleted_at is null order by s.sort_order, s.created_at`;
    return c.json(ok(rows.map(row => ({ ...row, date }))));
  });
  app.put("/schools/:id/absence", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const date = parseDate(body.date, riyadhDate());
    if (typeof body.done !== "boolean") throw invalid({ done: "الحالة مطلوبة" });
    const done = body.done;
    const row = await sql.begin(async tx => {
      const school = await ownSchool(tx, actor, c.req.param("id"));
      const [before] = await tx`select done from absence_confirmations where school_id = ${school.id} and date = ${date}::date`;
      const [next] = await tx`
        insert into absence_confirmations (school_id, date, done, confirmed_at, confirmed_by)
        values (${school.id}, ${date}::date, ${done}, now(), ${actor.id})
        on conflict (school_id, date) do update set done = excluded.done, confirmed_at = now(), confirmed_by = excluded.confirmed_by
        returning school_id, date::text as date, done, confirmed_at, confirmed_by`;
      await audit(c, tx, { action: "absence_toggle", entity: "absence_confirmation", entityId: `${school.id}:${date}`, before: before?.done ?? false, after: done });
      return next;
    });
    return c.json(ok(row));
  });

  app.get("/cluster/me/visits", async c => {
    const actor = requireMember(c);
    const rows = await sql`select * from visit_reports where cluster_id = ${actor.clusterId} order by created_at desc limit 200`;
    return c.json(ok(rows));
  });
  app.post("/visits", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const fields: Record<string, string> = {};
    if (typeof body.schoolId !== "string" || !body.schoolId) fields.schoolId = "اختاري المدرسة";
    if (typeof body.type !== "string" || validators.label(body.type)) fields.type = "نوع الزيارة مطلوب";
    if (typeof body.text !== "string" || body.text.trim().length < 10) fields.text = "أضيفي وصفاً لا يقل عن ١٠ أحرف";
    if (Object.keys(fields).length) throw invalid(fields, "أكملي بيانات تقرير الزيارة");
    const numbers = parseFields(body, { beneficiaries: p.count(), sessions: p.count(), blockers: p.text(2000) });
    if (body.id !== undefined && !isUuid(body.id)) throw invalid({ id: "المعرّف غير صحيح" });
    const source = c.get("source");
    const result = await sql.begin(async tx => {
      const school = await ownSchool(tx, actor, body.schoolId as string);
      const visit = {
        ...(body.id ? { id: body.id as string } : {}), schoolId: school.id, clusterId: actor.clusterId, memberId: actor.id,
        type: (body.type as string).trim(), text: (body.text as string).trim(), source, ...numbers,
      };
      const [created] = await tx`insert into visit_reports ${tx(visit)} on conflict (id) do nothing returning *`;
      if (!created) {
        const [existing] = await tx`select * from visit_reports where id = ${body.id as string} and cluster_id = ${actor.clusterId}`;
        if (!existing) throw new ApiError(409, "DUPLICATE", "التقرير موجود مسبقاً");
        return { row: existing, status: 200 as const };
      }
      await audit(c, tx, { action: "create", entity: "visit_report", entityId: String(created.id), after: { schoolId: school.id, type: visit.type } });
      return { row: created, status: 201 as const };
    });
    return c.json(ok(result.row), result.status);
  });
  app.get("/visit-types", c => c.json(ok(VISIT_TYPES)));

  app.get("/cluster/me/plans", async c => {
    const actor = requireMember(c);
    return c.json(ok(await sql`select * from plans where cluster_id = ${actor.clusterId} order by sort_order`));
  });
  app.patch("/plans/:id", async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const values = parseFields(body, { url: p.rule(validators.url), status: p.oneOf(["uploaded", "missing"]) });
    if ("url" in values && !("status" in values)) values.status = values.url ? "uploaded" : "missing";
    if (!Object.keys(values).length) throw invalid({ body: "لا توجد تغييرات للحفظ" });
    const row = await sql.begin(async tx => {
      const id = c.req.param("id");
      const [plan] = isUuid(id) ? await tx`select * from plans where id = ${id} and cluster_id = ${actor.clusterId}` : [];
      if (!plan) throw notFound("الخطة غير موجودة");
      assertFresh(body, plan);
      const uploadedAt = values.status === "uploaded" && plan.status !== "uploaded" ? { uploadedAt: new Date() } : {};
      const [next] = await tx`update plans set ${tx({ ...values, ...uploadedAt })} where id = ${plan.id} returning *`;
      await audit(c, tx, { action: "update", entity: "plan", entityId: String(plan.id), before: { url: plan.url, status: plan.status }, after: values });
      return next;
    });
    return c.json(ok(row));
  });

  app.post("/cluster/me/submit", async c => {
    const actor = requireMember(c);
    const today = riyadhDate();
    const row = await sql.begin(async tx => {
      const [submission] = await tx`
        insert into daily_submissions (cluster_id, member_id, date) values (${actor.clusterId}, ${actor.id}, ${today}::date)
        on conflict (member_id, date) do update set submitted_at = now()
        returning id, date::text as date, submitted_at`;
      const heads = await tx`select id from profiles where district_id = ${actor.districtId} and role = 'head'`;
      for (const head of heads) {
        await tx`insert into notifications ${tx({ userId: head.id, kind: "submission", text: `أرسلت ${actor.name} تحديث اليوم`, level: "info" })}`;
      }
      await audit(c, tx, { action: "submit", entity: "daily_submission", entityId: String(submission.id), after: { date: today } });
      return submission;
    });
    return c.json(ok(row), 201);
  });
}
