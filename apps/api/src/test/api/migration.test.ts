// The new migration applies on top of main's core schema with main's runner, backfills, and relaxes the checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { yearsSinceHijri } from "@rasd/schemas";
import { startApi, type TestApi } from "./harness.js";

const migrations = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
const CORE = readFileSync(`${migrations}20260927120000_core_schema.sql`, "utf8");
const AGENT = readFileSync(`${migrations}20261004120000_agent_chat_documents.sql`, "utf8");

let api: TestApi;

describe("migrations 20261004120000_agent_chat_documents and 20261006120000_document_folders", () => {
  before(async () => { api = await startApi(); });
  after(async () => { await api.stop(); });

  test("main's runner applied every migration", async () => {
    const rows = await api.sql`select version from supabase_migrations.schema_migrations order by version`;
    assert.deepEqual(rows.map(row => row.version), ["20260927120000", "20261004120000", "20261006120000"]);
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
