import type { Context } from "hono";
import type { AppEnv, ChangeSource } from "./auth.js";
import type { Sql } from "./db.js";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  clusterId?: string | null;
  field?: string | null;
  before?: unknown;
  after?: unknown;
  source?: ChangeSource;
};

/** Appends to audit_log (EDITABILITY §1.7). Call inside the same transaction as the change it records. */
export async function audit(c: Context<AppEnv>, db: Sql, entry: AuditEntry) {
  const actor = c.get("actor");
  await db`
    insert into audit_log (district_id, cluster_id, actor_id, action, entity, entity_id, field, before, after, source, ip)
    values (
      ${actor.districtId}, ${entry.clusterId ?? actor.clusterId}, ${actor.id}, ${entry.action}, ${entry.entity},
      ${entry.entityId ?? null}, ${entry.field ?? null},
      ${entry.before === undefined ? null : db.json(entry.before as never)},
      ${entry.after === undefined ? null : db.json(entry.after as never)},
      ${entry.source ?? c.get("source")}, ${c.get("ip")}
    )`;
}
