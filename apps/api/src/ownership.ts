import type { MemberActor } from "./auth.js";
import type { Sql } from "./db.js";
import { notFound } from "./errors.js";
import { isUuid } from "./parse.js";

// Every member write resolves the owning cluster server-side. Rows outside the member's cluster answer 404, not 403,
// so ids from other clusters are indistinguishable from ids that do not exist.

export async function ownSchool(db: Sql, actor: MemberActor, schoolId: string) {
  if (!isUuid(schoolId)) throw notFound("المدرسة غير موجودة");
  const [row] = await db`select * from schools where id = ${schoolId} and cluster_id = ${actor.clusterId} and deleted_at is null`;
  if (!row) throw notFound("المدرسة غير موجودة");
  return row;
}

export async function ownRole(db: Sql, actor: MemberActor, roleId: string) {
  if (!isUuid(roleId)) throw notFound("الدور غير موجود");
  const [row] = await db`
    select r.* from leadership_roles r join schools s on s.id = r.school_id
    where r.id = ${roleId} and s.cluster_id = ${actor.clusterId} and r.deleted_at is null and s.deleted_at is null`;
  if (!row) throw notFound("الدور غير موجود");
  return row;
}

export async function ownSection(db: Sql, actor: MemberActor, sectionId: string) {
  if (!isUuid(sectionId)) throw notFound("القسم غير موجود");
  const [row] = await db`select * from custom_sections where id = ${sectionId} and cluster_id = ${actor.clusterId} and deleted_at is null`;
  if (!row) throw notFound("القسم غير موجود");
  return row;
}
