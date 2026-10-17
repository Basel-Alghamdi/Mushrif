// مؤشرات الأداء: the district register read from a workbook shaped like her real sheet (with fictional schools and the
// fictional team), merged, replaced and undone; the head's edits; each member's view; the export; permissions.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import * as XLSX from "xlsx";
import type { KpiImportResult, SchoolKpi } from "@rasd/schemas";
import { startApi, type TestApi } from "./harness.js";

type Cell = string | number | null | { t: "s"; v: string; f: string };

const STANDARDS = [
  "التخطيط", "قيادة العملية التعليمية", "المجتمع المدرسي", "التطوير المؤسسي", "بناء خبرات التعلم", "تقويم التعلم",
  "التحصيل التعليمي", "التطور الشخصي والصحي والاجتماعي", "المبنى المدرسي", "الأمن والسلامة",
];
const WIDTH = 35; // A–AI
const row = (cells: Record<number, Cell>) => Array.from({ length: WIDTH }, (_, index) => cells[index] ?? null);

// Row 1: the groups. Row 2: her headers — «-» over the member column (its name is only in row 1), a column of her own
// (AH) and the team head's name in the last header cell.
const GROUP_ROW = row({
  0: "البيانات الأولية", 12: "الإدارة المدرسية", 20: "التعليم والتعلم", 24: "نواتج التعلم", 28: "البيئة المدرسية",
  32: "اسم عضو الفريق التنفيذي المتابع", 34: "اسم رئيس الفريق التنفيذي",
});
const HEADER_ROW = [
  "الرقم الوزاري", "اسم المدرسة", "المرحلة", "السلطة", "المنطقة المحافظة", "القطاع", "نوع التقويم", "المستوى العام للمدرسة رقما للعام 1447",
  "المستوى العام للمدرسة نصي خارجي", "درجة النواتج", "نواتج التعلم", "مستوى المتابعة في مؤشرات الالتزام في الانضباط التعليمي",
  ...STANDARDS.flatMap(label => [`${label} رقما`, label]), "-", "ملاحظة المكتب", "خلود",
];
const formula = (value: string): Cell => ({ t: "s", v: value, f: `IF(H3="","${value}","")` });

type School = {
  no: string | number | null; name: string | null; type?: string; stage?: string; overall?: number | string | null;
  outcomes?: number | string | null; standards?: (number | string | null)[]; member?: string; note?: string;
};
const GOOD = [90, 85.5, 70, 60, 88, 92, 76, 81, 95, 99];
function schoolRow(school: School) {
  const cells: Record<number, Cell> = {
    0: school.no, 1: school.name, 2: school.stage ?? "الابتدائية", 3: "حكومي", 4: "الرياض", 5: "قطاع الشمال", 6: school.type ?? "خارجي",
    7: school.overall ?? null, 8: formula("التقدم"), 9: school.outcomes ?? null, 10: formula("الانطلاق"), 11: "متابعة متوسطة",
    32: school.member ?? null, 33: school.note ?? null,
  };
  (school.standards ?? GOOD).forEach((score, index) => { cells[12 + index * 2] = score; cells[13 + index * 2] = formula("دعم متوسط"); });
  return row(cells);
}

