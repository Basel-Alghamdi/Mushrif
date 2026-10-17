import type { Context, Hono } from "hono";
import { DEFAULT_LEADERSHIP_ROLE, DEFAULT_STAFF_TILES, KPI_STANDARDS, STAGES, ministryKey, toWesternDigits } from "@rasd/schemas";
import { audit, auditContext } from "../audit.js";
import { requireHead, requireMember, type Actor, type AppEnv, type MemberActor } from "../auth.js";
import { sql, type Sql } from "../db.js";
import { MAX_UPLOAD_BYTES } from "../documents.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { importKpis, kpiWorkbook, readKpiDocument, recentKpiImports, undoKpiImport, type KpiImportOptions } from "../kpi-import.js";
import {
  arabicKey, districtKpis, filterKpis, findLevel, inScoreRange, kpiYear, kpiYears, kpisForMember, memberKpi, readScore, selectKpis, toSchoolKpi,
  type KpiFilters,
} from "../kpis.js";
import { memberInDistrict, ownSchool } from "../ownership.js";
import { assertFresh, isUuid, p, parseFields, readBody, reject, type Parser } from "../parse.js";
import { uploadLimit } from "./documents.js";

const MISSING = "المدرسة غير موجودة في السجل";
const MEMBER_MESSAGE = "اختاري مشرفة من القائمة";
const YEAR_MESSAGE = "العام أربعة أرقام، مثل ١٤٤٧";
const DUPLICATE_ROW = "توجد مدرسة بهذا الرقم الوزاري في سجل العام نفسه";

// ───────── fields of a row ─────────
/** A score she types: 0–100 with up to 2 decimals (Arabic digits, «٫» or «,» as the decimal point); empty or null clears it. */
const score: Parser = value => {
  if (value === null || value === "") return null;
  const number = readScore(value);
  return number !== undefined && inScoreRange(number) ? number : reject("الدرجة رقم من ٠ إلى ١٠٠");
};
const STANDARD_KEYS = new Set<string>(KPI_STANDARDS.map(standard => standard.key));
/** Only the standards sent change: {planning: 84.5, safety: null}. */
const standards: Parser = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("المعايير غير صحيحة");
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => (STANDARD_KEYS.has(key) ? [key, score(entry)] : reject("المعايير غير صحيحة"))));
};
const trimmed = (max: number): Parser => value => (p.text(max)(value) as string).trim();
const kpiParsers: Record<string, Parser> = {
  schoolName: p.label("اسم المدرسة مطلوب (حتى ٢٠٠ حرف)"),
  ministryNo: value => toWesternDigits(trimmed(40)(value) as string),
  year: value => { const year = toWesternDigits(String(value ?? "")).trim(); return /^\d{0,4}$/.test(year) ? year : reject(YEAR_MESSAGE); },
  stage: trimmed(200), authority: trimmed(200), region: trimmed(200), sector: trimmed(200), evaluationType: trimmed(200),
  followUpLevel: trimmed(200), memberName: trimmed(200), note: trimmed(2000),
  overallScore: score, outcomesScore: score, standards,
  assignedMemberId: value => (value === null || isUuid(value) ? value : reject(MEMBER_MESSAGE)),
};

/** Rows go only to live members of her district. */
async function assertMember(db: Sql, districtId: string, memberId: string, field: string) {
  const [member] = await db`select 1 from profiles where id = ${memberId} and district_id = ${districtId} and role = 'member' and deleted_at is null`;
  if (!member) throw invalid({ [field]: MEMBER_MESSAGE });
}

/** One school per year and ministry number: the unique index's violation as a field error. */
const orDuplicate = (error: unknown): never => {
  if ((error as { constraint_name?: string }).constraint_name === "school_kpis_school_year_unique") {
    throw new ApiError(409, "DUPLICATE", DUPLICATE_ROW, { ministryNo: DUPLICATE_ROW });
  }
  throw error;
};

async function districtRow(db: Sql, head: Actor, id: string) {
  const [row] = isUuid(id) ? await db`select * from school_kpis where id = ${id} and district_id = ${head.districtId} and deleted_at is null for update` : [];
  if (!row) throw notFound(MISSING);
  return row;
}

