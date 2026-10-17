// Head actions the agent prepares through the API (catalog.ts): checked, described from the database on one approval
// card ('api_requests'), and run on approval one by one through internal-api.ts as the head (audited source "agent").
import { DEFAULT_FOLDERS, type ChatBlock, type ProposalChange } from "@rasd/schemas";
import type { Actor } from "../auth.js";
import { createProposal } from "../chat-store.js";
import type { Row, Sql } from "../db.js";
import { ApiError } from "../errors.js";
import { callInternal, currentHead, type InternalResult } from "../internal-api.js";
import { isUuid } from "../parse.js";
import {
  ActionError, catalogById, checkAction, kindCounts, pathOf, placeholderIndex, riskOf, type ApiAction, type CatalogEntry, type Described,
  type DescribeContext, type EntityTable, type Ref,
} from "./catalog.js";
import type { Session } from "./model.js";
import { proposalBlock, type AgentReply, type ProposalPayload } from "./proposals.js";
import { ar, count, countAcc, countGen, NOUNS, shortName } from "./render.js";
import type { TeamSnapshot } from "./snapshot.js";

/** An action as stored on the card: what to send, its line in the result table, and the row's time when it was read. */
export type StoredAction = ApiAction & { title: string; expectedUpdatedAt?: string };
export type ApiRequestsPayload = ProposalPayload & {
  actions: StoredAction[];
  /** The undo of a change the agent made (e.g. a KPI import): it expires like an undo, and says so when done. */
  isUndo?: boolean;
  doneText?: string;
};

const ITEM = { one: "بند واحد", oneAcc: "بنداً واحداً", two: "بندان", twoGen: "بندين", few: "بنود", many: "بنداً" };

// ---------- the rows the actions refer to: one query per table ----------
const LOADERS: Record<EntityTable, (db: Sql, ids: string[], districtId: string) => Promise<readonly Row[]>> = {
  profile_fields: (db, list) => db`select t.*, t.cluster_id as owner_cluster from profile_fields t where t.id = any(${db.array(list)}::uuid[])`,
  schools: (db, list) => db`select t.*, t.cluster_id as owner_cluster from schools t where t.id = any(${db.array(list)}::uuid[])`,
  pd_programs: (db, list) => db`select t.*, t.cluster_id as owner_cluster from pd_programs t where t.id = any(${db.array(list)}::uuid[])`,
  custom_sections: (db, list) => db`select t.*, t.cluster_id as owner_cluster from custom_sections t where t.id = any(${db.array(list)}::uuid[])`,
  // A part of a school (or role, or section) counts only while its parents are there — as the routes see it.
  school_custom_fields: (db, list) => schoolPart(db, "school_custom_fields", list),
  school_staff_tiles: (db, list) => schoolPart(db, "school_staff_tiles", list),
  leadership_roles: (db, list) => schoolPart(db, "leadership_roles", list),
  leadership_fields: (db, list) => db`
    select t.*, s.cluster_id as owner_cluster, r.role || ' — ' || s.name as parent_label from leadership_fields t
      join leadership_roles r on r.id = t.role_id and r.deleted_at is null join schools s on s.id = r.school_id and s.deleted_at is null
    where t.id = any(${db.array(list)}::uuid[])`,
  custom_section_fields: (db, list) => db`
    select t.*, cs.cluster_id as owner_cluster, cs.label as parent_label from custom_section_fields t
      join custom_sections cs on cs.id = t.section_id and cs.deleted_at is null
    where t.id = any(${db.array(list)}::uuid[])`,
  evaluation_indicators: (db, list) => indicators(db, "evaluation_indicators", list),
  madrasati_indicators: (db, list) => indicators(db, "madrasati_indicators", list),
  discipline_indicators: (db, list) => indicators(db, "discipline_indicators", list),
  school_kpis: (db, list, districtId) => db`select * from school_kpis where id = any(${db.array(list)}::uuid[]) and district_id = ${districtId}`,
  kpi_imports: (db, list, districtId) => db`select id, file_name, created_at, undone_at from kpi_imports where id = any(${db.array(list)}::uuid[]) and district_id = ${districtId}`,
  // Keyed by the member: what she sees of the register.
  clusters: (db, list, districtId) => db`select member_id as id, id as owner_cluster, kpi_scope from clusters where member_id = any(${db.array(list)}::uuid[]) and district_id = ${districtId}`,
};
const schoolPart = (db: Sql, table: string, list: string[]) => db`
  select t.*, s.cluster_id as owner_cluster, s.name as parent_label from ${db(table)} t join schools s on s.id = t.school_id and s.deleted_at is null
  where t.id = any(${db.array(list)}::uuid[])`;
