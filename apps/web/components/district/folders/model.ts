// ملف الإنجاز folders on the head's side: the shapes of /district/folders (one member's or everyone's layout) and the
// two writes: bulk (one change, addressed by folder key, applied to one or many members) and sync (make members' folders
// exactly another member's). Both take dryRun, which answers with what would happen and changes nothing.
import { DEFAULT_FOLDERS, type FolderDef, type FolderLayout, type FolderScope } from "@rasd/schemas";

/** Her live files per folder key: her own, and her schools' (summed over the schools). */
export type FolderCounts = { member: Record<string, number>; school: Record<string, number>; inSchools: number };

/** One member in GET /district/folders. */
export type FolderMember = { memberId: string; name: string; title: string; layout: FolderLayout; counts: FolderCounts };

export type FolderOp =
  | { type: "add"; label: string; parentKey: string | null }
  | { type: "rename"; key: string; label: string }
  | { type: "delete"; key: string }
  | { type: "restore"; key: string }
  | { type: "order"; parentKey: string | null; keys: string[] }
  | { type: "hide_schools" }
  | { type: "show_schools" };

export type BulkRequest = { memberIds: string[]; scope: FolderScope; dryRun?: boolean; op: FolderOp };
/** `filesToUnsorted` (delete, hide_schools): her files that leave their folder for «غير مصنّفة». */
export type BulkResult = {
  applied: boolean;
  results: { memberId: string; name: string; status: "done" | "skipped"; note?: string; filesToUnsorted?: number }[];
};

/** Per member: the folder labels added, renamed, removed and restored. */
export type SyncChange = {
  memberId: string; name: string; added: string[]; renamed: string[]; removed: string[]; restored: string[]; filesToUnsorted: number;
};
export type SyncResult = { applied: boolean; results: SyncChange[] };

export const MEMBERS = { one: "مشرفة واحدة", two: "مشرفتان", few: "مشرفات", many: "مشرفة" };
export const FILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفاً" };

/** Two members have the same folders when their live folders match: keys, labels, parents, order and «مدارس المشرفة». */
export function layoutSignature(layout: FolderLayout) {
  const part = (list: readonly FolderDef[]) => list.map(folder => [folder.key, folder.label, folder.parent ?? "", folder.kind ?? "files"]);
  return JSON.stringify([part(layout.member), part(layout.school)]);
}

export const DEFAULT_SIGNATURE = layoutSignature(DEFAULT_FOLDERS);

/** «الإدارة المدرسية» and «اداره مدرسيه» are the same الصفة (typing varies; the folder migration matches the same way). */
export const titleKey = (title: string) =>
  title.trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/(^|\s)ال/g, "$1");
