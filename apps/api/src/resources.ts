import type { Context, Hono } from "hono";
import { audit } from "./audit.js";
import { requireMember, type AppEnv, type MemberActor } from "./auth.js";
import { sql, type Row, type Sql } from "./db.js";
import { ApiError, invalid, notFound, ok } from "./errors.js";
import { ownRole, ownSchool, ownSection } from "./ownership.js";
import { assertFresh, isUuid, parseFields, readBody, type Parser } from "./parse.js";

type Owner = "cluster" | "school" | "role" | "section";
const parentColumn: Record<Owner, string> = { cluster: "clusterId", school: "schoolId", role: "roleId", section: "sectionId" };

export type ResourceSpec = {
  entity: string;
  table: string;
  owner: Owner;
  parsers: Record<string, Parser>;
  /** Values for a new row before the request body's fields are applied. */
  defaults: () => Record<string, unknown>;
  missing: string;
  afterCreate?: (db: Sql, row: Row) => Promise<void>;
  /** Extra rule on update, e.g. derived profile fields are read-only. */
  guardUpdate?: (row: Row, values: Record<string, unknown>) => void;
};

export type ResourcePaths = { list: string; create: string; order: string; item: string };

async function resolveParent(db: Sql, actor: MemberActor, owner: Owner, parentId: string | undefined) {
  if (owner === "cluster") return actor.clusterId;
  if (owner === "school") return String((await ownSchool(db, actor, parentId ?? "")).id);
  if (owner === "role") return String((await ownRole(db, actor, parentId ?? "")).id);
  return String((await ownSection(db, actor, parentId ?? "")).id);
}

/** The row with this id if it belongs to the member's cluster (through live parents). */
export async function findOwnedRow(db: Sql, actor: MemberActor, spec: ResourceSpec, id: string, deleted: "live" | "recentlyDeleted" = "live") {
  if (!isUuid(id)) return null;
  const state = deleted === "live" ? db`t.deleted_at is null` : db`t.deleted_at > now() - interval '30 days'`;
  const table = db(spec.table);
  const rows =
    spec.owner === "cluster" ? await db`select t.* from ${table} t where t.id = ${id} and t.cluster_id = ${actor.clusterId} and ${state}`
    : spec.owner === "school" ? await db`select t.* from ${table} t join schools s on s.id = t.school_id
        where t.id = ${id} and s.cluster_id = ${actor.clusterId} and s.deleted_at is null and ${state}`
    : spec.owner === "role" ? await db`select t.* from ${table} t join leadership_roles r on r.id = t.role_id join schools s on s.id = r.school_id
        where t.id = ${id} and s.cluster_id = ${actor.clusterId} and r.deleted_at is null and s.deleted_at is null and ${state}`
    : await db`select t.* from ${table} t join custom_sections cs on cs.id = t.section_id
        where t.id = ${id} and cs.cluster_id = ${actor.clusterId} and cs.deleted_at is null and ${state}`;
  return rows[0] ?? null;
}

