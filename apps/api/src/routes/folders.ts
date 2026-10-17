import type { Hono } from "hono";
import type postgres from "postgres";
import type { FolderScope } from "@rasd/schemas";
import { auditContext, auditMany, type AuditEntry } from "../audit.js";
import { requireHead, requireMember, type Actor, type AppEnv } from "../auth.js";
import { sql, type Sql } from "../db.js";
import { invalid, notFound, ok } from "../errors.js";
import {
  applyOp, draftChanged, draftLayout, filesLeaving, loadFileCounts, loadLayouts, newFolderKey, openDrafts, saveDrafts, syncScope,
  type FolderOp, type SyncDiff,
} from "../folders.js";
import { memberInDistrict } from "../ownership.js";
import { isUuid, p, parseFields, readBody } from "../parse.js";

const SCOPES: readonly FolderScope[] = ["member", "school"];
const KEY = /^[a-z0-9_]{1,60}$/;

/** `"all"` (every member of her district) or a list of member ids. */
function readMemberIds(value: unknown, field: string): "all" | string[] {
  if (value === "all") return "all";
  if (!Array.isArray(value) || !value.length || !value.every(isUuid)) throw invalid({ [field]: "اختاري المشرفات" });
  return [...new Set(value)];
}

/** The edit asked for, checked: folder keys well formed, names of 1–200 characters. An added folder's key is made here. */
function readOp(value: unknown): FolderOp {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const key = (field: string) => {
    const item = input[field];
    if (typeof item !== "string" || !KEY.test(item)) throw invalid({ [field]: "المجلد غير صحيح" });
    return item;
  };
  const optionalKey = (field: string) => (input[field] == null ? null : key(field));
  const label = () => String(parseFields({ label: input.label ?? "" }, { label: p.label() }).label);
  switch (input.type) {
    case "add": return { type: "add", key: newFolderKey(), label: label(), parentKey: optionalKey("parentKey"), afterKey: optionalKey("afterKey") };
    case "rename": return { type: "rename", key: key("key"), label: label() };
    case "delete": case "restore": return { type: input.type, key: key("key") };
    case "move": return { type: "move", key: key("key"), parentKey: optionalKey("parentKey") };
    case "order": {
      const keys = input.keys;
      if (!Array.isArray(keys) || !keys.length || keys.length > 200 || !keys.every(item => typeof item === "string" && KEY.test(item))) {
        throw invalid({ keys: "ترتيب المجلدات غير صحيح" });
      }
      return { type: "order", parentKey: optionalKey("parentKey"), keys: [...new Set(keys as string[])] };
    }
    case "hide_schools": case "show_schools": return { type: input.type };
    default: throw invalid({ op: "العملية غير معروفة" });
  }
}

/** Her folders or her schools'. «مدارس المشرفة» is one of her own folders, so showing or hiding it needs no scope. */
function readScope(value: unknown, op: FolderOp): FolderScope {
  const schoolsEntry = op.type === "hide_schools" || op.type === "show_schools";
  const scope = value ?? (schoolsEntry ? "member" : undefined);
  if (scope !== "member" && scope !== "school") throw invalid({ scope: "اختاري مجلداتها أو مجلدات مدارسها" });
  if (schoolsEntry && scope !== "member") throw invalid({ scope: "«مدارس المشرفة» من مجلداتها هي لا من مجلدات المدارس" });
  return scope;
}

function readScopes(value: unknown): FolderScope[] {
  if (value === undefined) return [...SCOPES];
  if (!Array.isArray(value) || !value.length || !value.every(item => SCOPES.includes(item))) throw invalid({ scopes: "اختاري مجلداتها أو مجلدات مدارسها" });
  return [...new Set(value as FolderScope[])];
}

/**
 * The members an edit works on, in name order, with their clusters locked until the transaction ends: two edits of the
 * same member (two tabs, or the page and the assistant) never interleave. A member outside her district is not found.
 * (`no key update`: her own writes, which only reference the cluster row, need not wait for the edit.)
 */
