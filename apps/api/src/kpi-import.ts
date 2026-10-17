// مؤشرات الأداء from and to Excel: her sheet «مؤشرات التقويم المدرسي» (one sheet per executive team, a group row above
// the header row, formula text columns next to each number) is read into the register, and the register is written
// back in the same layout. The parser follows the real workbook: instruction/notes/lookup sheets are skipped, template
// rows (only «حكومي» and formula text) are ignored, derived text columns are never imported, and a blank cell never
// overwrites a value.
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import {
  KPI_DOMAINS, KPI_STANDARDS, kpiSupport, looksLikeMinistryNo, ministryKey, toWesternDigits,
  type KpiImportResult, type KpiStandardKey, type SchoolKpi,
} from "@rasd/schemas";
import { auditWith, type AuditContext } from "./audit.js";
import { atomically, type Row, type Sql } from "./db.js";
import { findDocument, readDocumentFile } from "./documents.js";
import { ApiError, invalid, notFound } from "./errors.js";
import { arabicKey, arabicWords, inScoreRange, readScore } from "./kpis.js";
import { cleanText } from "./parse.js";

const MAX_SHEET_ROWS = 5_000;
const MAX_COLUMNS = 80;
const MAX_IMPORT_ROWS = 2_000;
const SAMPLE_ROWS = 5;
/** «التعليمات» (its example schools and rubric rows), «ملاحظات», and lookup sheets like «Sheet1». */
const SKIPPED_SHEETS = /تعليمات|ملاحظات|^Sheet\d*$/i;
const UNDO_HOURS = 24;

const TEXT_FIELDS = ["ministryNo", "schoolName", "stage", "authority", "region", "sector", "evaluationType", "followUpLevel", "memberName"] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type ScoreField = "overallScore" | "outcomesScore";
type Role =
  | { kind: "text"; field: TextField } | { kind: "score"; field: ScoreField } | { kind: "standard"; field: KpiStandardKey }
  | { kind: "drop" } | { kind: "overall-if-numeric" };
const DROP: Role = { kind: "drop" };
const textRole = (field: TextField): Role => ({ kind: "text", field });

/** What a row of the file says: only the fields with a value (a blank cell is absent, so it never overwrites). */
type FileValues = Partial<Record<TextField, string>> & Partial<Record<ScoreField, number | null>> & {
  standards: Partial<Record<KpiStandardKey, number | null>>;
  extra: { label: string; value: string }[];
};
type FileRow = { sheet: string; row: number; key: string; values: FileValues };
type ParsedSheet = { name: string; yearHint: string; rows: FileRow[]; skipped: KpiImportResult["skipped"] };

// ───────── reading the workbook ─────────
const has = (words: string[], phrase: string) => {
  const wanted = arabicWords(phrase);
  return words.some((_, start) => wanted.every((word, offset) => words[start + offset] === word));
};

/** A header cell's meaning, from its words (any spelling of ة/ه, with or without «ال»). Null = not recognised. */
function roleOf(header: string): Role | null {
  const words = arabicWords(header);
  if (!words.length) return null;
  // Text the sheet derives from the numbers by formula, and the team head's name: never imported.
  if (has(words, "نصي") || has(words, "اسم رئيس الفريق التنفيذي")) return DROP;
  if (has(words, "الرقم الوزاري")) return textRole("ministryNo");
  if (has(words, "اسم المدرسة")) return textRole("schoolName");
  if (has(words, "عضو الفريق التنفيذي") || has(words, "المتابع")) return textRole("memberName");
  if (has(words, "مستوى المتابعة")) return textRole("followUpLevel");
  if (has(words, "درجة النواتج")) return { kind: "score", field: "outcomesScore" };
  if (has(words, "المستوى العام")) return has(words, "رقما") ? { kind: "score", field: "overallScore" } : { kind: "overall-if-numeric" };
  const standard = KPI_STANDARDS.find(item => has(words, item.label));
  if (standard) return has(words, "رقما") ? { kind: "standard", field: standard.key } : DROP;
  // «نواتج التعلم» next to درجة النواتج, and the domain names of the group row, are labels of derived columns.
  if (KPI_DOMAINS.some(domain => words.join(" ") === arabicKey(domain.label))) return DROP;
  if (has(words, "نوع التقويم")) return textRole("evaluationType");
  if (has(words, "المرحلة")) return textRole("stage");
  if (has(words, "السلطة")) return textRole("authority");
  if (has(words, "المنطقة") || has(words, "المحافظة")) return textRole("region");
  if (has(words, "القطاع")) return textRole("sector");
  return null;
}