const indicators = (db: Sql, table: string, list: string[]) => db`
  select t.*, t.school_id as id, s.cluster_id as owner_cluster from ${db(table)} t join schools s on s.id = t.school_id
  where t.school_id = any(${db.array(list)}::uuid[])`;

async function loadRefs(db: Sql, districtId: string, refs: Ref[]) {
  const byTable = new Map<EntityTable, Set<string>>();
  for (const [table, id] of refs) if (isUuid(id)) byTable.set(table, (byTable.get(table) ?? new Set()).add(id));
  const loaded = await Promise.all([...byTable].map(async ([table, list]) => (await LOADERS[table](db, [...list], districtId)).map(row => [`${table}:${row.id}`, row] as const)));
  return new Map(loaded.flat());
}

const failure = (result: InternalResult) => result.error?.message ?? "تعذّر التنفيذ";

/** The API's own preview of a folders change (dryRun), so the card says exactly what approving does. */
async function dryRun(head: Actor, ip: string | null, entry: CatalogEntry, action: ApiAction) {
  const result = await callInternal(head, entry.method, pathOf(entry, action.params ?? {}), { ...action.body, dryRun: true }, ip);
  if (result.status >= 400) throw new ActionError(`${entry.id}: ${failure(result)}`);
  return result.data;
}

function describeContext(team: TeamSnapshot, rows: Map<string, Row>, described: Described[]): Omit<DescribeContext, "entry" | "dryRun"> {
  const schools = new Map(team.members.flatMap(member => team.details.get(member.id)?.workspace.schools ?? []).map(school => [school.id, school.name]));
  return {
    member: id => {
      const member = team.members.find(item => item.id === id);
      return member ? { id: member.id, name: member.name, clusterId: member.clusterId, email: member.email, phone: member.phone, title: member.title, clusterLabel: member.clusterLabel } : null;
    },
    row: (table, id) => rows.get(`${table}:${id}`) ?? null,
    layout: clusterId => team.layouts.get(clusterId) ?? DEFAULT_FOLDERS,
    document: id => team.documents.find(document => document.id === id) ?? null,
    schoolName: id => schools.get(id) ?? "مدرسة",
    earlier: ref => described[placeholderIndex(ref) ?? -1] ?? null,
  };
}

/** «تغييرات في ملف رشا القرني» / «… في ملفات ٣ مشرفات» / «… في بيانات النطاق». */
function cardTitle(rows: ProposalChange[]) {
  const members = new Map(rows.filter(row => row.memberId).map(row => [row.memberId, row.memberName]));
  if (members.size === 1) return `تغييرات في ملف ${shortName([...members.values()][0])}`;
  return members.size ? `تغييرات في ملفات ${countGen(members.size, NOUNS.member)}` : "تغييرات في بيانات النطاق";
}

/**
 * Checks every action against the catalog, describes each from the database (and the API's dry run for folders), and
 * stores one pending 'api_requests' card. Throws ActionError (nothing stored) when any action does not resolve.
 */
export async function proposeApiActions(session: Session, head: Actor, team: TeamSnapshot, actions: ApiAction[], note?: string) {
  const entries = actions.map((action, index) => checkAction(action, index, "change"));
  const [rows, dryRuns] = await Promise.all([
    loadRefs(session.db, head.districtId, entries.flatMap((entry, index) => entry.refs?.(actions[index]) ?? [])),
    Promise.all(entries.map((entry, index) => (entry.dryRun ? dryRun(head, session.audit.ip ?? null, entry, actions[index]) : null))),
  ]);
  const described: Described[] = [];
  const shared = describeContext(team, rows, described);
  entries.forEach((entry, index) => described.push(entry.describe!({ ...shared, entry, dryRun: dryRuns[index] }, actions[index])));

  // Destructive changes lead the card and are never cut from it; the actions still run in the order she asked.
  const destructive = (index: number) => riskOf(entries[index], actions[index]) === "destructive";
  const order = described.map((_, index) => index).sort((a, b) => Number(destructive(b)) - Number(destructive(a)));
  const cardRows = order.flatMap(index => described[index].rows);
  const pinnedRows = order.filter(destructive).reduce((sum, index) => sum + described[index].rows.length, 0);
  const seen = new Set<string>();
  const stored: StoredAction[] = actions.map((action, index) => {
    const { expectedUpdatedAt } = described[index];
    // Only the first change of a row checks its time: a second one in the same card follows the first.
    const key = `${action.route}:${action.params?.id ?? ""}`;
    const fresh = expectedUpdatedAt && !seen.has(key) && !(action.body && "expectedUpdatedAt" in action.body);
    seen.add(key);
    // What she approves is the real change, whatever the model put in `dryRun`.
    const { dryRun: _dryRun, ...body } = action.body ?? {};
    return { ...action, ...(action.body ? { body } : {}), title: described[index].title, ...(fresh ? { expectedUpdatedAt } : {}) };
  });
  const counts = kindCounts(described.map(item => item.kind));
  const payload: ApiRequestsPayload = {
    title: cardTitle(cardRows),
    summary: note?.trim() ? `${counts}\nوصف المساعد: ${note.trim().slice(0, 120)}` : counts,
    rows: cardRows, pinnedRows, actions: stored,
  };
  const proposal = await createProposal(session.db, { userId: session.head.id, districtId: session.head.districtId, conversationId: session.conversationId, kind: "api_requests", payload });
  return { block: proposalBlock(proposal.id, payload), summary: counts, rows: cardRows.length };
}

