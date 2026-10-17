// ملف الإنجاز folders as data (table `folders`): each member's layout, and the edits رئيسة النطاق makes to one member's
// folders or to many members' at once. Edits address folders by key (the same key means the same folder in every member
// who has it), are worked out in memory, and are written in two statements whatever the number of members — the
// database is far away, so a round trip per member would make editing the whole team slow.
import { randomInt, randomUUID } from "node:crypto";
import { isFileFolder, type FolderKind, type FolderLayout, type FolderScope } from "@rasd/schemas";
import type { Row, Sql } from "./db.js";
import { folderLayout } from "./workspace.js";

const byCluster = (rows: Row[]) => {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row.clusterId);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(row);
  }
  return groups;
};

/** Each cluster's layout (live folders and removed ones; the defaults while she has no folder rows). One query. */
export async function loadLayouts(db: Sql, clusterIds: string[]) {
  const rows = clusterIds.length
    ? await db`select * from folders where cluster_id = any(${db.array(clusterIds)}::uuid[]) order by sort_order, created_at`
    : [];
  const groups = byCluster(rows);
  return new Map(clusterIds.map(id => [id, folderLayout(groups.get(id) ?? [])]));
}

/**
 * Her live files per folder key: `member` in her own folders, `school` in her schools' folders summed over her schools,
 * `inSchools` every file in one of her schools. A removed school's files are left out: no folder of hers shows them.
 */
export type FolderCounts = { member: Record<string, number>; school: Record<string, number>; inSchools: number };

export async function loadFileCounts(db: Sql, clusterIds: string[]) {
  const rows = clusterIds.length ? await db`
    select a.cluster_id, a.folder, a.school_id is not null as in_school, count(*)::int as count
    from attachments a left join schools s on s.id = a.school_id
    where a.cluster_id = any(${db.array(clusterIds)}::uuid[]) and a.deleted_at is null and a.folder is not null
      and (a.school_id is null or s.deleted_at is null)
    group by a.cluster_id, a.folder, a.school_id is not null` : [];
  const counts = new Map(clusterIds.map(id => [id, { member: {}, school: {}, inSchools: 0 } as FolderCounts]));
  for (const row of rows) {
    const entry = counts.get(String(row.clusterId))!;
    if (row.inSchool) { entry.school[row.folder] = row.count; entry.inSchools += row.count; }
    else entry.member[row.folder] = row.count;
  }
  return counts;
}

const KEY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new folder's key: random, never a default key, so one key added to several members means the same folder in each. */
export const newFolderKey = () => `f_${Array.from({ length: 10 }, () => KEY_CHARS[randomInt(KEY_CHARS.length)]).join("")}`;

/**
 * Gives these clusters the default folders when they have no folder rows at all (removed rows count: a member whose
 * folders were all removed keeps none). Only edits call it — a read shows the defaults without writing them.
 */
export async function ensureFolders(db: Sql, clusterIds: string[]) {
  await db`
    select app.seed_default_folders(c.id) from clusters c
    where c.id = any(${db.array(clusterIds)}::uuid[]) and not exists (select 1 from folders f where f.cluster_id = c.id)`;
}

// ───────── edits ─────────
type Folder = {
  id: string; clusterId: string; scope: FolderScope; key: string; label: string; parentKey: string | null; kind: FolderKind;
  sortOrder: number; createdAt: Date; deletedAt: Date | null;
};

/** One member's folders being edited in memory. `saved` is each row as the database has it (no entry: a new row). */
export type Draft = { clusterId: string; folders: Folder[]; saved: Map<string, string>; now: Date };

const stateOf = (folder: Folder) => JSON.stringify([folder.label, folder.parentKey, folder.sortOrder, folder.deletedAt?.getTime() ?? null]);

/**
 * Opens these clusters' folders for editing. Call it in the transaction that locked the clusters; a cluster without
 * folder rows gets the defaults first (rare: every member is seeded when she is created).
 */
