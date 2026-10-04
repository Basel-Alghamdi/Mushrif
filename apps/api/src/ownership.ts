import type { Actor } from "./auth.js";
import type { Sql } from "./db.js";
import { notFound } from "./errors.js";
import { isUuid } from "./parse.js";

// Every write resolves the owning cluster server-side: a member's own cluster, or (for the head) the cluster of a member
// in her district. Rows outside that cluster answer 404, not 403, so ids from other clusters are indistinguishable
// from ids that do not exist.

/** The cluster of a member in the head's district. */
export async function memberInDistrict(db: Sql, head: Actor, memberId: string) {
  if (!isUuid(memberId)) throw notFound("العضوة غير موجودة");
  const [row] = await db`select c.id as cluster_id from clusters c where c.member_id = ${memberId} and c.district_id = ${head.districtId}`;
  if (!row) throw notFound("العضوة غير موجودة");
  return String(row.clusterId);
}

export async function ownSchool(db: Sql, clusterId: string, schoolId: string) {
  if (!isUuid(schoolId)) throw notFound("المدرسة غير موجودة");
  const [row] = await db`select * from schools where id = ${schoolId} and cluster_id = ${clusterId} and deleted_at is null`;
  if (!row) throw notFound("المدرسة غير موجودة");
  return row;
}

export async function ownRole(db: Sql, clusterId: string, roleId: string) {
  if (!isUuid(roleId)) throw notFound("الدور غير موجود");
  const [row] = await db`
    select r.* from leadership_roles r join schools s on s.id = r.school_id
    where r.id = ${roleId} and s.cluster_id = ${clusterId} and r.deleted_at is null and s.deleted_at is null`;
  if (!row) throw notFound("الدور غير موجود");
  return row;
}

export async function ownSection(db: Sql, clusterId: string, sectionId: string) {
  if (!isUuid(sectionId)) throw notFound("القسم غير موجود");
  const [row] = await db`select * from custom_sections where id = ${sectionId} and cluster_id = ${clusterId} and deleted_at is null`;
  if (!row) throw notFound("القسم غير موجود");
  return row;
}