type Cell = string | number | boolean | null | undefined;
const cellText = (cell: Cell) => (typeof cell === "string" || typeof cell === "number" ? cleanText(cell) : "");
const isBlank = (text: string) => text === "" || text === "-";

function parseSheet(name: string, sheet: XLSX.WorkSheet): ParsedSheet | null {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  range.e.c = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
  const grid = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true, range });
  // A register sheet has a header row with «اسم المدرسة»; the row above it holds the column groups.
  const headerAt = grid.slice(0, 10).findIndex(row => row.some(cell => {
    const role = roleOf(cellText(cell));
    return role?.kind === "text" && role.field === "schoolName";
  }));
  if (headerAt < 0) return null;
  const header = grid[headerAt];
  const group = grid[headerAt - 1] ?? [];
  const yearHint = toWesternDigits([...header, ...group].map(cellText).join(" ")).match(/(?<!\d)1[34]\d\d(?!\d)/)?.[0] ?? "";

  // Each column: its header cell, or — when that is empty, «-» or not recognised — the group cell above it.
  const columns = Array.from({ length: Math.max(header.length, group.length) }, (_, index) => {
    const own = cellText(header[index]);
    const role = roleOf(own) ?? roleOf(cellText(group[index]));
    return { index, role, label: isBlank(own) ? cellText(group[index]) : own };
  });
  const data = grid.slice(headerAt + 1);
  const firstRow = range.s.r + headerAt + 2;
  // «المستوى العام» without «رقما» is the score only when it holds numbers (otherwise it is the level as text).
  if (!columns.some(({ role }) => role?.kind === "score" && role.field === "overallScore")) {
    const overall = columns.find(column => column.role?.kind === "overall-if-numeric"
      && data.some(row => !isBlank(cellText(row[column.index])))
      && data.every(row => isBlank(cellText(row[column.index])) || readScore(row[column.index]) !== undefined));
    if (overall) overall.role = { kind: "score", field: "overallScore" };
  }

  const rows: FileRow[] = [];
  const skipped: KpiImportResult["skipped"] = [];
  for (const [offset, cells] of data.entries()) {
    const values: FileValues = { standards: {}, extra: [] };
    let numbers = 0;
    let outOfRange = false;
    for (const { index, role, label } of columns) {
      const cell = cells[index];
      if (role === null) {
        const value = cellText(cell);
        if (label && !isBlank(value)) values.extra.push({ label: label.slice(0, 200), value: value.slice(0, 500) });
      } else if (role.kind === "text") {
        const value = cellText(cell);
        if (!isBlank(value)) values[role.field] = value.slice(0, role.field === "ministryNo" ? 40 : 200);
      } else if (role.kind === "score" || role.kind === "standard") {
        const score = readScore(cell);
        if (score === undefined) continue;
        numbers += 1;
        if (!inScoreRange(score)) outOfRange = true;
        else if (role.kind === "score") values[role.field] = score;
        else values.standards[role.field] = score;
      }
    }
    const key = ministryKey(values.ministryNo ?? "");
    if (!values.schoolName && !key && !numbers) continue; // an empty template row: only «حكومي» and formula text
    const row = firstRow + offset;
    const skip = !values.schoolName ? "اسم المدرسة فارغ"
      : outOfRange ? "درجة خارج النطاق (٠–١٠٠)"
      : !looksLikeMinistryNo(key) && !numbers ? "لا يوجد رقم وزاري ولا درجات"
      : null;
    if (skip) { skipped.push({ sheet: name, row, reason: skip }); continue; }
    // Outside the external evaluation a 0 means «غير متاح» (the self-evaluated and unclassified schools), not a score.
    if (!arabicWords(values.evaluationType ?? "").includes("خارجي")) {
      for (const field of ["overallScore", "outcomesScore"] as const) if (values[field] === 0) values[field] = null;
      for (const [standard, score] of Object.entries(values.standards)) if (score === 0) values.standards[standard as KpiStandardKey] = null;
    }
    rows.push({ sheet: name, row, key, values });
  }
  return { name, yearHint, rows, skipped };
}