export async function openDrafts(tx: Sql, clusterIds: string[], now: Date) {
  const load = async (ids: string[]) =>
    byCluster(await tx`select * from folders where cluster_id = any(${tx.array(ids)}::uuid[]) order by sort_order, created_at`);
  const rows = clusterIds.length ? await load(clusterIds) : new Map<string, Row[]>();
  const unseeded = clusterIds.filter(id => !rows.has(id));
  if (unseeded.length) {
    await ensureFolders(tx, unseeded);
    for (const [id, seeded] of await load(unseeded)) rows.set(id, seeded);
  }
  return new Map(clusterIds.map(clusterId => {
    const folders: Folder[] = (rows.get(clusterId) ?? []).map(row => ({
      id: String(row.id), clusterId, scope: row.scope, key: row.key, label: row.label, parentKey: row.parentKey ?? null, kind: row.kind,
      sortOrder: Number(row.sortOrder), createdAt: row.createdAt, deletedAt: row.deletedAt ?? null,
    }));
    const draft: Draft = { clusterId, folders, saved: new Map(folders.map(folder => [folder.id, stateOf(folder)])), now };
    return [clusterId, draft];
  }));
}

const bySortOrder = (a: Folder, b: Folder) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime();
const inScope = (draft: Draft, scope: FolderScope) => draft.folders.filter(folder => folder.scope === scope);
const findFolder = (draft: Draft, scope: FolderScope, key: string) => draft.folders.find(folder => folder.scope === scope && folder.key === key);
const childrenOf = (draft: Draft, folder: Folder) => draft.folders.filter(item => item.scope === folder.scope && item.parentKey === folder.key);
const lastAmong = (folders: Folder[]) => Math.max(-1, ...folders.map(folder => folder.sortOrder)) + 1;

/** The layout members will see once the draft is saved. */
export const draftLayout = (draft: Draft) => folderLayout([...draft.folders].sort(bySortOrder));

/** Whether saving the draft would change anything. */
export const draftChanged = (draft: Draft) => draft.folders.some(folder => draft.saved.get(folder.id) !== stateOf(folder));

/**
 * Sort order follows the tree: each top-level folder, then its sub-folders (removed ones keep their place, so a restored
 * folder comes back where it was).
 */
function renumber(draft: Draft, scope: FolderScope) {
  const folders = inScope(draft, scope).sort(bySortOrder);
  const byKey = new Map(folders.map(folder => [folder.key, folder]));
  // One level only: a removed sub-folder whose parent has since become a sub-folder itself is kept as a top-level folder,
  // which is where restoring it brings it back.
  for (const folder of folders) if (folder.parentKey && byKey.get(folder.parentKey)?.parentKey) folder.parentKey = null;
  folders.filter(folder => !folder.parentKey)
    .flatMap(top => [top, ...folders.filter(folder => folder.parentKey === top.key)])
    .forEach((folder, index) => { folder.sortOrder = index; });
}

/** Removes a folder with its live sub-folders, all with the same time — restoring it brings back exactly those. */
function remove(draft: Draft, folder: Folder) {
  for (const item of [folder, ...childrenOf(draft, folder).filter(child => !child.deletedAt)]) item.deletedAt = draft.now;
}

/** Restores a folder with the sub-folders removed with it; a sub-folder whose parent is removed brings the parent back too. */
function restore(draft: Draft, folder: Folder) {
  const removedAt = folder.deletedAt?.getTime();
  const parent = folder.parentKey ? findFolder(draft, folder.scope, folder.parentKey) : undefined;
  if (parent) parent.deletedAt = null;
  for (const item of [folder, ...childrenOf(draft, folder).filter(child => child.deletedAt?.getTime() === removedAt)]) item.deletedAt = null;
}

export type FolderOp =
  | { type: "add"; key: string; label: string; parentKey: string | null; afterKey: string | null }
  | { type: "rename"; key: string; label: string }
  | { type: "delete" | "restore"; key: string }
  | { type: "move"; key: string; parentKey: string | null }
  | { type: "order"; parentKey: string | null; keys: string[] }
  | { type: "hide_schools" | "show_schools" };

/** What an edit did to one member (`done`: a line for her timeline), or why she was left as she is (`skipped`). */
export type Outcome = { done: string } | { skipped: string };

const MISSING = "لا يوجد هذا المجلد عندها";
const NOT_A_PARENT = "لا يمكن وضع مجلد داخل هذا المجلد";
const SAME_NAME = "عندها مجلد بهذا الاسم في المكان نفسه";

/**
 * Applies one edit to a member's folders (in one scope). An added folder gets the op's key — the same in every member of
 * the edit. A sub-folder's parent must be one of her live top-level folders that holds files (one level only).
 */