const SCHOOLS: School[] = [
  { no: 96175, name: "الابتدائية الأولى بالنخيل", overall: 84.75, outcomes: 78, member: "فائزة بخاري", note: "زيارة قادمة" },
  { no: "096176", name: "المتوسطة الثانية بالنخيل", stage: "المتوسطة", overall: "٨١٫٥", outcomes: 70, standards: ["84,75", ...GOOD.slice(1)], member: "فايزة البخاري" },
  { no: "M1000001", name: "الثانوية الثالثة - مسارات", stage: "الثانوية", overall: 91, outcomes: 88, member: " نوف الحارثي" },
  { no: 100002, name: "الابتدائية الرابعة", type: "ذاتي", overall: 70, outcomes: 0, standards: [80, 80, 80, 80, 80, 80, 0, 75, 90, 90], member: "نوف الحارثي" },
  { no: 100003, name: "الابتدائية الخامسة", type: "غير مصنفة", overall: 0, outcomes: 0, standards: Array(10).fill(0), member: "متعبه بنت فهد" },
  { no: 100004, name: "المتوسطة السادسة", stage: "المتوسطة", overall: 45, outcomes: 50, standards: [40, ...GOOD.slice(1)], member: "فاطمة" },
  { no: 100005, name: "الابتدائية السابعة", overall: 60, outcomes: 62, member: "هيا الغامدي" },
  { no: 100006, name: "الابتدائية الثامنة", overall: 76, outcomes: 75, member: "رشا القرني" },
  { no: 100007, name: "الابتدائية التاسعة", overall: 88, outcomes: 80 },
  { no: 100008, name: "الابتدائية العاشرة", overall: 79, outcomes: null, member: "رشا القرني" },
];
// Rows with data that cannot be used (rows 13–16).
const BAD_ROWS: School[] = [
  { no: "96,175", name: "نسخة مكررة من الأولى", overall: 70 },
  { no: null, name: "مدرسة بلا رقم ولا درجات", standards: Array(10).fill(null) },
  { no: 100009, name: "درجة خاطئة", overall: 120 },
  { no: 100010, name: null, overall: 50 },
];
// The empty template rows under the data: «حكومي» and the formulas' text only.
const TEMPLATE_ROWS = Array.from({ length: 20 }, () => row({
  3: "حكومي", 8: formula("التهيئة"), 10: formula("التهيئة"), ...Object.fromEntries(STANDARDS.map((_, index) => [13 + index * 2, formula("دعم ومساندة شديدة")])),
}));

function workbook(schools: School[], options: { bad?: boolean } = {}) {
  const book = XLSX.utils.book_new();
  const add = (name: string, rows: Cell[][]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows as never), name);
  // «التعليمات» also has «اسم المدرسة» in row 2, two example schools and the rubric as text rows.
  add("التعليمات", [
    ["الإدارة العامة للتعليم — تعليمات تعبئة الملف"], [null, "الرقم الوزاري", "اسم المدرسة", "المرحلة"],
    [null, "M9990001", "ثانوية المثال الأولى - مسارات", "الثانوية"], [null, "M9990002", "ثانوية المثال الثانية - مسارات", "الثانوية"],
    [null, null, "الدرجة"], [null, null, "أقل من 50"], [null, null, "90 فأعلى"], [null, null, "1- إدخال البيانات في الأعمدة البيضاء فقط"],
  ]);
  add("الفريق التنفيذي 5", [GROUP_ROW, HEADER_ROW, ...schools.map(schoolRow), ...(options.bad === false ? [] : BAD_ROWS.map(schoolRow)), ...TEMPLATE_ROWS]);
  add("ملاحظات", [["مدارس لم يتم تصنيفها", "السبب"], ["اسم المدرسة", "السبب"], ["الابتدائية الخامسة", "لم تكتمل الزيارة"]]);
  add("Sheet1", [["اسم المدرسة", "المستوى"], ["التميز", 90], ["التقدم", 75]]);
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

const importForm = (file: Buffer, fields: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)]), "مؤشرات التقويم المدرسي.xlsx");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
};

let api: TestApi;
let head = "";
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const imports: string[] = [];

const register = async (query = "") => {
  const result = await api.call<{ year: string; years: string[]; rows: SchoolKpi[]; summary: any }>("GET", `/district/kpis${query}`, undefined, head);
  assert.equal(result.status, 200, JSON.stringify(result.error));
  return result.data;
};
const byNo = (rows: SchoolKpi[], no: string) => rows.find(item => item.ministryNo === no)!;
const importFile = async (file: Buffer, fields: Record<string, string> = {}) => {
  const result = await api.call<KpiImportResult>("POST", "/district/kpis/import", importForm(file, fields), head);
  assert.equal(result.status, 200, JSON.stringify(result.error));
  if (result.data.importId) imports.push(result.data.importId);
  return result.data;
};