export function resourceRoutes(app: Hono<AppEnv>, paths: ResourcePaths, spec: ResourceSpec) {
  const column = parentColumn[spec.owner];
  const snakeColumn = column.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

  app.get(paths.list, async c => {
    const actor = requireMember(c);
    const parentId = await resolveParent(sql, actor, spec.owner, c.req.param("parentId"));
    const rows = await sql`select * from ${sql(spec.table)} where ${sql(snakeColumn)} = ${parentId} and deleted_at is null order by sort_order, created_at`;
    return c.json(ok(rows));
  });

  app.post(paths.create, async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const values = parseFields(body, spec.parsers);
    const clientId = body.id === undefined ? undefined : isUuid(body.id) ? body.id : null;
    if (clientId === null) throw invalid({ id: "المعرّف غير صحيح" });
    const result = await sql.begin(async tx => {
      const parentId = await resolveParent(tx, actor, spec.owner, c.req.param("parentId"));
      const [{ next }] = await tx`select coalesce(max(sort_order) + 1, 0)::int as next from ${tx(spec.table)} where ${tx(snakeColumn)} = ${parentId}`;
      const row = { ...spec.defaults(), ...values, [column]: parentId, sortOrder: next, ...(clientId ? { id: clientId } : {}) };
      const [created] = await tx`insert into ${tx(spec.table)} ${tx(row)} on conflict (id) do nothing returning *`;
      if (!created) {
        // Replayed create (offline queue or double click): answer with the existing row if it is ours.
        const existing = clientId ? await findOwnedRow(tx, actor, spec, clientId) : null;
        if (!existing) throw new ApiError(409, "DUPLICATE", "العنصر موجود مسبقاً");
        return { row: existing, status: 200 as const };
      }
      await spec.afterCreate?.(tx, created);
      await audit(c, tx, { action: "create", entity: spec.entity, entityId: String(created.id), after: created });
      return { row: created, status: 201 as const };
    });
    return c.json(ok(result.row), result.status);
  });

  app.put(paths.order, async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.every(isUuid)) throw invalid({ ids: "ترتيب العناصر غير صحيح" });
    await sql.begin(async tx => {
      const parentId = await resolveParent(tx, actor, spec.owner, c.req.param("parentId"));
      const owned = await tx`select id from ${tx(spec.table)} where ${tx(snakeColumn)} = ${parentId} and deleted_at is null`;
      const ownedIds = new Set(owned.map(row => String(row.id)));
      if (ids.length !== ownedIds.size || !ids.every(id => ownedIds.has(id))) throw invalid({ ids: "قائمة الترتيب لا تطابق العناصر الحالية" });
      for (const [index, id] of ids.entries()) await tx`update ${tx(spec.table)} set sort_order = ${index} where id = ${id}`;
      await audit(c, tx, { action: "reorder", entity: spec.entity, entityId: parentId, after: ids });
    });
    return c.json(ok({ ids }));
  });

  app.patch(paths.item, async c => {
    const actor = requireMember(c);
    const body = await readBody(c);
    const updated = await sql.begin(async tx => {
      const row = await findOwnedRow(tx, actor, spec, c.req.param("id") ?? "");
      if (!row) throw notFound(spec.missing);
      const values = parseFields(body, spec.parsers, row);
      if (!Object.keys(values).length) throw invalid({ body: "لا توجد تغييرات للحفظ" });
      spec.guardUpdate?.(row, values);
      assertFresh(body, row);
      const [next] = await tx`update ${tx(spec.table)} set ${tx(values)} where id = ${row.id} returning *`;
      for (const key of Object.keys(values)) {
        if (JSON.stringify(row[key]) === JSON.stringify(next[key])) continue;
        await audit(c, tx, { action: "update", entity: spec.entity, entityId: String(row.id), field: key, before: row[key], after: next[key] });
      }
      return next;
    });
    return c.json(ok(updated));
  });

  app.delete(paths.item, async c => {
    const actor = requireMember(c);
    await sql.begin(async tx => {
      const row = await findOwnedRow(tx, actor, spec, c.req.param("id") ?? "");
      if (!row) throw notFound(spec.missing);
      await tx`update ${tx(spec.table)} set deleted_at = now() where id = ${row.id}`;
      await audit(c, tx, { action: "delete", entity: spec.entity, entityId: String(row.id), before: row });
    });
    return c.json(ok({ deleted: true }));
  });

  app.post(`${paths.item}/restore`, async c => {
    const actor = requireMember(c);
    const restored = await sql.begin(async tx => {
      const row = await findOwnedRow(tx, actor, spec, c.req.param("id") ?? "", "recentlyDeleted");
      if (!row) throw notFound(spec.missing);
      const [next] = await tx`update ${tx(spec.table)} set deleted_at = null where id = ${row.id} returning *`;
      await audit(c, tx, { action: "restore", entity: spec.entity, entityId: String(row.id), after: next });
      return next;
    });
    return c.json(ok(restored));
  });
}

export type RouteContext = Context<AppEnv>;