/** The register sheets of a workbook (raw cell values, no date conversion). */
export function parseKpiWorkbook(buffer: Buffer): ParsedSheet[] {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, sheetRows: MAX_SHEET_ROWS }); }
  catch { throw new ApiError(422, "UNREADABLE_FILE", "تعذّرت قراءة الملف — ارفعي ملف Excel"); }
  return workbook.SheetNames.filter(name => !SKIPPED_SHEETS.test(name.trim()))
    .map(name => parseSheet(name, workbook.Sheets[name]))
    .filter((sheet): sheet is ParsedSheet => sheet !== null);
}

// ───────── matching names of «عضو الفريق التنفيذي المتابع» ─────────
type Member = { id: string; name: string; words: Set<string> };
type Resolution = { memberId: string | null; resolved: boolean; status: KpiImportResult["names"][number]["status"] };

/**
 * Her choice for the name, then a saved alias, then a strict match: every word of the sheet's name (بن/بنت included) is
 * a word of exactly one live member's full name. Several → ambiguous, none → unknown (the row keeps its assignment).
 */
function nameResolver(members: Member[], aliases: Map<string, string | null>, chosen: Map<string, string | null>) {
  const live = new Set(members.map(member => member.id));
  return (name: string): Resolution => {
    const key = arabicKey(name);
    if (chosen.has(key)) return { memberId: chosen.get(key)!, resolved: true, status: "chosen" };
    const alias = aliases.get(key);
    if (alias === null || (alias !== undefined && live.has(alias))) return { memberId: alias, resolved: true, status: "alias" };
    const words = arabicWords(name);
    const hits = members.filter(member => words.every(word => member.words.has(word)));
    if (hits.length === 1) return { memberId: hits[0].id, resolved: true, status: "matched" };
    return { memberId: null, resolved: false, status: hits.length ? "ambiguous" : "unknown" };
  };
}

// ───────── the diff against the register ─────────
/** The columns an import writes (and an undo restores). */
type KpiState = {
  ministryNo: string; schoolName: string; stage: string; authority: string; region: string; sector: string; evaluationType: string;
  overallScore: number | null; outcomesScore: number | null; followUpLevel: string;
  standards: Partial<Record<KpiStandardKey, number | null>>; extra: { label: string; value: string }[];
  memberName: string; assignedMemberId: string | null; assignmentSource: string; source: string; sheet: string;
};
const DATA_FIELDS = [
  "ministryNo", "schoolName", "stage", "authority", "region", "sector", "evaluationType", "overallScore", "outcomesScore",
  "followUpLevel", "memberName", "assignedMemberId",
] as const;

const stateOf = (row: Row): KpiState => ({
  ministryNo: row.ministryNo, schoolName: row.schoolName, stage: row.stage, authority: row.authority, region: row.region, sector: row.sector,
  evaluationType: row.evaluationType, overallScore: row.overallScore ?? null, outcomesScore: row.outcomesScore ?? null, followUpLevel: row.followUpLevel,
  standards: row.standards ?? {}, extra: row.extra ?? [], memberName: row.memberName,
  assignedMemberId: row.assignedMemberId ? String(row.assignedMemberId) : null, assignmentSource: row.assignmentSource, source: row.source, sheet: row.sheet,
});

const sameStandards = (a: KpiState["standards"], b: KpiState["standards"]) =>
  KPI_STANDARDS.every(({ key }) => (a[key] ?? null) === (b[key] ?? null));
const extraText = (extra: KpiState["extra"]) => JSON.stringify(extra.map(item => [item.label, item.value]));
const sameData = (a: KpiState, b: KpiState) =>
  sameStandards(a.standards, b.standards) && extraText(a.extra) === extraText(b.extra) && DATA_FIELDS.every(field => a[field] === b[field]);

/** Writes whole rows in one statement (an import's updates, an undo's before-values). */
async function writeStates(db: Sql, states: (KpiState & { id: string })[], updatedBy: string | null) {
  if (!states.length) return;
  const records = states.map(state => Object.fromEntries(Object.entries(state).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value])));
  await db`
    update school_kpis k set
      ministry_no = v.ministry_no, school_name = v.school_name, stage = v.stage, authority = v.authority, region = v.region,
      sector = v.sector, evaluation_type = v.evaluation_type, overall_score = v.overall_score, outcomes_score = v.outcomes_score,
      follow_up_level = v.follow_up_level, standards = v.standards, extra = v.extra, member_name = v.member_name,
      assigned_member_id = v.assigned_member_id, assignment_source = v.assignment_source, source = v.source, sheet = v.sheet,
      updated_by = ${updatedBy}
    from jsonb_to_recordset(${db.json(records as never)}::jsonb) as v(
      id uuid, ministry_no text, school_name text, stage text, authority text, region text, sector text, evaluation_type text,
      overall_score float8, outcomes_score float8, follow_up_level text, standards jsonb, extra jsonb, member_name text,
      assigned_member_id uuid, assignment_source text, source text, sheet text)
    where k.id = v.id`;
}