const oneKpi = async (db: Sql, id: string) => toSchoolKpi((await selectKpis(db, db`k.id = ${id}`))[0]);

async function visibleKpi(db: Sql, member: MemberActor, id: string) {
  const row = isUuid(id) ? await memberKpi(db, member, id) : null;
  if (!row) throw notFound(MISSING);
  return row;
}

// ───────── query strings ─────────
/** ?year=: absent or empty = the latest year. */
function queryYear(value: string | undefined) {
  const year = toWesternDigits(value ?? "").trim();
  if (!year) return null;
  if (!/^\d{1,4}$/.test(year)) throw invalid({ year: YEAR_MESSAGE });
  return year;
}

function queryFilters(query: Record<string, string>): KpiFilters {
  const flag = (value?: string) => value === "1" || value === "true";
  const filters: KpiFilters = { unassigned: flag(query.unassigned), severe: flag(query.severe) };
  if (query.memberId) {
    if (!isUuid(query.memberId)) throw invalid({ memberId: MEMBER_MESSAGE });
    filters.memberId = query.memberId;
  }
  if (query.level) {
    const level = findLevel(query.level);
    if (!level) throw invalid({ level: "المستوى غير صحيح" });
    filters.level = level;
  }
  for (const key of ["q", "stage", "evaluationType"] as const) if (query[key]?.trim()) filters[key] = query[key].trim();
  return filters;
}

// ───────── import input ─────────
/** The file of a multipart import (field `file` or `files`) and its text fields. */
async function readImportForm(c: Context<AppEnv>) {
  const form = await c.req.parseBody({ all: true }).catch(() => ({}) as Record<string, unknown>);
  const file = [form.file, form.files].flat().find((item): item is File => item instanceof File);
  if (!file) throw new ApiError(422, "NO_FILES", "اختاري ملف المؤشرات (Excel)");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", `الملف «${file.name}» أكبر من ٢٥ م.ب`);
  const input = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  return { input: input as Record<string, unknown>, file: { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) } };
}

/** JSON {documentId}: a file already in her district (a chat upload or a member's file). */
async function readImportDocument(c: Context<AppEnv>, head: Actor) {
  const input = await readBody(c);
  if (!isUuid(input.documentId)) throw notFound("الملف غير موجود");
  return { input, file: await readKpiDocument(sql, head.districtId, input.documentId) };
}

/** dryRun (default true), mode, year, sheets and names — JSON values, or the text fields of a multipart upload. */
function importOptions(input: Record<string, unknown>): KpiImportOptions {
  const json = (value: unknown) => { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return undefined; } };
  const given = (value: unknown) => value !== undefined && value !== null && value !== "";
  const mode = input.mode ?? "merge";
  if (mode !== "merge" && mode !== "replace") throw invalid({ mode: "اختاري طريقة الاستيراد" });
  // No year sent: the sheet's «للعام 1447»; an empty one: no year.
  const year = input.year === undefined || input.year === null ? null : toWesternDigits(String(input.year)).trim();
  if (year !== null && !/^\d{0,4}$/.test(year)) throw invalid({ year: YEAR_MESSAGE });
  const sheets = given(input.sheets) ? json(input.sheets) : null;
  if (sheets !== null && !(Array.isArray(sheets) && sheets.every(item => typeof item === "string"))) throw invalid({ sheets: "قائمة الأوراق غير صحيحة" });
  const names = given(input.names) ? json(input.names) : {};
  if (!names || typeof names !== "object" || Array.isArray(names) || !Object.values(names).every(id => id === null || isUuid(id))) {
    throw invalid({ names: "اختيارات الأسماء غير صحيحة" });
  }
  return {
    dryRun: input.dryRun !== false && input.dryRun !== "false", mode, year, sheets: sheets as string[] | null,
    names: names as Record<string, string | null>,
  };
}

