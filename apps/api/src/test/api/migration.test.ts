// The new migration applies on top of main's core schema with main's runner, backfills, and relaxes the checks.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { yearsSinceHijri } from "@rasd/schemas";
import { startApi, type TestApi } from "./harness.js";

const migrations = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
const CORE = readFileSync(`${migrations}20260927120000_core_schema.sql`, "utf8");
const AGENT = readFileSync(`${migrations}20261004120000_agent_chat_documents.sql`, "utf8");
/** Every migration in order: the runner's own file filter. */
const ALL = readdirSync(migrations).filter(file => /^\d+_.+\.sql$/.test(file)).sort().map(file => readFileSync(`${migrations}${file}`, "utf8"));

let api: TestApi;

describe("migrations since the core schema", () => {
  before(async () => { api = await startApi(); });
  after(async () => { await api.stop(); });

  test("main's runner applied every migration", async () => {
    const rows = await api.sql`select version from supabase_migrations.schema_migrations order by version`;
    assert.deepEqual(rows.map(row => row.version), [
      "20260927120000", "20261004120000", "20261006120000", "20261014120000", "20261015120000", "20261017120000", "20261017120100", "20261017120200",
    ]);
  });

  test("sub-folder keys, full attendance and the members' evaluation columns", async () => {
    const [cluster] = await api.sql`select id, district_id from clusters limit 1`;
    const [school] = await api.sql`insert into schools ${api.sql({ clusterId: cluster.id, name: "مدرسة الملاحظات" })} returning id`;
    const [filed] = await api.sql`insert into attachments ${api.sql({
      clusterId: cluster.id, districtId: cluster.districtId, ownerType: "document", name: "a.pdf", storagePath: `t/${crypto.randomUUID()}.pdf`,
      folder: "supervisory_execution_1", schoolId: school.id,
    })} returning folder`;
    assert.equal(filed.folder, "supervisory_execution_1", "digits are allowed in folder keys");
    const [day] = await api.sql`insert into absence_confirmations ${api.sql({ schoolId: school.id, date: "2026-10-14" })} returning done, full_attendance`;
    assert.deepEqual([day.done, day.fullAttendance], [false, null], "full attendance starts unanswered");
    const [row] = await api.sql`insert into evaluation_indicators ${api.sql({ schoolId: school.id, nafesGrade3: 70, selfReportUrl: "x" })} returning domains, nafes_grade6`;
    assert.deepEqual([row.domains, row.nafesGrade6], [{}, null]);
    await assert.rejects(api.sql`update evaluation_indicators set nafes_grade9 = 101 where school_id = ${school.id}`);
    await assert.rejects(api.sql`update evaluation_indicators set domains = '[]'::jsonb where school_id = ${school.id}`);
  });

  test("files carry a folder key and, for a school's folder, the school", async () => {
    const [cluster] = await api.sql`select id, district_id from clusters limit 1`;
    const [school] = await api.sql`insert into schools ${api.sql({ clusterId: cluster.id, name: "مدرسة المجلدات" })} returning id`;
    const file = (extra: Record<string, unknown>) =>
      api.sql({ clusterId: cluster.id, districtId: cluster.districtId, ownerType: "document", name: "a.pdf", storagePath: `t/${crypto.randomUUID()}.pdf`, ...extra });
    await assert.rejects(api.sql`insert into attachments ${file({ folder: "ليس مفتاحاً" })}`, "a folder is a key, not a label");
    await assert.rejects(api.sql`insert into attachments ${file({ schoolId: school.id })}`, "a school needs a folder");
    const [filed] = await api.sql`insert into attachments ${file({ folder: "discipline", schoolId: school.id })} returning id`;
    await api.sql`delete from schools where id = ${school.id}`;
    const [after] = await api.sql`select folder, school_id from attachments where id = ${filed.id}`;
    assert.deepEqual([after.folder, after.schoolId], ["discipline", null], "removing a school keeps its files");
  });

  test("new tables and columns exist, with RLS enabled", async () => {
    const columns = await api.sql`
      select table_name || '.' || column_name as name from information_schema.columns
      where table_schema = 'public' and (table_name, column_name) in (
        ('profiles', 'title'), ('profiles', 'activated_at'), ('attachments', 'district_id'), ('attachments', 'conversation_id'),
        ('chat_messages', 'conversation_id'), ('chat_messages', 'blocks'), ('chat_messages', 'attachments'), ('agent_runs', 'conversation_id'),
        ('attachment_contents', 'tables'), ('conversations', 'title'))`;
    assert.equal(columns.length, 10);
    const rls = await api.sql`select relname from pg_class where relname in ('conversations', 'attachment_contents') and relrowsecurity`;
    assert.equal(rls.length, 2);
    const [nullable] = await api.sql`select is_nullable from information_schema.columns where table_name = 'attachments' and column_name = 'cluster_id'`;
    assert.equal(nullable.isNullable, "YES");
  });

  test("format checks are gone and labels allow 200 characters", async () => {
    const [cluster] = await api.sql`select id from clusters limit 1`;
    const [school] = await api.sql`insert into schools ${api.sql({ clusterId: cluster.id, name: "م".repeat(200), ministryNo: "12-AB" })} returning id`;
    assert.ok(school.id);
    await assert.rejects(api.sql`insert into schools ${api.sql({ clusterId: cluster.id, name: "م".repeat(201) })}`);
    const [profile] = await api.sql`select member_id from clusters where id = ${cluster.id}`;
    const [visit] = await api.sql`insert into visit_reports ${api.sql({ schoolId: school.id, clusterId: cluster.id, memberId: profile.memberId, type: "ز".repeat(150), text: "" })} returning id`;
    assert.ok(visit.id);
    // Numbers keep their ranges.
    await assert.rejects(api.sql`insert into madrasati_indicators ${api.sql({ schoolId: school.id, completion: 101 })}`);
    const [head] = await api.sql`select id, district_id from profiles where role = 'head'`;
    const [run] = await api.sql`insert into agent_runs ${api.sql({ districtId: head.districtId, userId: head.id, action: "profile_updates" })} returning id`;
    assert.ok(run.id);
  });

  test("existing profiles are backfilled as activated", async () => {
    const admin = postgres(api.stack.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe("drop database if exists backfill_check");
      await admin.unsafe("create database backfill_check");
    } finally { await admin.end(); }
    const db = postgres(api.stack.env.DATABASE_URL.replace(/\/postgres$/, "/backfill_check"), { max: 1, onnotice: () => {} });
    try {
      const { SUPABASE_SHIM } = await import("../support/postgres.js");
      await db.unsafe(SUPABASE_SHIM);
      await db.unsafe(CORE);
      const [user] = await db`insert into auth.users (email) values ('old@example.com') returning id`;
      const [district] = await db`insert into districts (name) values ('d') returning id`;
      await db`insert into profiles (id, district_id, role, name, email, created_at) values (${user.id}, ${district.id}, 'member', 'old', 'old@example.com', '2026-01-01')`;
      await db`insert into clusters (district_id, member_id) values (${district.id}, ${user.id})`;
      await db`insert into attachments (cluster_id, owner_type, name, storage_path) select id, 'visit_report', 'a.pdf', 'p/a.pdf' from clusters`;
      await db.begin(tx => tx.unsafe(AGENT));
      const [profile] = await db`select activated_at = created_at as backfilled, title from profiles`;
      assert.equal(profile.backfilled, true);
      assert.equal(profile.title, "");
      const [attachment] = await db`select district_id from attachments`;
      assert.equal(attachment.district_id, district.id);
    } finally { await db.end(); }
  });

  test("every member keeps her folders, and the specialists get خلود's changes by الصفة", async () => {
    const admin = postgres(api.stack.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe("drop database if exists folders_check");
      await admin.unsafe("create database folders_check");
    } finally { await admin.end(); }
    const db = postgres(api.stack.env.DATABASE_URL.replace(/\/postgres$/, "/folders_check"), { max: 1, onnotice: () => {} });
    try {
      const { SUPABASE_SHIM } = await import("../support/postgres.js");
      await db.unsafe(SUPABASE_SHIM);
      const before = ALL.findIndex(content => content.includes("create table public.folders"));
      for (const content of ALL.slice(0, before)) await db.begin(tx => tx.unsafe(content));
      const [district] = await db`insert into districts (name) values ('d') returning id`;
      const titles = ["عضو نواتج تعلم", "أخصائية إدارة مدرسية", "أخصائية توجيه طلابي", "أخصائية نشاط طلابي", "عضو فريق تنفيذي", ""];
      const clusters: Record<string, string> = {};
      for (const [index, title] of titles.entries()) {
        const [user] = await db`insert into auth.users (email) values (${`m${index}@example.com`}) returning id`;
        await db`insert into profiles (id, district_id, role, name, email, title) values (${user.id}, ${district.id}, 'member', ${`m${index}`}, ${`m${index}@example.com`}, ${title})`;
        const [cluster] = await db`insert into clusters (district_id, member_id) values (${district.id}, ${user.id}) returning id`;
        clusters[title] = String(cluster.id);
      }
      for (const content of ALL.slice(before)) await db.begin(tx => tx.unsafe(content));

      const layout = async (clusterId: string) => (await db`
        select key, label, kind from folders where cluster_id = ${clusterId} and scope = 'member' and deleted_at is null order by sort_order`)
        .map(row => `${row.key}:${row.label}${row.kind === "schools" ? ":schools" : ""}`);
      const defaults = [
        "professional_development:التطوير المهني", "pd_presenter:منفذ", "pd_attendee:مستفيد", "schools_analysis:تحليل وتصنيف مدارس المشرفة",
        "initiatives:مبادرات المشرفة", "schools:مدارس المشرفة:schools", "performance_charter:ميثاق الأداء الوظيفي", "visit_plan:خطة الزيارات",
      ];
      assert.deepEqual(await layout(clusters["عضو فريق تنفيذي"]), defaults, "the executive team keeps today's folders");
      assert.deepEqual(await layout(clusters[""]), defaults, "a member without a title keeps today's folders");
      for (const [title, field] of [
        ["عضو نواتج تعلم", "نواتج التعلم"], ["أخصائية إدارة مدرسية", "الإدارة المدرسية"],
        ["أخصائية توجيه طلابي", "التوجيه الطلابي"], ["أخصائية نشاط طلابي", "النشاط الطلابي"],
      ]) {
        assert.deepEqual(await layout(clusters[title]), [
          "professional_development:التطوير المهني", "pd_presenter:منفذ", "pd_attendee:مستفيد",
          `schools_analysis:تحليل وتصنيف أداء المدارس وفق مؤشرات ${field}`, "initiatives:مبادرات المشرفة",
          "performance_charter:ميثاق الأداء الوظيفي", "visit_plan:خطة الزيارات", `schools_support_plan:خطة دعم المدارس في مجال ${field}`,
        ], title);
        const [removed] = await db`select deleted_at is not null as removed from folders where cluster_id = ${clusters[title]} and key = 'schools'`;
        assert.equal(removed.removed, true, `${title}: «مدارس المشرفة» is removed (kept for restoring)`);
      }
      const [{ count }] = await db`select count(*)::int as count from folders where scope = 'school' and deleted_at is null`;
      assert.equal(count, 18 * titles.length, "every member keeps the folders of her schools");

      const scopes = await db`select p.title, c.kpi_scope from clusters c join profiles p on p.id = c.member_id order by p.title`;
      assert.deepEqual(Object.fromEntries(scopes.map(row => [row.title, row.kpi_scope])), {
        "": "own", "عضو فريق تنفيذي": "own", "عضو نواتج تعلم": "district", "أخصائية إدارة مدرسية": "district",
        "أخصائية توجيه طلابي": "district", "أخصائية نشاط طلابي": "district",
      }, "the specialists see every school's indicators; the others their own schools'");
      const notes = await db`select text from notifications where kind = 'folders'`;
      assert.equal(notes.length, 0, "no head in this database: nobody to notify");
      const audited = await db`select count(*)::int as count from audit_log where entity = 'folders' and source = 'system'`;
      assert.equal(audited[0].count, 4, "each specialist's timeline records the change");
    } finally { await db.end(); }
  });

  test("the SQL twins agree with @rasd/schemas: default folders, ministry keys, specialties", async () => {
    const { DEFAULT_FOLDERS, ministryKey } = await import("@rasd/schemas");
    const [cluster] = await api.sql`
      select c.id from clusters c join profiles p on p.id = c.member_id where p.title = 'عضو فريق تنفيذي' or p.title = '' limit 1`;
    await api.sql`delete from folders where cluster_id = ${cluster.id}`;
    await api.sql`select app.seed_default_folders(${cluster.id})`;
    await api.sql`select app.seed_default_folders(${cluster.id})`; // idempotent
    for (const scope of ["member", "school"] as const) {
      const rows = await api.sql`select key, label, parent_key, kind from folders where cluster_id = ${cluster.id} and scope = ${scope} order by sort_order`;
      assert.deepEqual(
        rows.map(row => ({ key: row.key, label: row.label, parent: row.parentKey ?? null, kind: row.kind })),
        DEFAULT_FOLDERS[scope].map(folder => ({ key: folder.key, label: folder.label, parent: folder.parent ?? null, kind: folder.kind ?? "files" })),
        `${scope} defaults`,
      );
    }
    const samples = ["096175", " 96,175 ", "96175.0", "m 399-5842", "٧١٠٩٤٦", "M0012", "0", "رقم 12", "", "12‏34"];
    for (const value of samples) {
      const [row] = await api.sql`select app.ministry_key(${value}) as key`;
      assert.equal(row.key, ministryKey(value), `ministry key of «${value}»`);
    }
    const specialty = async (title: string) => (await api.sql`select app.member_specialty(${title}) as field`)[0].field;
    assert.equal(await specialty("عضو نواتج تعلم"), "نواتج التعلم");
    assert.equal(await specialty("مشرفة الإدارة المدرسية"), "الإدارة المدرسية");
    assert.equal(await specialty("اخصائيه اداره مدرسيه"), "الإدارة المدرسية");
    assert.equal(await specialty("أخصائية التوجيه الطلابي"), "التوجيه الطلابي");
    assert.equal(await specialty("أخصائية نشاط طلابي"), "النشاط الطلابي");
    assert.equal(await specialty("عضو فريق تنفيذي"), null);
    assert.equal(await specialty("نواتج ونشاط طلابي"), null, "a title naming two fields counts as neither");
    const rls = await api.sql`select relname from pg_class where relname in ('folders', 'school_kpis', 'kpi_member_aliases', 'kpi_imports') and relrowsecurity`;
    assert.equal(rls.length, 4, "RLS on every new table");
  });

  test("hire dates are read in Hijri or Gregorian", () => {
    const at = new Date("2026-10-04T12:00:00Z");
    assert.equal(yearsSinceHijri("2010-05-10", at), "16");
    assert.equal(yearsSinceHijri("10/05/2010", at), "16");
    assert.equal(yearsSinceHijri("١٤٣٠/٠٥/١٠", at), yearsSinceHijri("1430/05/10", at));
    assert.ok(Number(yearsSinceHijri("1430/05/10", at)) >= 17);
    assert.equal(yearsSinceHijri("10-05-1430", at), yearsSinceHijri("1430/05/10", at));
    assert.equal(yearsSinceHijri("1430", at), yearsSinceHijri("1430/01/01", at));
    assert.equal(yearsSinceHijri("قبل عشر سنوات", at), "");
    assert.equal(yearsSinceHijri("", at), "");
  });
});