export function applyOp(draft: Draft, scope: FolderScope, op: FolderOp): Outcome {
  const outcome = apply(draft, scope, op);
  if ("done" in outcome) renumber(draft, scope);
  return outcome;
}

function apply(draft: Draft, scope: FolderScope, op: FolderOp): Outcome {
  const live = (key: string) => { const folder = findFolder(draft, scope, key); return folder && !folder.deletedAt ? folder : undefined; };
  const siblings = (parentKey: string | null) => inScope(draft, scope).filter(folder => folder.parentKey === parentKey);
  const nameTaken = (parentKey: string | null, label: string, except?: Folder) =>
    siblings(parentKey).some(folder => folder !== except && !folder.deletedAt && folder.label === label);
  /** The parent named by a key: undefined when the key names no live folder of hers, null for the top level. */
  const parentOf = (key: string | null) => (key === null ? null : live(key));
  const canHold = (parent: Folder) => !parent.parentKey && parent.kind === "files";

  switch (op.type) {
    case "add": {
      const parent = parentOf(op.parentKey);
      if (parent === undefined) return { skipped: MISSING };
      if (parent && !canHold(parent)) return { skipped: NOT_A_PARENT };
      const parentKey = parent?.key ?? null;
      if (nameTaken(parentKey, op.label)) return { skipped: SAME_NAME };
      const after = op.afterKey ? siblings(parentKey).find(folder => folder.key === op.afterKey && !folder.deletedAt) : undefined;
      draft.folders.push({
        id: randomUUID(), clusterId: draft.clusterId, scope, key: op.key, label: op.label, parentKey, kind: "files",
        sortOrder: after ? after.sortOrder + 0.5 : lastAmong(siblings(parentKey)), createdAt: draft.now, deletedAt: null,
      });
      return { done: `إضافة «${op.label}»` };
    }
    case "rename": {
      const folder = live(op.key);
      if (!folder) return { skipped: MISSING };
      if (folder.label === op.label) return { skipped: "الاسم لم يتغيّر" };
      if (nameTaken(folder.parentKey, op.label, folder)) return { skipped: SAME_NAME };
      const before = folder.label;
      folder.label = op.label;
      return { done: `إعادة تسمية «${before}» إلى «${op.label}»` };
    }
    case "delete": {
      const folder = live(op.key);
      if (!folder) return { skipped: MISSING };
      if (folder.kind === "schools") return { skipped: "«مدارس المشرفة» تُخفى ولا تُحذف" };
      remove(draft, folder);
      return { done: `حذف «${folder.label}»` };
    }
    case "restore": {
      const folder = findFolder(draft, scope, op.key);
      if (!folder) return { skipped: MISSING };
      if (!folder.deletedAt) return { skipped: "المجلد ظاهر عندها" };
      restore(draft, folder);
      return { done: `استعادة «${folder.label}»` };
    }
    case "move": {
      const folder = live(op.key);
      const parent = parentOf(op.parentKey);
      if (!folder || parent === undefined) return { skipped: MISSING };
      if (folder.kind === "schools" || (parent && (!canHold(parent) || parent === folder))) return { skipped: NOT_A_PARENT };
      if (folder.parentKey === (parent?.key ?? null)) return { skipped: "المجلد في هذا المكان" };
      if (parent && childrenOf(draft, folder).some(child => !child.deletedAt)) return { skipped: "فيه مجلدات فرعية فلا يصبح مجلداً فرعياً" };
      if (nameTaken(parent?.key ?? null, folder.label)) return { skipped: SAME_NAME };
      folder.sortOrder = lastAmong(siblings(parent?.key ?? null));
      folder.parentKey = parent?.key ?? null;
      return { done: parent ? `نقل «${folder.label}» إلى «${parent.label}»` : `نقل «${folder.label}» إلى المجلدات الرئيسية` };
    }
    case "order": {
      if (parentOf(op.parentKey) === undefined) return { skipped: MISSING };
      const current = siblings(op.parentKey).sort(bySortOrder);
      // Keys she does not have are passed over, so one order (from the head's screen) works for members who differ a little.
      const listed = op.keys.map(key => current.find(folder => folder.key === key && !folder.deletedAt)).filter((folder): folder is Folder => Boolean(folder));
      if (!listed.length) return { skipped: MISSING };
      const ordered = [...listed, ...current.filter(folder => !listed.includes(folder))];
      if (ordered.every((folder, index) => folder === current[index])) return { skipped: "الترتيب لم يتغيّر" };
      ordered.forEach((folder, index) => { folder.sortOrder = index; });
      return { done: "ترتيب المجلدات" };
    }
    case "hide_schools":
    case "show_schools": {
      const entry = draft.folders.find(folder => folder.scope === "member" && folder.kind === "schools");
      if (!entry) return { skipped: MISSING };
      const hide = op.type === "hide_schools";
      if (hide === Boolean(entry.deletedAt)) return { skipped: hide ? "«مدارس المشرفة» مخفية عندها" : "«مدارس المشرفة» ظاهرة عندها" };
      if (hide) remove(draft, entry); else restore(draft, entry);
      return { done: `${hide ? "إخفاء" : "إظهار"} «${entry.label}»` };
    }
  }
}