async function lockMembers(tx: Sql, head: Actor, memberIds: "all" | string[]) {
  const rows = await tx`
    select p.id as member_id, p.name, c.id as cluster_id, now() as now
    from clusters c join profiles p on p.id = c.member_id
    where c.district_id = ${head.districtId} and p.deleted_at is null
      ${memberIds === "all" ? tx`` : tx`and p.id = any(${tx.array(memberIds)}::uuid[])`}
    order by c.id
    for no key update of c`;
  if (memberIds !== "all" && rows.length !== memberIds.length) throw notFound("العضوة غير موجودة");
  const members = rows
    .map(row => ({ memberId: String(row.memberId), name: String(row.name), clusterId: String(row.clusterId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return { members, now: (rows[0]?.now as Date | undefined) ?? new Date() };
}

/** Thrown to roll a dry run back after it did everything for real. */
class DryRun extends Error {
  constructor(readonly result: unknown) { super("dry run"); }
}

/** Runs an edit in one transaction. A dry run runs the very same code and rolls it back, so its preview is the real effect. */
async function editing<T>(dryRun: boolean, edit: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  try {
    return await sql.begin(async tx => {
      const result = await edit(tx);
      if (dryRun) throw new DryRun(result);
      return result;
    }) as T;
  } catch (error) {
    if (error instanceof DryRun) return error.result as T;
    throw error;
  }
}

const folderAudit = (clusterId: string, after: Record<string, unknown>): AuditEntry =>
  ({ action: "update", entity: "folders", entityId: clusterId, clusterId, after });

/** ملف الإنجاز folders: the head edits members' folders (one or many at once); members read theirs. */
export function folderRoutes(app: Hono<AppEnv>) {
  app.get("/cluster/me/folders", async c => {
    const { clusterId } = requireMember(c);
    return c.json(ok((await loadLayouts(sql, [clusterId])).get(clusterId)));
  });

  app.get("/district/members/:memberId/folders", async c => {
    const clusterId = await memberInDistrict(sql, requireHead(c), c.req.param("memberId"));
    const [layouts, counts] = await Promise.all([loadLayouts(sql, [clusterId]), loadFileCounts(sql, [clusterId])]);
    return c.json(ok({ layout: layouts.get(clusterId), counts: counts.get(clusterId) }));
  });

  // Every member's folders at once: the page groups members whose folders are the same.
  app.get("/district/folders", async c => {
    const head = requireHead(c);
    const members = await sql`
      select p.id, p.name, p.title, c.id as cluster_id from clusters c join profiles p on p.id = c.member_id
      where c.district_id = ${head.districtId} and p.deleted_at is null`;
    const clusterIds = members.map(row => String(row.clusterId));
    const [layouts, counts] = await Promise.all([loadLayouts(sql, clusterIds), loadFileCounts(sql, clusterIds)]);
    return c.json(ok({
      members: members
        .map(row => ({
          memberId: String(row.id), name: String(row.name), title: String(row.title ?? ""),
          layout: layouts.get(String(row.clusterId)), counts: counts.get(String(row.clusterId)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar")),
    }));
  });

  // One edit for one member or many: folders are named by key, so the same edit lands on the same folder in each.
  // A member who lacks the folder (or where the edit does not fit) is skipped with the reason.
  app.post("/district/folders/bulk", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const memberIds = readMemberIds(body.memberIds, "memberIds");
    const op = readOp(body.op);
    const scope = readScope(body.scope, op);
    const dryRun = body.dryRun === true;
    const leavesFiles = op.type === "delete" || op.type === "hide_schools";
    const results = await editing(dryRun, async tx => {
      const { members, now } = await lockMembers(tx, head, memberIds);
      const clusterIds = members.map(member => member.clusterId);
      const [drafts, counts] = await Promise.all([openDrafts(tx, clusterIds, now), loadFileCounts(tx, clusterIds)]);
      const audits: AuditEntry[] = [];
      const results = members.map(member => {
        const draft = drafts.get(member.clusterId)!;
        const before = draftLayout(draft);
        const outcome = applyOp(draft, scope, op);
        if ("skipped" in outcome) return { memberId: member.memberId, name: member.name, status: "skipped" as const, note: outcome.skipped };
        const label = scope === "school" ? `${outcome.done} — مجلدات المدارس` : outcome.done;
        audits.push(folderAudit(member.clusterId, { op: op.type, scope, ...("key" in op ? { key: op.key } : {}), label }));
        return {
          memberId: member.memberId, name: member.name, status: "done" as const,
          ...(leavesFiles ? { filesToUnsorted: filesLeaving(counts.get(member.clusterId)!, before, draftLayout(draft)) } : {}),
        };
      });
      await Promise.all([saveDrafts(tx, [...drafts.values()]), auditMany(tx, auditContext(c), audits)]);
      return results;
    });
    return c.json(ok({ applied: !dryRun, ...(op.type === "add" ? { key: op.key } : {}), results }));
  });

  // «مثل مجلدات فلانة»: each target ends up with exactly the source's folders; hers the source lacks are removed.
  app.post("/district/folders/sync", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const fromId = body.fromMemberId;
    if (!isUuid(fromId)) throw invalid({ fromMemberId: "اختاري المشرفة التي تُنسخ مجلداتها" });
    const toIds = readMemberIds(body.toMemberIds, "toMemberIds");
    const scopes = readScopes(body.scopes);
    const dryRun = body.dryRun === true;
    const results = await editing(dryRun, async tx => {
      const { members, now } = await lockMembers(tx, head, toIds === "all" ? "all" : [...new Set([fromId, ...toIds])]);
      const source = members.find(member => member.memberId === fromId);
      if (!source) throw notFound("العضوة غير موجودة");
      const targets = members.filter(member => member !== source);
      const [drafts, counts] = await Promise.all([
        openDrafts(tx, members.map(member => member.clusterId), now),
        loadFileCounts(tx, targets.map(member => member.clusterId)),
      ]);
      const model = drafts.get(source.clusterId)!;
      const audits: AuditEntry[] = [];
      const results = targets.map(member => {
        const draft = drafts.get(member.clusterId)!;
        const before = draftLayout(draft);
        const diff: SyncDiff = { added: [], renamed: [], removed: [], restored: [] };
        for (const scope of scopes) syncScope(draft, model, scope, diff);
        if (draftChanged(draft)) {
          audits.push(folderAudit(member.clusterId, { op: "sync", fromMemberId: source.memberId, label: `توحيد المجلدات مع مجلدات ${source.name}`, ...diff }));
        }
        return { memberId: member.memberId, name: member.name, ...diff, filesToUnsorted: filesLeaving(counts.get(member.clusterId)!, before, draftLayout(draft)) };
      });
      await Promise.all([saveDrafts(tx, targets.map(member => drafts.get(member.clusterId)!)), auditMany(tx, auditContext(c), audits)]);
      return results;
    });
    return c.json(ok({ applied: !dryRun, results }));
  });
}