/** مؤشرات الأداء: the district register of school-evaluation indicators (head), and each member's view of it. */
export function kpiRoutes(app: Hono<AppEnv>) {
  // ───────── the head's register ─────────
  app.get("/district/kpis", async c => {
    const head = requireHead(c);
    const query = c.req.query();
    return c.json(ok(await districtKpis(sql, head.districtId, { year: queryYear(query.year), filters: queryFilters(query) })));
  });

  app.post("/district/kpis", async c => {
    const head = requireHead(c);
    const values = parseFields(await readBody(c), kpiParsers);
    if (!("schoolName" in values)) throw invalid({ schoolName: "اسم المدرسة مطلوب" });
    const created = await sql.begin(async tx => {
      const [[{ next, latest }]] = await Promise.all([
        tx`select coalesce(max(sort_order) + 1, 0)::int as next, coalesce(max(year) filter (where year <> ''), '') as latest
          from school_kpis where district_id = ${head.districtId} and deleted_at is null`,
        values.assignedMemberId && assertMember(tx, head.districtId, values.assignedMemberId as string, "assignedMemberId"),
      ]);
      const { standards: scores, ...fields } = values;
      // Without a year it joins the year on screen (the latest); without a member an import may still assign it.
      const [row] = await tx`insert into school_kpis ${tx({
        year: latest, ...fields, standards: tx.json((scores ?? {}) as never), districtId: head.districtId, source: "manual",
        ...("assignedMemberId" in values ? { assignmentSource: "manual" } : {}), sortOrder: next, updatedBy: head.id,
      })} returning *`;
      const [kpi] = await Promise.all([oneKpi(tx, String(row.id)), audit(c, tx, { action: "create", entity: "school_kpi", entityId: String(row.id), after: row })]);
      return kpi;
    }).catch(orDuplicate);
    return c.json(ok(created), 201);
  });

  app.patch("/district/kpis/:id", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const values = parseFields(body, kpiParsers);
    if (!Object.keys(values).length) throw invalid({ body: "لا توجد تغييرات للحفظ" });
    const updated = await sql.begin(async tx => {
      const [row] = await Promise.all([
        districtRow(tx, head, c.req.param("id")),
        values.assignedMemberId && assertMember(tx, head.districtId, values.assignedMemberId as string, "assignedMemberId"),
      ]);
      assertFresh(body, row);
      const changes: Record<string, unknown> = {
        ...values,
        ...(values.standards ? { standards: { ...row.standards, ...(values.standards as object) } } : {}),
        // Her choice of member is never changed by a later import.
        ...("assignedMemberId" in values ? { assignmentSource: "manual" } : {}),
      };
      const changed = Object.keys(changes).filter(key => JSON.stringify(row[key]) !== JSON.stringify(changes[key]));
      await tx`update school_kpis set ${tx({
        ...changes, ...(changes.standards ? { standards: tx.json(changes.standards as never) } : {}), updatedBy: head.id,
      })} where id = ${row.id}`;
      const pick = (source: Record<string, unknown>) => Object.fromEntries(changed.map(key => [key, source[key]]));
      const [kpi] = await Promise.all([
        oneKpi(tx, String(row.id)),
        changed.length && audit(c, tx, { action: "update", entity: "school_kpi", entityId: String(row.id), before: pick(row), after: pick(changes) }),
      ]);
      return kpi;
    }).catch(orDuplicate);
    return c.json(ok(updated));
  });

  app.delete("/district/kpis/:id", async c => {
    const head = requireHead(c);
    const id = c.req.param("id");
    await sql.begin(async tx => {
      const [row] = isUuid(id) ? await tx`
        update school_kpis set deleted_at = now(), updated_by = ${head.id} where id = ${id} and district_id = ${head.districtId} and deleted_at is null
        returning id, year, ministry_no, school_name` : [];
      if (!row) throw notFound(MISSING);
      await audit(c, tx, { action: "delete", entity: "school_kpi", entityId: id, before: row });
    });
    return c.json(ok({ deleted: true }));
  });

  app.post("/district/kpis/:id/restore", async c => {
    const head = requireHead(c);
    const id = c.req.param("id");
    const restored = await sql.begin(async tx => {
      const [row] = isUuid(id) ? await tx`
        update school_kpis set deleted_at = null, updated_by = ${head.id} where id = ${id} and district_id = ${head.districtId} and deleted_at is not null
        returning id` : [];
      if (!row) throw notFound(MISSING);
      const [kpi] = await Promise.all([oneKpi(tx, id), audit(c, tx, { action: "restore", entity: "school_kpi", entityId: id })]);
      return kpi;
    }).catch(orDuplicate);
    return c.json(ok(restored));
  });

  // Several rows to one member (or to nobody) at once; like a single row, her choice is kept by later imports.
  app.post("/district/kpis/assign", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
    if (!ids.length || ids.length > 2000 || !ids.every(isUuid)) throw invalid({ ids: "اختاري المدارس" });
    const memberId = body.memberId ?? null;
    if (memberId !== null && !isUuid(memberId)) throw invalid({ memberId: MEMBER_MESSAGE });
    const updated = await sql.begin(async tx => {
      const [rows] = await Promise.all([
        tx`
          update school_kpis k set assigned_member_id = ${memberId}, assignment_source = 'manual', updated_by = ${head.id}
          from school_kpis old
          where old.id = k.id and k.id = any(${tx.array(ids)}::uuid[]) and k.district_id = ${head.districtId} and k.deleted_at is null
          returning k.id, old.assigned_member_id as before`,
        memberId && assertMember(tx, head.districtId, memberId, "memberId"),
      ]);
      if (rows.length !== ids.length) throw notFound("بعض المدارس غير موجودة في السجل");
      await audit(c, tx, {
        action: "assign", entity: "school_kpis", before: rows.map(row => ({ id: row.id, memberId: row.before })), after: { ids, memberId },
      });
      return rows.length;
    });
    return c.json(ok({ updated }));
  });

  // ───────── Excel ─────────
  app.post("/district/kpis/import", uploadLimit, async c => {
    const head = requireHead(c);
    const multipart = (c.req.header("content-type") ?? "").includes("multipart/form-data");
    const { input, file } = multipart ? await readImportForm(c) : await readImportDocument(c, head);
    return c.json(ok(await importKpis(sql, auditContext(c), file, importOptions(input))));
  });

  app.get("/district/kpis/imports", async c => c.json(ok(await recentKpiImports(sql, requireHead(c).districtId))));

  app.post("/district/kpis/imports/:id/undo", async c => {
    requireHead(c);
    const id = c.req.param("id");
    if (!isUuid(id)) throw notFound("الاستيراد غير موجود");
    return c.json(ok(await undoKpiImport(sql, auditContext(c), id)));
  });

  // The rows on screen (same filters as GET /district/kpis) as her ministry sheet.
  app.get("/district/kpis/export", async c => {
    const head = requireHead(c);
    const query = c.req.query();
    const filters = queryFilters(query);
    const { year, rows } = await kpiYear(sql, head.districtId, queryYear(query.year));
    const workbook = kpiWorkbook(filterKpis(rows.map(row => toSchoolKpi(row, filters.memberId ?? null)), filters), { year, headName: head.name, sheet: query.sheet });
    const name = `مؤشرات الأداء${year ? ` ${year}` : ""}.xlsx`;
    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="kpis${year ? `-${year}` : ""}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "private, no-store",
      },
    });
  });

  // ───────── one member ─────────
  app.get("/district/members/:id/kpis", async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    return c.json(ok(await kpisForMember(sql, clusterId)));
  });

  app.put("/district/members/:id/kpi-scope", async c => {
    const head = requireHead(c);
    const { scope } = await readBody(c);
    if (scope !== "own" && scope !== "district") throw invalid({ scope: "اختاري ما تراه المشرفة من المؤشرات" });
    await sql.begin(async tx => {
      const clusterId = await memberInDistrict(tx, head, c.req.param("id"));
      const [row] = await tx`update clusters c set kpi_scope = ${scope} from clusters old where old.id = c.id and c.id = ${clusterId} returning old.kpi_scope as before`;
      await audit(c, tx, { action: "update", entity: "cluster", entityId: clusterId, clusterId, field: "kpiScope", before: row.before, after: scope });
    });
    return c.json(ok({ kpiScope: scope }));
  });

  // ───────── the member ─────────
  app.get("/cluster/me/kpis", async c => {
    const actor = requireMember(c);
    const [view, years] = await Promise.all([
      kpisForMember(sql, actor.clusterId, { year: queryYear(c.req.query("year")), byScope: true }),
      kpiYears(sql, actor.districtId),
    ]);
    return c.json(ok({ ...view, years }));
  });

  // A register row that is hers but not linked to one of her schools: give the school its ministry number.
  app.post("/cluster/me/kpis/:id/link", async c => {
    const actor = requireMember(c);
    const { schoolId } = await readBody(c);
    if (!isUuid(schoolId)) throw notFound("المدرسة غير موجودة");
    const id = c.req.param("id");
    const school = await sql.begin(async tx => {
      const [row, school, [taken]] = await Promise.all([
        visibleKpi(tx, actor, id),
        ownSchool(tx, actor.clusterId, schoolId),
        isUuid(id) ? tx`
          select s.id from schools s join school_kpis k on k.id = ${id}
          where s.cluster_id = ${actor.clusterId} and s.id <> ${schoolId} and s.deleted_at is null and s.ministry_no <> ''
            and app.ministry_key(s.ministry_no) = k.ministry_key limit 1` : [],
      ]);
      if (!ministryKey(row.ministryNo)) throw invalid({ schoolId: "لا يوجد رقم وزاري لهذه المدرسة في السجل" });
      if (taken) throw new ApiError(409, "DUPLICATE", "مدرسة أخرى من مدارسك لها هذا الرقم الوزاري");
      const ministryNo = toWesternDigits(row.ministryNo.trim());
      const [[next]] = await Promise.all([
        tx`update schools set ministry_no = ${ministryNo} where id = ${school.id} returning *`,
        audit(c, tx, { action: "update", entity: "school", entityId: String(school.id), clusterId: actor.clusterId, field: "ministryNo", before: school.ministryNo, after: ministryNo }),
      ]);
      return next;
    });
    return c.json(ok(school));
  });

  // A register row that is hers but not in مدارسي: add the school (name, stage, ministry number) like a new school.
  app.post("/cluster/me/kpis/:id/add-school", async c => {
    const actor = requireMember(c);
    const id = c.req.param("id");
    const school = await sql.begin(async tx => {
      const [row, [taken]] = await Promise.all([
        visibleKpi(tx, actor, id),
        isUuid(id) ? tx`
          select s.id from schools s join school_kpis k on k.id = ${id}
          where s.cluster_id = ${actor.clusterId} and s.deleted_at is null and s.ministry_no <> '' and k.ministry_key <> ''
            and app.ministry_key(s.ministry_no) = k.ministry_key limit 1` : [],
      ]);
      if (taken) throw new ApiError(409, "DUPLICATE", "هذه المدرسة موجودة في مدارسك");
      // «الابتدائية» in the sheet is «ابتدائية» in her school's list.
      const stage = STAGES.find(item => arabicKey(item) === arabicKey(row.stage)) ?? row.stage.slice(0, 120);
      const [created] = await tx`
        insert into schools (cluster_id, name, stage, ministry_no, sort_order)
        values (${actor.clusterId}, ${row.schoolName}, ${stage}, ${toWesternDigits(row.ministryNo.trim())},
          (select coalesce(max(sort_order) + 1, 0) from schools where cluster_id = ${actor.clusterId}))
        returning *`;
      // EDITABILITY S-1, like any new school: two staff tiles and the principal's role with its fields.
      await Promise.all([
        tx`insert into school_staff_tiles ${tx(DEFAULT_STAFF_TILES.map((label, index) => ({ schoolId: created.id, label, sortOrder: index })))}`,
        tx`
          with role as (
            insert into leadership_roles (school_id, role, state) values (${created.id}, ${DEFAULT_LEADERSHIP_ROLE.role}, ${DEFAULT_LEADERSHIP_ROLE.state}) returning id)
          insert into leadership_fields (role_id, label, sort_order)
          select role.id, field.label, field.position - 1 from role, unnest(${tx.array(DEFAULT_LEADERSHIP_ROLE.fields)}::text[]) with ordinality as field(label, position)`,
        audit(c, tx, { action: "create", entity: "school", entityId: String(created.id), clusterId: actor.clusterId, after: created }),
      ]);
      return created;
    });
    return c.json(ok(school), 201);
  });
}
