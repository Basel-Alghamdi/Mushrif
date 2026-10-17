import type { Context } from "hono";
import { riyadhDate } from "@rasd/schemas";
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

/** Who made a change and from where. Routes take it from the request; the agent and scripts build their own. */
export type AuditContext = {
  actor: { id: string | null; districtId: string; role?: "head" | "member"; clusterId?: string | null };
  source: ChangeSource;
  ip?: string | null;
};

/** Actions that are not work on the file: they never count as "updated today" or as her last activity. */
export const PASSIVE_ACTIONS = ["read_pii", "activate", "accept", "reset_password"];

/**
 * Appends to audit_log (EDITABILITY §1.7), one row per entry in one statement. Call inside the same transaction as
 * the change it records. A member's own write also marks her as active today: the first one creates today's
 * daily_submissions row, so its time is when she started (decision 6 — no separate "send" step needed). That upsert
 * rides in the same statement, so auditing costs one round trip to the database.
 */
export async function auditMany(db: Sql, context: AuditContext, entries: AuditEntry[]) {
  if (!entries.length) return;
  const { actor } = context;
  const rows = entries.map(entry => ({
    districtId: actor.districtId, clusterId: entry.clusterId ?? actor.clusterId ?? null, actorId: actor.id, action: entry.action,
    entity: entry.entity, entityId: entry.entityId ?? null, field: entry.field ?? null,
    before: entry.before === undefined ? null : db.json(entry.before as never),
    after: entry.after === undefined ? null : db.json(entry.after as never),
    source: entry.source ?? context.source, ip: context.ip ?? null,
  }));
  const active = actor.role === "member" && actor.id && actor.clusterId && entries.some(entry => !PASSIVE_ACTIONS.includes(entry.action));
  if (!active) {
    await db`insert into audit_log ${db(rows)}`;
    return;
  }
  await db`
    with logged as (insert into audit_log ${db(rows)})
    insert into daily_submissions (cluster_id, member_id, date) values (${actor.clusterId!}, ${actor.id}, ${riyadhDate()}::date)
    on conflict (member_id, date) do nothing`;
}

export const auditWith = (db: Sql, context: AuditContext, entry: AuditEntry) => auditMany(db, context, [entry]);

export const auditContext = (c: Context<AppEnv>, source?: ChangeSource): AuditContext =>
  ({ actor: c.get("actor"), source: source ?? c.get("source"), ip: c.get("ip") });

/** auditWith for an HTTP request: the signed-in user is the actor. */
export const audit = (c: Context<AppEnv>, db: Sql, entry: AuditEntry) => auditWith(db, auditContext(c), entry);