export type KpiImportOptions = {
  /** true: only report what would change. */
  dryRun: boolean;
  /** merge: update and add (nothing removed) · replace: also remove the year's imported rows the file no longer has. */
  mode: "merge" | "replace";
  /** The evaluation year ('' = none); null = the sheet's «للعام 1447», else ''. */
  year?: string | null;
  /** Sheet names to import; null = every register sheet. */
  sheets?: string[] | null;
  /** Her choices for names of «عضو الفريق التنفيذي المتابع»: name → member id, or null for «ليست من فريقي». */
  names?: Record<string, string | null>;
};

/** Plans the import against the register (inside the apply transaction when applying, so the diff is current). */
async function planImport(db: Sql, districtId: string, year: string, rows: FileRow[], options: KpiImportOptions) {
  const [existing, aliasRows, memberRows] = await Promise.all([
    db`select * from school_kpis where district_id = ${districtId} and year = ${year} and deleted_at is null order by sort_order, created_at`,
    db`select alias, member_id from kpi_member_aliases where district_id = ${districtId}`,
    db`select p.id, p.name from profiles p join clusters c on c.member_id = p.id
      where p.district_id = ${districtId} and p.role = 'member' and p.deleted_at is null order by p.name`,
  ]);
  const members: Member[] = memberRows.map(row => ({ id: String(row.id), name: String(row.name), words: new Set(arabicWords(row.name)) }));
  const memberNames = new Map(members.map(member => [member.id, member.name]));
  for (const [name, memberId] of Object.entries(options.names ?? {})) {
    if (memberId !== null && !memberNames.has(memberId)) throw invalid({ names: `«${name}»: اختاري مشرفة من القائمة` });
  }
  const chosen = new Map(Object.entries(options.names ?? {}).map(([name, memberId]) => [arabicKey(name), memberId]));
  const resolve = nameResolver(members, new Map(aliasRows.map(row => [String(row.alias), row.memberId ? String(row.memberId) : null])), chosen);

  // Each distinct name in the file (spaces trimmed), how many schools it follows, and who it goes to.
  const counts = new Map<string, number>();
  for (const row of rows) if (row.values.memberName) counts.set(row.values.memberName, (counts.get(row.values.memberName) ?? 0) + 1);
  const resolutions = new Map([...counts.keys()].map(name => [name, resolve(name)]));
  const names = [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => {
    const { memberId, status } = resolutions.get(name)!;
    return { name, count, memberId, memberName: memberId ? memberNames.get(memberId) ?? null : null, status };
  });

  // Rows are matched by ministry number; two rows without one only by a school name that is unique on both sides.
  const byKey = new Map(existing.filter(row => row.ministryKey).map(row => [String(row.ministryKey), row]));
  const uniqueByName = <T>(items: T[], name: (item: T) => string) => {
    const groups = new Map<string, T[]>();
    for (const item of items) { const key = arabicKey(name(item)); groups.set(key, [...(groups.get(key) ?? []), item]); }
    return new Map([...groups].filter(([, group]) => group.length === 1).map(([key, [item]]) => [key, item]));
  };
  const existingByName = uniqueByName(existing.filter(row => !row.ministryKey), row => String(row.schoolName));
  const fileByName = uniqueByName(rows.filter(row => !row.key), row => row.values.schoolName ?? "");
  const nextOrder = existing.reduce((max, row) => Math.max(max, Number(row.sortOrder) + 1), 0);

  const added: (KpiState & { id: string })[] = [];
  const updated: { id: string; before: KpiState; next: KpiState }[] = [];
  const matched = new Set<string>();
  let unchanged = 0;
  for (const row of rows) {
    const name = arabicKey(row.values.schoolName ?? "");
    const target = row.key ? byKey.get(row.key) : fileByName.get(name) === row ? existingByName.get(name) : undefined;
    const resolution = row.values.memberName ? resolutions.get(row.values.memberName)! : null;
    const { standards, extra, ...fields } = row.values;
    if (!target) {
      added.push({
        id: randomUUID(), ministryNo: "", stage: "", authority: "", region: "", sector: "", evaluationType: "", followUpLevel: "", memberName: "",
        overallScore: null, outcomesScore: null, schoolName: "", ...fields, standards, extra,
        assignedMemberId: resolution?.resolved ? resolution.memberId : null, assignmentSource: "import", source: "import", sheet: row.sheet,
      });
      continue;
    }
    matched.add(String(target.id));
    const before = stateOf(target);
    const next: KpiState = {
      ...before, ...fields, standards: { ...before.standards, ...standards }, extra: extra.length ? extra : before.extra,
      // Her own assignments win; an unresolved name keeps the current one.
      assignedMemberId: before.assignmentSource !== "manual" && resolution?.resolved ? resolution.memberId : before.assignedMemberId,
    };
    if (sameData(before, next)) unchanged += 1;
    else updated.push({ id: String(target.id), before, next: { ...next, source: "import", sheet: row.sheet } });
  }
  const removed = options.mode === "replace"
    ? existing.filter(row => row.source === "import" && !matched.has(String(row.id))).map(row => ({ id: String(row.id), schoolName: String(row.schoolName) }))
    : [];
  // Her choices for names in this file are remembered for the next import.
  const aliases = [...chosen].filter(([key]) => key && [...counts.keys()].some(name => arabicKey(name) === key))
    .map(([alias, memberId]) => ({ districtId, alias, memberId }));
  return { added: added.map((state, index) => ({ ...state, sortOrder: nextOrder + index })), updated, unchanged, removed, names, aliases };
}