// ---------- on approval ----------
/** "$2.id" (anywhere in params or body) → the id the second action's answer carried. */
function resolve(value: unknown, created: unknown[]): unknown {
  const ref = placeholderIndex(value);
  if (ref !== null) {
    const id = (created[ref] as { id?: unknown } | null | undefined)?.id;
    if (!isUuid(id)) throw new ApiError(422, "MISSING_ID", `لم يُرجع البند ${ar(ref + 1)} معرّفاً`);
    return id;
  }
  if (Array.isArray(value)) return value.map(item => resolve(item, created));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, created)]));
  return value;
}

async function send(head: Actor, ip: string | null, action: StoredAction, created: unknown[]): Promise<InternalResult> {
  const entry = catalogById(action.route);
  if (!entry || entry.hidden || riskOf(entry, action) === "read") return { status: 404, data: null, error: { code: "NOT_FOUND", message: "هذا الإجراء لم يعد متاحاً" } };
  const params = resolve(action.params ?? {}, created) as Record<string, string>;
  const body = entry.method === "DELETE" ? undefined
    : { ...(resolve(action.body ?? {}, created) as Record<string, unknown>), ...(action.expectedUpdatedAt ? { expectedUpdatedAt: action.expectedUpdatedAt } : {}) };
  return callInternal(head, entry.method, pathOf(entry, params), body, ip);
}

const asStatus = (status: number) => ([400, 403, 404, 409, 410, 422] as const).find(item => item === status) ?? 502;

/**
 * Runs the card's actions in order as the head (re-read now), stopping at the first failure. If the very first one
 * fails nothing changed: that error is thrown and the card stays pending. After that, it never throws — the reply
 * tells what ran («تم»), what failed (the API's own message) and what did not run («لم يُنفّذ»).
 */
export async function executeApiRequests(session: Session, payload: ApiRequestsPayload): Promise<AgentReply> {
  const head = await currentHead(session.head.id);
  const ip = session.audit.ip ?? null;
  const created: unknown[] = [];
  const results: string[][] = [];
  let stopped: { title: string; message: string } | null = null;
  for (const [index, action] of payload.actions.entries()) {
    if (stopped) { results.push([action.title, "لم يُنفّذ"]); continue; }
    let result: InternalResult;
    try { result = await send(head, ip, action, created); }
    catch (error) {
      console.error("agent action failed", action.route, error);
      result = { status: 500, data: null, error: { code: "INTERNAL", message: error instanceof ApiError ? error.message : "حدث خطأ غير متوقع" } };
    }
    if (result.status >= 400) {
      if (index === 0) throw new ApiError(asStatus(result.status), result.error?.code ?? "FAILED", failure(result), result.error?.fields);
      stopped = { title: action.title, message: failure(result) };
      results.push([action.title, failure(result)]);
      continue;
    }
    created[index] = result.data;
    results.push([action.title, "تم"]);
  }
  const done = results.filter(([, outcome]) => outcome === "تم").length;
  const text = stopped
    ? `نفّذت ${countAcc(done, ITEM)} من ${ar(payload.actions.length)}، ثم توقف التنفيذ عند «${stopped.title}»: ${stopped.message}\n\nلم يُنفّذ ما بعده — صحّحي السبب واطلبيه من جديد.`
    : payload.doneText ?? `تم ✅ نفّذت ${payload.actions.length === 1 ? "التغيير" : `البنود كلها (${count(payload.actions.length, ITEM)})`}.`;
  const blocks: ChatBlock[] = payload.isUndo && !stopped ? [] : [{ type: "table", title: "نتيجة التنفيذ", columns: ["البند", "النتيجة"], rows: results }];
  return { text, blocks };
}