export type SyncDiff = { added: string[]; renamed: string[]; removed: string[]; restored: string[] };

/**
 * Makes one scope of a member's folders exactly the source's live folders: same keys, labels, sub-folders and order, and
 * «مدارس المشرفة» shown or hidden like hers. Her folders the source does not have are removed (files wait in «غير مصنّفة»).
 */
export function syncScope(draft: Draft, source: Draft, scope: FolderScope, diff: SyncDiff) {
  const wanted = inScope(source, scope).filter(folder => !folder.deletedAt).sort(bySortOrder);
  const keys = new Set(wanted.map(folder => folder.key));
  for (const folder of inScope(draft, scope)) {
    if (keys.has(folder.key)) continue;
    if (!folder.deletedAt) { folder.deletedAt = draft.now; diff.removed.push(folder.label); }
    folder.sortOrder += wanted.length; // after the source's folders, in the order they had
  }
  wanted.forEach((model, sortOrder) => {
    const folder = findFolder(draft, scope, model.key);
    if (!folder) {
      draft.folders.push({ ...model, id: randomUUID(), clusterId: draft.clusterId, sortOrder, createdAt: draft.now });
      diff.added.push(model.label);
      return;
    }
    if (folder.deletedAt) diff.restored.push(model.label);
    else if (folder.label !== model.label) diff.renamed.push(`${folder.label} ← ${model.label}`);
    Object.assign(folder, { label: model.label, parentKey: model.parentKey, sortOrder, deletedAt: null });
  });
  renumber(draft, scope);
}

/** How many of her files were in a folder she could open before the edit and are not after it (now in «غير مصنّفة»). */
export function filesLeaving(counts: FolderCounts, before: FolderLayout, after: FolderLayout) {
  let total = 0;
  for (const [inSchool, perFolder] of [[false, counts.member], [true, counts.school]] as const) {
    for (const [key, count] of Object.entries(perFolder)) {
      if (isFileFolder(before, key, inSchool) && !isFileFolder(after, key, inSchool)) total += count;
    }
  }
  return total;
}

/** Writes what the drafts changed: the new folders in one insert, every changed row in one update. */
export async function saveDrafts(tx: Sql, drafts: Draft[]) {
  const added = drafts.flatMap(draft => draft.folders.filter(folder => !draft.saved.has(folder.id)));
  const changed = drafts.flatMap(draft => draft.folders.filter(folder => draft.saved.has(folder.id) && draft.saved.get(folder.id) !== stateOf(folder)));
  const column = (value: (folder: Folder) => string | number | null) => tx.array(changed.map(value) as string[]);
  await Promise.all([
    added.length ? tx`insert into folders ${tx(added.map(({ id, clusterId, scope, key, label, parentKey, kind, sortOrder }) =>
      ({ id, clusterId, scope, key, label, parentKey, kind, sortOrder })))}` : null,
    changed.length ? tx`
      update folders f set label = v.label, parent_key = v.parent_key, sort_order = v.sort_order, deleted_at = v.deleted_at
      from unnest(
        ${column(folder => folder.id)}::uuid[], ${column(folder => folder.label)}::text[], ${column(folder => folder.parentKey)}::text[],
        ${column(folder => folder.sortOrder)}::int[], ${column(folder => folder.deletedAt?.toISOString() ?? null)}::timestamptz[]
      ) as v(id, label, parent_key, sort_order, deleted_at)
      where f.id = v.id` : null,
  ]);
}