/**
 * POST /district/kpis/import (and the assistant's import_kpis): reads the file, matches it against the year's register,
 * and — unless dryRun — applies it in one transaction under a per-district lock, recording what changed for undo.
 */
export async function importKpis(db: Sql, context: AuditContext, file: { name: string; buffer: Buffer }, options: KpiImportOptions): Promise<KpiImportResult> {
  const districtId = context.actor.districtId;
  const parsed = parseKpiWorkbook(file.buffer);
  if (!parsed.length) throw new ApiError(422, "NOT_A_KPI_FILE", "لم أجد في الملف ورقة فيها عمود «اسم المدرسة» — هل هذا ملف المؤشرات؟");
  const included = options.sheets ? parsed.filter(sheet => options.sheets!.includes(sheet.name)) : parsed;
  if (!included.length) throw invalid({ sheets: "اختاري ورقة واحدة على الأقل" });
  const year = options.year ?? included.map(sheet => sheet.yearHint).find(Boolean) ?? "";

  // The same ministry number twice in the file: the first row is imported, the later ones are reported.
  const rows: FileRow[] = [];
  const skipped = included.flatMap(sheet => sheet.skipped);
  const seen = new Set<string>();
  for (const row of included.flatMap(sheet => sheet.rows)) {
    if (row.key && seen.has(row.key)) skipped.push({ sheet: row.sheet, row: row.row, reason: "الرقم الوزاري مكرر في الملف" });
    else { seen.add(row.key); rows.push(row); }
  }
  if (rows.length > MAX_IMPORT_ROWS) throw invalid({ file: `الملف فيه أكثر من ${MAX_IMPORT_ROWS} مدرسة — قسّميه على أكثر من ملف` });

  const result = (plan: Awaited<ReturnType<typeof planImport>>, importId: string | null): KpiImportResult => ({
    applied: importId !== null, importId, mode: options.mode, year,
    sheets: parsed.map(sheet => ({ name: sheet.name, rows: included.includes(sheet) ? rows.filter(row => row.sheet === sheet.name).length : sheet.rows.length, included: included.includes(sheet) })),
    rows: rows.length, added: plan.added.length, updated: plan.updated.length, unchanged: plan.unchanged,
    removed: plan.removed.length, removedNames: plan.removed.map(row => row.schoolName),
    skipped: skipped.sort((a, b) => parsed.findIndex(sheet => sheet.name === a.sheet) - parsed.findIndex(sheet => sheet.name === b.sheet) || a.row - b.row),
    names: plan.names,
    sample: parsed.flatMap(sheet => sheet.rows.slice(0, SAMPLE_ROWS).map(row => ({
      sheet: sheet.name, schoolName: row.values.schoolName ?? "", ministryNo: row.values.ministryNo ?? "",
      overallScore: row.values.overallScore ?? null, memberName: row.values.memberName ?? "",
    }))),
  });

  if (options.dryRun) return result(await planImport(db, districtId, year, rows, options), null);
  return atomically(db, async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${`kpis:${districtId}`}))`;
    const plan = await planImport(tx, districtId, year, rows, options);
    const importId = randomUUID();
    const summary = { rows: rows.length, added: plan.added.length, updated: plan.updated.length, unchanged: plan.unchanged, removed: plan.removed.length, skipped: skipped.length };
    const changes = { added: plan.added.map(row => row.id), updated: plan.updated.map(({ id, before }) => ({ id, before })), removed: plan.removed.map(row => row.id) };
    await Promise.all([
      plan.added.length && tx`insert into school_kpis ${tx(plan.added.map(({ standards, extra, ...row }) => ({
        ...row, districtId, year, standards: tx.json(standards as never), extra: tx.json(extra as never), updatedBy: context.actor.id,
      })))}`,
      writeStates(tx, plan.updated.map(({ id, next }) => ({ id, ...next })), context.actor.id),
      plan.removed.length && tx`update school_kpis set deleted_at = now(), updated_by = ${context.actor.id} where id = any(${tx.array(changes.removed)}::uuid[])`,
      plan.aliases.length && tx`
        insert into kpi_member_aliases ${tx(plan.aliases)}
        on conflict (district_id, alias) do update set member_id = excluded.member_id`,
      tx`insert into kpi_imports ${tx({
        id: importId, districtId, createdBy: context.actor.id, fileName: cleanText(file.name).slice(0, 200), year, mode: options.mode,
        summary: tx.json(summary), changes: tx.json(changes as never),
      })}`,
      auditWith(tx, context, { action: "import", entity: "school_kpis", entityId: importId, after: { fileName: file.name, year, mode: options.mode, ...summary } }),
    ]);
    return result(plan, importId);
  });
}

/** A file of the district (a chat upload or a member's file) to import: its name and bytes. */
export async function readKpiDocument(db: Sql, districtId: string, documentId: string) {
  const document = await findDocument(db, documentId);
  if (!document || document.districtId !== districtId) throw notFound("الملف غير موجود");
  return { name: document.name, buffer: await readDocumentFile(document) };
}

/**
 * Undoes an import within a day, if no later import is still applied: its rows are removed again, the rows it changed
 * get their earlier values back, and the rows it removed return.
 */
export async function undoKpiImport(db: Sql, context: AuditContext, importId: string) {
  const districtId = context.actor.districtId;
  return atomically(db, async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${`kpis:${districtId}`}))`;
    const [record] = await tx`
      select i.*, i.created_at < now() - make_interval(hours => ${UNDO_HOURS}) as expired,
        exists (select 1 from kpi_imports later where later.district_id = i.district_id and later.created_at > i.created_at and later.undone_at is null) as superseded
      from kpi_imports i where i.id = ${importId} and i.district_id = ${districtId}`;
    if (!record) throw notFound("الاستيراد غير موجود");
    if (record.undoneAt) throw new ApiError(409, "ALREADY_UNDONE", "تم التراجع عن هذا الاستيراد من قبل");
    if (record.expired) throw new ApiError(409, "UNDO_EXPIRED", "مضى أكثر من ٢٤ ساعة على هذا الاستيراد — لا يمكن التراجع عنه");
    if (record.superseded) throw new ApiError(409, "LATER_IMPORT", "تراجعي عن الاستيراد الأحدث أولاً");
    const changes = record.changes as { added: string[]; updated: { id: string; before: KpiState }[]; removed: string[] };
    await Promise.all([
      changes.added.length && tx`update school_kpis set deleted_at = now(), updated_by = ${context.actor.id} where id = any(${tx.array(changes.added)}::uuid[]) and deleted_at is null`,
      writeStates(tx, changes.updated.map(({ id, before }) => ({ id, ...before })), context.actor.id),
      changes.removed.length && tx`update school_kpis set deleted_at = null, updated_by = ${context.actor.id} where id = any(${tx.array(changes.removed)}::uuid[])`,
      tx`update kpi_imports set undone_at = now() where id = ${importId}`,
      auditWith(tx, context, {
        action: "undo", entity: "school_kpis", entityId: importId,
        after: { added: changes.added.length, updated: changes.updated.length, removed: changes.removed.length },
      }),
    ]);
    return { undone: true };
  });
}