describe("مؤشرات الأداء", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
    for (const row of await api.sql`select id, email from profiles where role = 'member'`) ids[String(row.email).split(".")[0]] = String(row.id);
    for (const name of ["faiza", "mutiba", "rasha"]) tokens[name] = await api.activate(`${name}.member@example.com`);
  });
  after(async () => { await api.stop(); });

  test("a dry run reads only the team's sheet: counts, skipped rows, names and the year", async () => {
    const result = await importFile(workbook(SCHOOLS));
    assert.equal(result.applied, false);
    assert.equal(result.importId, null);
    assert.equal(result.year, "1447", "from «للعام 1447» in the header");
    assert.deepEqual(result.sheets, [{ name: "الفريق التنفيذي 5", rows: 10, included: true }], "no rows from التعليمات, ملاحظات or Sheet1");
    assert.deepEqual([result.rows, result.added, result.updated, result.unchanged, result.removed], [10, 10, 0, 0, 0]);
    assert.deepEqual(result.skipped, [
      { sheet: "الفريق التنفيذي 5", row: 13, reason: "الرقم الوزاري مكرر في الملف" },
      { sheet: "الفريق التنفيذي 5", row: 14, reason: "لا يوجد رقم وزاري ولا درجات" },
      { sheet: "الفريق التنفيذي 5", row: 15, reason: "درجة خارج النطاق (٠–١٠٠)" },
      { sheet: "الفريق التنفيذي 5", row: 16, reason: "اسم المدرسة فارغ" },
    ], "the 20 template rows are ignored silently");
    const names = Object.fromEntries(result.names.map(item => [item.name, [item.count, item.status, item.memberId]]));
    assert.deepEqual(names, {
      "فائزة بخاري": [1, "matched", ids.faiza], "فايزة البخاري": [1, "matched", ids.faiza], "نوف الحارثي": [2, "matched", ids.nouf],
      "متعبه بنت فهد": [1, "matched", ids.mutiba], "فاطمة": [1, "ambiguous", null], "هيا الغامدي": [1, "unknown", null], "رشا القرني": [2, "matched", ids.rasha],
    });
    assert.equal(result.sample.length, 5);
    assert.deepEqual(result.sample[1], { sheet: "الفريق التنفيذي 5", schoolName: "المتوسطة الثانية بالنخيل", ministryNo: "096176", overallScore: 81.5, memberName: "فايزة البخاري" });
    assert.equal((await api.sql`select count(*)::int as count from school_kpis`)[0].count, 0, "a dry run writes nothing");
  });

  test("apply: levels from the numbers, 0 = not available outside the external evaluation, her name choices are kept", async () => {
    const result = await importFile(workbook(SCHOOLS), { dryRun: "false", names: JSON.stringify({ "فاطمة": ids.fatima1 }) });
    assert.equal(result.applied, true);
    assert.ok(result.importId);
    assert.equal(result.added, 10);
    assert.equal(result.names.find(item => item.name === "فاطمة")!.status, "chosen");

    const { year, years, rows, summary } = await register();
    assert.equal(year, "1447");
    assert.deepEqual(years, ["1447"]);
    const first = byNo(rows, "96175");
    assert.deepEqual([first.overallScore, first.overallLevel, first.outcomesLevel, first.assignedMemberId], [84.75, "تقدم", "تقدم", ids.faiza]);
    assert.deepEqual(first.owners.map(owner => owner.memberId), [ids.faiza]);
    assert.deepEqual(first.extra, [{ label: "ملاحظة المكتب", value: "زيارة قادمة" }], "her own column is kept; derived text columns are not");
    assert.equal(first.standards.leadership, 85.5);
    const second = byNo(rows, "096176");
    assert.deepEqual([second.overallScore, second.standards.planning, second.stage], [81.5, 84.75, "المتوسطة"]);
    const self = byNo(rows, "100002");
    assert.deepEqual([self.outcomesScore, self.standards.achievement, self.standards.planning, self.overallLevel], [null, null, 80, "انطلاق"]);
    const unclassified = byNo(rows, "100003");
    assert.deepEqual([unclassified.overallScore, unclassified.overallLevel, unclassified.standards.safety], [null, null, null]);
    assert.equal(byNo(rows, "100004").assignedMemberId, ids.fatima1);
    assert.deepEqual(byNo(rows, "100005").owners, [], "an unknown name leaves the school unassigned");
    assert.deepEqual(summary.byLevel, { "تميز": 1, "تقدم": 5, "انطلاق": 2, "تهيئة": 1, none: 1 });
    assert.deepEqual([summary.total, summary.unassigned, summary.severe], [10, 2, 1]);
    const faiza = summary.perMember.find((item: { memberId: string }) => item.memberId === ids.faiza);
    assert.deepEqual([faiza.rows, faiza.tahyia, faiza.severeStandards], [2, 0, 0]);

    const aliases = await api.sql`select alias, member_id from kpi_member_aliases`;
    assert.deepEqual(aliases.map(item => [item.alias, item.memberId]), [["فاطمه", ids.fatima1]]);
    const [audit] = await api.sql`select action, entity, entity_id from audit_log where entity = 'school_kpis'`;
    assert.deepEqual([audit.action, audit.entityId], ["import", result.importId]);
  });

  test("the same file again: every row unchanged, and her choice for «فاطمة» is remembered", async () => {
    const result = await importFile(workbook(SCHOOLS));
    assert.deepEqual([result.added, result.updated, result.unchanged], [0, 0, 10]);
    assert.deepEqual(result.names.find(item => item.name === "فاطمة"), { name: "فاطمة", count: 1, memberId: ids.fatima1, memberName: "فاطمة ناصر علي الزهراني", status: "alias" });
  });

  test("merge: a blank cell never overwrites, and an assignment she made survives the import", async () => {
    const { rows } = await register();
    const assigned = await api.call("POST", "/district/kpis/assign", { ids: [byNo(rows, "96175").id], memberId: ids.rasha }, head);
    assert.deepEqual(assigned.data, { updated: 1 });
    const changed = SCHOOLS.map(school => (school.no === 96175 ? { ...school, overall: 86 } : school.no === 100008 ? { ...school, overall: null, outcomes: 70 } : school));
    const result = await importFile(workbook(changed, { bad: false }), { dryRun: "false" });
    assert.deepEqual([result.added, result.updated, result.unchanged, result.skipped.length], [0, 2, 8, 0]);
    const after = (await register()).rows;
    assert.deepEqual([byNo(after, "96175").overallScore, byNo(after, "96175").assignedMemberId], [86, ids.rasha]);
    assert.deepEqual([byNo(after, "100008").overallScore, byNo(after, "100008").outcomesScore], [79, 70]);
  });

  test("replace removes only this year's imported rows: her own rows and other years stay", async () => {
    const manual = await api.call<SchoolKpi>("POST", "/district/kpis", { schoolName: "مدرسة أضافتها خلود", ministryNo: "٢٠٠٠٠١", overallScore: "٧٧٫٢٥" }, head);
    assert.equal(manual.status, 201, JSON.stringify(manual.error));
    assert.deepEqual([manual.data.year, manual.data.ministryNo, manual.data.overallScore, manual.data.source], ["1447", "200001", 77.25, "manual"]);
    const older = await api.call<SchoolKpi>("POST", "/district/kpis", { schoolName: "مدرسة العام الماضي", ministryNo: "200002", year: "1446" }, head);
    assert.equal(older.status, 201);

    const kept = SCHOOLS.slice(0, 3).map(school => (school.no === 96175 ? { ...school, overall: 86 } : school));
    const preview = await importFile(workbook(kept), { mode: "replace" });
    assert.deepEqual([preview.removed, preview.unchanged, preview.added], [7, 3, 0]);
    assert.ok(preview.removedNames.includes("الابتدائية العاشرة") && !preview.removedNames.includes("مدرسة أضافتها خلود"));
    await importFile(workbook(kept), { mode: "replace", dryRun: "false" });
    assert.deepEqual((await register()).rows.map(item => item.schoolName).sort(), [
      "الابتدائية الأولى بالنخيل", "الثانوية الثالثة - مسارات", "المتوسطة الثانية بالنخيل", "مدرسة أضافتها خلود",
    ].sort());
    const lastYear = await register("?year=1446");
    assert.deepEqual([lastYear.year, lastYear.rows.length, lastYear.years], ["1446", 1, ["1447", "1446"]]);
  });

  test("undo: the newest import first, within a day, and everything it changed comes back", async () => {
    const [initial, merge, replace] = imports;
    const history = await api.call<{ id: string; canUndo: boolean; mode: string }[]>("GET", "/district/kpis/imports", undefined, head);
    assert.deepEqual(history.data.map(item => [item.id, item.mode, item.canUndo]), [[replace, "replace", true], [merge, "merge", false], [initial, "merge", false]]);

    const blocked = await api.call("POST", `/district/kpis/imports/${merge}/undo`, undefined, head);
    assert.deepEqual([blocked.status, blocked.error?.message], [409, "تراجعي عن الاستيراد الأحدث أولاً"]);
    assert.equal((await api.call("POST", `/district/kpis/imports/${replace}/undo`, undefined, head)).status, 200);
    assert.equal((await register()).rows.length, 11, "the removed rows are back");
    assert.equal((await api.call("POST", `/district/kpis/imports/${merge}/undo`, undefined, head)).status, 200);
    const rows = (await register()).rows;
    assert.deepEqual([byNo(rows, "96175").overallScore, byNo(rows, "96175").assignedMemberId], [84.75, ids.rasha]);
    assert.deepEqual([byNo(rows, "100008").overallScore, byNo(rows, "100008").outcomesScore], [79, null]);
    assert.equal((await api.call("POST", `/district/kpis/imports/${replace}/undo`, undefined, head)).status, 409, "only once");

    await api.sql`update kpi_imports set created_at = now() - interval '25 hours' where id = ${initial}`;
    const expired = await api.call("POST", `/district/kpis/imports/${initial}/undo`, undefined, head);
    assert.deepEqual([expired.status, expired.error?.code], [409, "UNDO_EXPIRED"]);
  });

  test("a file already in the district imports by its id", async () => {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(workbook(SCHOOLS))]), "المؤشرات.xlsx");
    const [attachment] = (await api.call("POST", "/chat/attachments", form, head)).data;
    const result = await api.call<KpiImportResult>("POST", "/district/kpis/import", { documentId: attachment.id }, head);
    assert.equal(result.status, 200, JSON.stringify(result.error));
    assert.deepEqual([result.data.applied, result.data.rows, result.data.added, result.data.unchanged], [false, 10, 0, 10]);
    assert.equal((await api.call("POST", "/district/kpis/import", { documentId: "6f1c2a52-0d6e-4c8a-9f0e-2b7d4d1e9a10" }, head)).status, 404);
    assert.equal((await api.call("POST", "/district/kpis/import", { documentId: "x" }, head)).status, 404);
  });

  test("members: her rows or the whole district, and linking a row to her schools", async () => {
    const own = await api.call<{ kpiScope: string; year: string; years: string[]; rows: SchoolKpi[] }>("GET", "/cluster/me/kpis", undefined, tokens.faiza);
    assert.equal(own.status, 200, JSON.stringify(own.error));
    assert.deepEqual([own.data.kpiScope, own.data.year, own.data.rows.map(item => item.ministryNo)], ["own", "1447", ["096176"]]);
    assert.equal(own.data.rows[0].schoolId, null);

    assert.equal((await api.call("PUT", `/district/members/${ids.mutiba}/kpi-scope`, { scope: "district" }, head)).status, 200);
    const all = await api.call<{ kpiScope: string; rows: SchoolKpi[] }>("GET", "/cluster/me/kpis", undefined, tokens.mutiba);
    assert.deepEqual([all.data.kpiScope, all.data.rows.length], ["district", 11]);
    const detail = await api.call<{ kpiScope: string; rows: SchoolKpi[] }>("GET", `/district/members/${ids.mutiba}/kpis`, undefined, head);
    assert.deepEqual([detail.data.kpiScope, detail.data.rows.map(item => item.ministryNo)], ["district", ["100003"]]);

    const rowId = own.data.rows[0].id;
    const added = await api.call("POST", `/cluster/me/kpis/${rowId}/add-school`, undefined, tokens.faiza);
    assert.equal(added.status, 201, JSON.stringify(added.error));
    assert.deepEqual([added.data.name, added.data.stage, added.data.ministryNo], ["المتوسطة الثانية بالنخيل", "متوسطة", "096176"]);
    const [children] = await api.sql`
      select (select count(*)::int from school_staff_tiles where school_id = ${added.data.id}) as tiles,
        (select count(*)::int from leadership_fields f join leadership_roles r on r.id = f.role_id where r.school_id = ${added.data.id}) as fields`;
    assert.deepEqual([children.tiles, children.fields], [2, 2], "like any new school");
    const linked = (await api.call<{ rows: SchoolKpi[] }>("GET", "/cluster/me/kpis", undefined, tokens.faiza)).data.rows;
    assert.deepEqual([linked[0].schoolId, linked[0].owners], [added.data.id, [{ memberId: ids.faiza, name: "فائزه عبدالرحمن علي بخاري", schoolId: added.data.id }]]);
    assert.equal((await api.call("POST", `/cluster/me/kpis/${rowId}/add-school`, undefined, tokens.faiza)).status, 409, "already in مدارسي");

    const rashaRow = byNo((await register()).rows, "100006");
    const school = await api.call("POST", "/cluster/me/schools", { name: "مدرستي" }, tokens.rasha);
    const link = await api.call("POST", `/cluster/me/kpis/${rashaRow.id}/link`, { schoolId: school.data.id }, tokens.rasha);
    assert.deepEqual([link.status, link.data?.ministryNo], [200, "100006"]);
    const rasha = (await api.call<{ rows: SchoolKpi[] }>("GET", "/cluster/me/kpis", undefined, tokens.rasha)).data.rows;
    assert.equal(byNo(rasha, "100006").schoolId, school.data.id);
    const another = await api.call("POST", "/cluster/me/schools", { name: "مدرسة ثانية" }, tokens.rasha);
    assert.equal((await api.call("POST", `/cluster/me/kpis/${rashaRow.id}/link`, { schoolId: another.data.id }, tokens.rasha)).status, 409);
    assert.equal((await api.call("POST", `/cluster/me/kpis/${rashaRow.id}/link`, { schoolId: added.data.id }, tokens.faiza)).status, 404, "not her row");
    const [audit] = await api.sql`select field, after from audit_log where entity = 'school' and field = 'ministryNo'`;
    assert.equal(audit.after, "100006");
  });

  test("export: her ministry layout with the two header rows, and it imports back", async () => {
    const result = await api.call("GET", "/district/kpis/export?year=1447", undefined, head);
    assert.equal(result.status, 200);
    assert.match(result.response.headers.get("content-disposition")!, /^attachment; filename="kpis-1447.xlsx"; filename\*=UTF-8''%D9%85/);
    const file = Buffer.from(await result.response.arrayBuffer());
    const book = XLSX.read(file, { type: "buffer" });
    const sheet = book.Sheets["الفريق التنفيذي"];
    const cell = (address: string) => sheet[address]?.v;
    assert.deepEqual([cell("A1"), cell("M1"), cell("Y1"), cell("AG1"), cell("AI1")], ["البيانات الأولية", "الإدارة المدرسية", "نواتج التعلم", "اسم عضو الفريق التنفيذي المتابع", "اسم رئيس الفريق التنفيذي"]);
    assert.deepEqual([cell("A2"), cell("H2"), cell("I2"), cell("M2"), cell("N2"), cell("AG2"), cell("AI2")], [
      "الرقم الوزاري", "المستوى العام للمدرسة رقما للعام 1447", "المستوى العام للمدرسة نصي خارجي", "التخطيط رقما", "التخطيط", "-", "خلود",
    ]);
    const body = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }).slice(2);
    assert.equal(body.length, 11);
    const first = body.find(line => line[0] === "96175")!;
    assert.deepEqual([first[7], first[8], first[12], first[13]], [84.75, "التقدم", 90, "دعم منخفض"]);
    const roundTrip = await importFile(file);
    assert.deepEqual([roundTrip.rows, roundTrip.added, roundTrip.removed], [11, 0, 0]);
    const hers = XLSX.read(Buffer.from(await (await api.call("GET", `/district/kpis/export?memberId=${ids.faiza}`, undefined, head)).response.arrayBuffer()), { type: "buffer" });
    assert.equal(XLSX.utils.sheet_to_json(hers.Sheets[hers.SheetNames[0]], { header: 1 }).length, 3);
  });

  test("the head edits rows: stale copies, decimals, her assignment, duplicates, delete and restore, filters", async () => {
    const rows = (await register()).rows;
    const target = byNo(rows, "100007");
    const stale = await api.call("PATCH", `/district/kpis/${target.id}`, { note: "x", expectedUpdatedAt: "2000-01-01T00:00:00Z" }, head);
    assert.equal(stale.status, 409);
    const edited = await api.call<SchoolKpi>("PATCH", `/district/kpis/${target.id}`, { standards: { planning: "٨٤٫٥" }, assignedMemberId: ids.maha }, head);
    assert.equal(edited.status, 200, JSON.stringify(edited.error));
    assert.deepEqual([edited.data.standards.planning, edited.data.standards.safety, edited.data.owners.map(owner => owner.memberId)], [84.5, 99, [ids.maha]]);
    const [stored] = await api.sql`select assignment_source from school_kpis where id = ${target.id}`;
    assert.equal(stored.assignmentSource, "manual");
    const wrong = await api.call("PATCH", `/district/kpis/${target.id}`, { overallScore: 101, standards: { unknown: 5 } }, head);
    assert.deepEqual([wrong.status, Object.keys(wrong.error!.fields!).sort()], [422, ["overallScore", "standards"]]);
    const duplicate = await api.call("POST", "/district/kpis", { schoolName: "نسخة", ministryNo: "96,175" }, head);
    assert.deepEqual([duplicate.status, duplicate.error?.code], [409, "DUPLICATE"]);

    assert.equal((await api.call("DELETE", `/district/kpis/${target.id}`, undefined, head)).status, 200);
    assert.equal((await register()).rows.length, 10);
    assert.equal((await api.call("POST", `/district/kpis/${target.id}/restore`, undefined, head)).status, 200);
    assert.equal((await register()).rows.length, 11);

    const names = async (query: string) => (await register(query)).rows.map(item => item.ministryNo).sort();
    assert.deepEqual(await names("?level=التهيئة"), ["100004"], "with or without «ال»");
    assert.deepEqual(await names("?level=none"), ["100003"]);
    assert.deepEqual(await names("?unassigned=1"), ["100005", "200001"]);
    assert.deepEqual(await names("?severe=1"), ["100004"]);
    assert.deepEqual(await names(`?q=${encodeURIComponent("بالنخيل")}`), ["096176", "96175"]);
    assert.deepEqual(await names(`?memberId=${ids.rasha}`), ["100006", "100008", "96175"]);
    assert.deepEqual(await names(`?stage=${encodeURIComponent("متوسطة")}`), ["096176", "100004"]);
    assert.equal((await api.call("GET", "/district/kpis?level=ممتاز", undefined, head)).status, 422);
    const { summary } = await register();
    assert.deepEqual(summary.memberSchoolsMissing.map((item: { schoolName: string }) => item.schoolName), ["مدرسة ثانية"]);
  });

  test("members cannot use the head's routes; another district's rows and members are not found", async () => {
    for (const [method, path] of [
      ["GET", "/district/kpis"], ["POST", "/district/kpis"], ["GET", "/district/kpis/imports"], ["GET", "/district/kpis/export"],
      ["POST", "/district/kpis/assign"], ["GET", `/district/members/${ids.faiza}/kpis`],
    ]) {
      assert.equal((await api.call(method, path, method === "GET" ? undefined : {}, tokens.faiza)).status, 403, `${method} ${path}`);
    }
    assert.equal((await api.call("POST", "/district/kpis/import", importForm(workbook(SCHOOLS)), tokens.faiza)).status, 403);

    const [district] = await api.sql`insert into districts (name) values ('نطاق آخر') returning id`;
    const [other] = await api.sql`insert into school_kpis (district_id, year, ministry_no, school_name) values (${district.id}, '1447', '300001', 'مدرسة نطاق آخر') returning id`;
    const [user] = await api.sql`insert into auth.users (email) values ('other.member@example.com') returning id`;
    await api.sql`insert into profiles (id, district_id, role, name, email) values (${user.id}, ${district.id}, 'member', 'عضوة نطاق آخر', 'other.member@example.com')`;
    await api.sql`insert into clusters (district_id, member_id) values (${district.id}, ${user.id})`;
    assert.equal((await api.call("PATCH", `/district/kpis/${other.id}`, { note: "x" }, head)).status, 404);
    assert.equal((await api.call("DELETE", `/district/kpis/${other.id}`, undefined, head)).status, 404);
    assert.equal((await api.call("POST", "/district/kpis/assign", { ids: [other.id], memberId: null }, head)).status, 404);
    assert.equal((await api.call("GET", `/district/members/${user.id}/kpis`, undefined, head)).status, 404);
    assert.equal((await api.call("PUT", `/district/members/${user.id}/kpi-scope`, { scope: "district" }, head)).status, 404);
    const foreignMember = await api.call("PATCH", `/district/kpis/${byNo((await register()).rows, "100007").id}`, { assignedMemberId: user.id }, head);
    assert.equal(foreignMember.status, 422);
    assert.ok(!(await register()).rows.some(item => item.ministryNo === "300001"));
  });
});