/** The last imports of the district, newest first, with whether each can still be undone. */
export async function recentKpiImports(db: Sql, districtId: string) {
  const rows = await db`
    select i.id, i.created_at, i.file_name, i.year, i.mode, i.summary, i.undone_at,
      i.undone_at is null and i.created_at >= now() - make_interval(hours => ${UNDO_HOURS}) and not exists (
        select 1 from kpi_imports later where later.district_id = i.district_id and later.created_at > i.created_at and later.undone_at is null
      ) as can_undo
    from kpi_imports i where i.district_id = ${districtId} order by i.created_at desc limit 10`;
  return rows.map(row => ({
    id: String(row.id), createdAt: (row.createdAt as Date).toISOString(), fileName: String(row.fileName), year: String(row.year),
    mode: row.mode as "merge" | "replace", summary: row.summary, undoneAt: row.undoneAt ? (row.undoneAt as Date).toISOString() : null, canUndo: Boolean(row.canUndo),
  }));
}

// ───────── export in the ministry layout ─────────
/** Her sheet writes the levels with «ال» («التقدم»). */
const withArticle = (level: string | null) => (level ? `ال${level}` : null);
/** «فائزه عبدالرحمن علي بخاري» → «فائزه بخاري», the way the sheet names the member who follows a school. */
const shortName = (name: string) => { const words = name.trim().split(/\s+/); return words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : name; };

/**
 * The register as her ministry sheet: row 1 the column groups, row 2 her headers (the member column's header is «-»
 * and the last header cell holds the team head's name, like her file), then one row per school with the level and
 * support text filled from the numbers.
 */
export function kpiWorkbook(rows: SchoolKpi[], options: { year: string; headName: string; sheet?: string }) {
  const groups: { column: number; label: string; span: number }[] = [{ column: 0, label: "البيانات الأولية", span: 12 }];
  for (const domain of KPI_DOMAINS) {
    const last = groups[groups.length - 1];
    groups.push({ column: last.column + last.span, label: domain.label, span: domain.standards.length * 2 });
  }
  const memberColumn = 12 + KPI_STANDARDS.length * 2;
  const top: (string | null)[] = Array(memberColumn + 3).fill(null);
  for (const group of groups) top[group.column] = group.label;
  top[memberColumn] = "اسم عضو الفريق التنفيذي المتابع";
  top[memberColumn + 2] = "اسم رئيس الفريق التنفيذي";
  const headers = [
    "الرقم الوزاري", "اسم المدرسة", "المرحلة", "السلطة", "المنطقة المحافظة", "القطاع", "نوع التقويم",
    `المستوى العام للمدرسة رقما للعام ${options.year}`.trim(), "المستوى العام للمدرسة نصي خارجي", "درجة النواتج", "نواتج التعلم نصي",
    "مستوى المتابعة في مؤشرات الالتزام في الانضباط التعليمي",
    ...KPI_STANDARDS.flatMap(standard => [`${standard.label} رقما`, standard.label]),
    "-", null, options.headName,
  ];
  const text = (value: string) => value || null;
  const body = rows.map(row => [
    text(row.ministryNo), row.schoolName, text(row.stage), text(row.authority), text(row.region), text(row.sector), text(row.evaluationType),
    row.overallScore, withArticle(row.overallLevel), row.outcomesScore, withArticle(row.outcomesLevel), text(row.followUpLevel),
    ...KPI_STANDARDS.flatMap(({ key }) => { const score = row.standards[key] ?? null; return [score, kpiSupport(score)]; }),
    // Who follows the school now (its owners), else the name the sheet had.
    row.owners.length ? row.owners.map(owner => shortName(owner.name)).join("، ") : text(row.memberName),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([top, headers, ...body]);
  sheet["!merges"] = groups.map(group => ({ s: { r: 0, c: group.column }, e: { r: 0, c: group.column + group.span - 1 } }));
  sheet["!cols"] = headers.map((_, index) => ({ wch: index === 1 ? 32 : index === memberColumn ? 22 : 14 }));
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  const name = cleanText(options.sheet ?? "").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "الفريق التنفيذي";
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as ArrayBuffer);
}
