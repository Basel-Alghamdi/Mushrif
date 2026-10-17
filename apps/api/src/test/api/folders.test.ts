// ملف الإنجاز folders as data: what a member starts with, the head's edits to one member or many at once (by key),
// the preview of an edit (dry run), «مثل مجلدات فلانة» (sync), filing a district document, and who may do what.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_FOLDERS, type DocumentInfo, type FolderDef, type FolderLayout } from "@rasd/schemas";
import { startApi, type TestApi } from "./harness.js";

type Counts = { member: Record<string, number>; school: Record<string, number>; inSchools: number };
type BulkResult = { memberId: string; name: string; status: "done" | "skipped"; note?: string; filesToUnsorted?: number };
type SyncResult = { memberId: string; name: string; added: string[]; renamed: string[]; removed: string[]; restored: string[]; filesToUnsorted: number };

let api: TestApi;
let head = "";
let rasha = "";
let maha = "";
const ids: Record<string, string> = {};
let rashaSchool = "";

/** A folder list as compared: key, label, parent, kind, in order. */
const shape = (folders: readonly FolderDef[]) => folders.map(folder => [folder.key, folder.label, folder.parent ?? null, folder.kind ?? "files"]);
const keys = (folders: readonly FolderDef[]) => folders.map(folder => folder.key);

const bulk = (body: Record<string, unknown>, token = head) => api.call<{ applied: boolean; key?: string; results: BulkResult[] }>("POST", "/district/folders/bulk", body, token);
const sync = (body: Record<string, unknown>, token = head) => api.call<{ applied: boolean; results: SyncResult[] }>("POST", "/district/folders/sync", body, token);
const foldersOf = async (memberId: string) =>
  (await api.call<{ layout: FolderLayout; counts: Counts }>("GET", `/district/members/${memberId}/folders`, undefined, head)).data;
const auditCount = async () => (await api.sql`select count(*)::int as count from audit_log where entity = 'folders'`)[0].count as number;

const fileForm = (folder: string, schoolId = "") => {
  const form = new FormData();
  form.append("files", new Blob(["ملف"], { type: "text/plain" }), "ملف.txt");
  form.append("folder", folder);
  if (schoolId) form.append("schoolId", schoolId);
  return form;
};
const upload = (token: string, folder: string, schoolId = "") => api.call<DocumentInfo[]>("POST", "/cluster/me/documents", fileForm(folder, schoolId), token);

describe("ملف الإنجاز folders", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
    rasha = await api.activate("rasha.member@example.com");
    maha = await api.activate("maha.member@example.com");
    for (const row of await api.sql`select id, email from profiles where role = 'member'`) ids[String(row.email).split(".")[0]] = String(row.id);
    rashaSchool = (await api.call<{ id: string }>("POST", "/cluster/me/schools", { name: "الابتدائية الأولى" }, rasha)).data.id;
  });
  after(async () => { await api.stop(); });

  test("a new member starts with the default folders; a member reads hers, the head reads hers with file counts", async () => {
    const created = await api.call<{ id: string }>("POST", "/district/members", { name: "عضوة للمجلدات", email: "folders.member@example.com", title: "عضو فريق تنفيذي" }, head);
    assert.equal(created.status, 201, JSON.stringify(created.error));
    const [{ count }] = await api.sql`select count(*)::int as count from folders f join clusters c on c.id = f.cluster_id where c.member_id = ${created.data.id}`;
    assert.equal(count, DEFAULT_FOLDERS.member.length + DEFAULT_FOLDERS.school.length, "her folder rows are written when she is created");
    const fresh = await foldersOf(created.data.id);
    assert.deepEqual([shape(fresh.layout.member), shape(fresh.layout.school)], [shape(DEFAULT_FOLDERS.member), shape(DEFAULT_FOLDERS.school)]);
    assert.deepEqual(fresh.layout.removed, []);
    assert.deepEqual(fresh.counts, { member: {}, school: {}, inSchools: 0 });

    const own = await api.call<FolderLayout>("GET", "/cluster/me/folders", undefined, rasha);
    assert.equal(own.status, 200);
    assert.deepEqual(shape(own.data.member), shape(DEFAULT_FOLDERS.member));
    assert.ok(own.data.member.every(folder => folder.id), "rows from the database");
    assert.equal((await api.call("GET", "/cluster/me/folders", undefined, head)).status, 403);
  });

  test("an added folder gets one key in every member; sub-folders and placement follow the tree", async () => {
    const added = await bulk({ memberIds: "all", scope: "member", op: { type: "add", label: " التقارير الشهرية " } });
    assert.equal(added.status, 200, JSON.stringify(added.error));
    assert.equal(added.data.applied, true);
    const key = added.data.key!;
    assert.match(key, /^f_[a-z0-9]{10}$/);
    const [{ members }] = await api.sql`select count(*)::int as members from profiles where role = 'member' and deleted_at is null`;
    assert.equal(added.data.results.length, members);
    assert.ok(added.data.results.every(result => result.status === "done"));
    const rows = await api.sql`select label from folders where key = ${key} and scope = 'member' and deleted_at is null`;
    assert.equal(rows.length, members);
    assert.ok(rows.every(row => row.label === "التقارير الشهرية"), "the name is trimmed");
    assert.equal((await api.sql`select count(*)::int as count from audit_log where entity = 'folders' and after->>'key' = ${key}`)[0].count, members);
    assert.equal((await foldersOf(ids.rasha)).layout.member.at(-1)?.key, key, "last among her folders");

    const again = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "add", label: "التقارير الشهرية" } });
    assert.deepEqual(again.data.results.map(result => [result.status, result.note]), [["skipped", "عندها مجلد بهذا الاسم في المكان نفسه"]]);

    const sub = await bulk({ memberIds: [ids.rasha, ids.maha], scope: "member", op: { type: "add", label: "محرم", parentKey: key } });
    assert.deepEqual(sub.data.results.map(result => result.status), ["done", "done"]);
    const placed = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "add", label: "الشهادات", afterKey: "professional_development" } });
    const { layout } = await foldersOf(ids.rasha);
    assert.deepEqual(keys(layout.member), [
      "professional_development", "pd_presenter", "pd_attendee", placed.data.key, "schools_analysis", "initiatives", "schools",
      "performance_charter", "visit_plan", key, sub.data.key,
    ], "after التطوير المهني and its sub-folders");
    assert.equal(layout.member.at(-1)?.parent, key);
    const order = await api.sql`select key from folders where cluster_id = (select id from clusters where member_id = ${ids.rasha}) and scope = 'member' order by sort_order`;
    assert.deepEqual(order.map(row => row.key), keys(layout.member), "sort_order follows the tree");

    // Inside a sub-folder, inside «مدارس المشرفة», or under a folder she does not have: skipped with the reason.
    for (const [parentKey, note] of [["pd_presenter", "لا يمكن وضع مجلد داخل هذا المجلد"], ["schools", "لا يمكن وضع مجلد داخل هذا المجلد"], ["f_0000000000", "لا يوجد هذا المجلد عندها"]]) {
      const refused = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "add", label: "مجلد", parentKey } });
      assert.deepEqual(refused.data.results.map(result => [result.status, result.note]), [["skipped", note]], parentKey);
    }
    for (const body of [
      { memberIds: [ids.rasha], scope: "member", op: { type: "add", label: "   " } },
      { memberIds: [ids.rasha], op: { type: "add", label: "مجلد" } },
      { memberIds: [ids.rasha], scope: "member", op: { type: "rename", key: "../x", label: "مجلد" } },
      { memberIds: [ids.rasha], scope: "member", op: { type: "drop" } },
      { memberIds: [], scope: "member", op: { type: "add", label: "مجلد" } },
      { memberIds: ["not-a-uuid"], scope: "member", op: { type: "add", label: "مجلد" } },
    ]) assert.equal((await bulk(body)).status, 422, JSON.stringify(body));
  });

  test("rename, move and order — the same key in several members", async () => {
    const renamed = await bulk({ memberIds: [ids.rasha, ids.maha], scope: "member", op: { type: "rename", key: "initiatives", label: "مبادراتي" } });
    assert.deepEqual(renamed.data.results.map(result => result.status), ["done", "done"]);
    const { layout } = await foldersOf(ids.maha);
    assert.equal(layout.member.find(folder => folder.key === "initiatives")?.label, "مبادراتي");
    assert.equal(layout.school.find(folder => folder.key === "initiatives")?.label, "مبادرات المدرسة", "her schools' folder of the same key is another folder");
    const same = await bulk({ memberIds: [ids.maha], scope: "member", op: { type: "rename", key: "initiatives", label: "مبادراتي" } });
    assert.deepEqual(same.data.results.map(result => [result.status, result.note]), [["skipped", "الاسم لم يتغيّر"]]);
    const missing = await bulk({ memberIds: [ids.maha], scope: "member", op: { type: "rename", key: "f_0000000000", label: "س" } });
    assert.deepEqual(missing.data.results.map(result => result.note), ["لا يوجد هذا المجلد عندها"]);

    const into = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "move", key: "visit_plan", parentKey: "professional_development" } });
    assert.equal(into.data.results[0].status, "done");
    let member = (await foldersOf(ids.rasha)).layout.member;
    assert.deepEqual(keys(member).slice(0, 4), ["professional_development", "pd_presenter", "pd_attendee", "visit_plan"]);
    assert.equal(member.find(folder => folder.key === "visit_plan")?.parent, "professional_development");
    const monthly = member.find(folder => folder.label === "التقارير الشهرية")!.key;
    const withChildren = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "move", key: monthly, parentKey: "professional_development" } });
    assert.deepEqual(withChildren.data.results.map(result => [result.status, result.note]), [["skipped", "فيه مجلدات فرعية فلا يصبح مجلداً فرعياً"]]);
    const out = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "move", key: "visit_plan", parentKey: null } });
    assert.equal(out.data.results[0].status, "done");
    member = (await foldersOf(ids.rasha)).layout.member;
    assert.equal(member.filter(folder => !folder.parent).at(-1)?.key, "visit_plan", "last among the top-level folders");

    const ordered = await bulk({ memberIds: [ids.rasha, ids.maha], scope: "member", op: { type: "order", parentKey: null, keys: ["visit_plan", "schools"] } });
    assert.deepEqual(ordered.data.results.map(result => result.status), ["done", "done"]);
    member = (await foldersOf(ids.rasha)).layout.member;
    assert.deepEqual(keys(member.filter(folder => !folder.parent)).slice(0, 3), ["visit_plan", "schools", "professional_development"]);
    const unchanged = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "order", parentKey: null, keys: ["visit_plan"] } });
    assert.deepEqual(unchanged.data.results.map(result => result.note), ["الترتيب لم يتغيّر"]);
    await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "order", parentKey: "professional_development", keys: ["pd_attendee"] } });
    member = (await foldersOf(ids.rasha)).layout.member;
    assert.deepEqual(keys(member.filter(folder => folder.parent === "professional_development")), ["pd_attendee", "pd_presenter"]);
  });

  test("delete previews and reports the files that go to «غير مصنّفة»; files keep their key; restore brings back what was removed together", async () => {
    const own = await upload(rasha, "pd_presenter");
    const inSchool = await upload(rasha, "discipline_plan", rashaSchool);
    assert.equal(own.status, 201, JSON.stringify(own.error));
    assert.equal(inSchool.status, 201, JSON.stringify(inSchool.error));
    const counted = await foldersOf(ids.rasha);
    assert.deepEqual([counted.counts.member.pd_presenter, counted.counts.school.discipline_plan, counted.counts.inSchools], [1, 1, 1]);

    const audits = await auditCount();
    const preview = await bulk({ memberIds: [ids.rasha], scope: "member", dryRun: true, op: { type: "delete", key: "professional_development" } });
    assert.equal(preview.data.applied, false);
    assert.deepEqual(preview.data.results.map(result => [result.status, result.filesToUnsorted]), [["done", 1]]);
    assert.ok((await foldersOf(ids.rasha)).layout.member.some(folder => folder.key === "professional_development"), "a dry run changes nothing");
    assert.equal(await auditCount(), audits);
    const previewAdd = await bulk({ memberIds: "all", scope: "member", dryRun: true, op: { type: "add", label: "معاينة فقط" } });
    assert.ok(previewAdd.data.results.every(result => result.status === "done"));
    assert.equal((await api.sql`select count(*)::int as count from folders where key = ${previewAdd.data.key!}`)[0].count, 0);

    const deleted = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "delete", key: "professional_development" } });
    assert.deepEqual(deleted.data.results.map(result => [result.status, result.filesToUnsorted]), [["done", 1]]);
    const { layout, counts } = await foldersOf(ids.rasha);
    assert.ok(!layout.member.some(folder => ["professional_development", "pd_presenter", "pd_attendee"].includes(folder.key)));
    assert.deepEqual(keys(layout.removed ?? []).sort(), ["pd_attendee", "pd_presenter", "professional_development"]);
    assert.equal(counts.member.pd_presenter, 1, "counted by key, removed folder or not");
    const files = await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha);
    assert.equal(files.data.find(file => file.id === own.data[0].id)?.folder, "pd_presenter", "the file keeps its folder key");
    const refused = await upload(rasha, "pd_presenter");
    assert.deepEqual([refused.status, refused.error?.code], [422, "INVALID_FOLDER"]);
    const [audit] = await api.sql`select entity_id, after from audit_log where entity = 'folders' order by at desc limit 1`;
    assert.deepEqual([audit.after.op, audit.after.key, audit.after.label], ["delete", "professional_development", "حذف «التطوير المهني»"]);

    // A sub-folder brings its removed parent back (not its sibling); a folder brings back only what was removed with it.
    const shownNow = async () => {
      const member = keys((await foldersOf(ids.rasha)).layout.member);
      return ["professional_development", "pd_presenter", "pd_attendee"].map(key => member.includes(key));
    };
    await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "restore", key: "pd_presenter" } });
    assert.deepEqual(await shownNow(), [true, true, false]);
    await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "delete", key: "professional_development" } });
    await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "restore", key: "professional_development" } });
    assert.deepEqual(await shownNow(), [true, true, false], "مستفيد was removed at another time");
    const shown = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "restore", key: "professional_development" } });
    assert.deepEqual(shown.data.results.map(result => result.note), ["المجلد ظاهر عندها"]);
    await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "restore", key: "pd_attendee" } });
    assert.equal((await upload(rasha, "pd_presenter")).status, 201);

    const schoolDelete = await bulk({ memberIds: [ids.rasha], scope: "school", op: { type: "delete", key: "discipline" } });
    assert.deepEqual(schoolDelete.data.results.map(result => result.filesToUnsorted), [1], "her school's file in الانضباط التعليمي › خطة الانضباط");
    await bulk({ memberIds: [ids.rasha], scope: "school", op: { type: "restore", key: "discipline" } });
    const school = (await foldersOf(ids.rasha)).layout.school;
    assert.deepEqual(shape(school), shape(DEFAULT_FOLDERS.school), "back with its sub-folders, in place");

    const entry = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "delete", key: "schools" } });
    assert.deepEqual(entry.data.results.map(result => [result.status, result.note]), [["skipped", "«مدارس المشرفة» تُخفى ولا تُحذف"]]);
  });

  test("hiding «مدارس المشرفة» takes her school folders out of reach; uploads there answer INVALID_FOLDER", async () => {
    const hidden = await bulk({ memberIds: [ids.rasha], op: { type: "hide_schools" } });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.error));
    assert.deepEqual(hidden.data.results.map(result => [result.status, result.filesToUnsorted]), [["done", 1]]);
    const { layout } = await foldersOf(ids.rasha);
    assert.ok(!layout.member.some(folder => folder.kind === "schools"));
    const refused = await upload(rasha, "visit_reports", rashaSchool);
    assert.deepEqual([refused.status, refused.error?.code], [422, "INVALID_FOLDER"]);
    const [file] = (await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha)).data;
    const moved = await api.call("PATCH", `/attachments/${file.id}`, { folder: "forms", schoolId: rashaSchool }, rasha);
    assert.deepEqual([moved.status, moved.error?.code], [422, "INVALID_FOLDER"]);
    const again = await bulk({ memberIds: [ids.rasha], op: { type: "hide_schools" } });
    assert.deepEqual(again.data.results.map(result => result.note), ["«مدارس المشرفة» مخفية عندها"]);
    assert.equal((await bulk({ memberIds: [ids.rasha], scope: "school", op: { type: "hide_schools" } })).status, 422);

    const shown = await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "show_schools" } });
    assert.equal(shown.data.results[0].status, "done");
    assert.equal((await upload(rasha, "visit_reports", rashaSchool)).status, 201);
  });

  test("sync makes members' folders exactly another member's; the preview matches what is applied", async () => {
    // Rasha's folders differ from the defaults (added, renamed, reordered); she drops ميثاق الأداء and hides her schools.
    await bulk({ memberIds: [ids.rasha], scope: "member", op: { type: "delete", key: "performance_charter" } });
    await bulk({ memberIds: [ids.rasha], scope: "school", op: { type: "rename", key: "forms", label: "النماذج" } });
    await bulk({ memberIds: [ids.rasha], op: { type: "hide_schools" } });
    const charter = await upload(maha, "performance_charter");
    assert.equal(charter.status, 201);
    const source = (await foldersOf(ids.rasha)).layout;
    const mahaBefore = (await foldersOf(ids.maha)).layout;
    const audits = await auditCount();

    const body = { fromMemberId: ids.rasha, toMemberIds: [ids.maha, ids.manal, ids.rasha] };
    const preview = await sync({ ...body, dryRun: true });
    assert.equal(preview.status, 200, JSON.stringify(preview.error));
    assert.equal(preview.data.applied, false);
    assert.deepEqual(preview.data.results.map(result => result.memberId).sort(), [ids.maha, ids.manal].sort(), "the source is not a target");
    const mahaPreview = preview.data.results.find(result => result.memberId === ids.maha)!;
    assert.deepEqual(mahaPreview.added, ["الشهادات"]);
    assert.deepEqual(mahaPreview.renamed, ["الاستمارات ← النماذج"]);
    assert.deepEqual(mahaPreview.removed.sort(), ["مدارس المشرفة", "ميثاق الأداء الوظيفي"].sort());
    assert.equal(mahaPreview.filesToUnsorted, 1, "her file in ميثاق الأداء الوظيفي");
    const manalPreview = preview.data.results.find(result => result.memberId === ids.manal)!;
    assert.ok(manalPreview.renamed.includes("مبادرات المشرفة ← مبادراتي"));
    assert.ok(manalPreview.added.includes("محرم"));
    assert.deepEqual((await foldersOf(ids.maha)).layout, mahaBefore, "a dry run changes nothing");
    assert.equal(await auditCount(), audits);

    const applied = await sync(body);
    assert.equal(applied.data.applied, true);
    assert.deepEqual(applied.data.results, preview.data.results, "the preview is the real effect");
    for (const memberId of [ids.maha, ids.manal]) {
      const { layout } = await foldersOf(memberId);
      assert.deepEqual([shape(layout.member), shape(layout.school)], [shape(source.member), shape(source.school)], memberId);
    }
    assert.equal(await auditCount(), audits + 2);
    const charterFile = (await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, maha)).data.find(file => file.id === charter.data[0].id);
    assert.equal(charterFile?.folder, "performance_charter", "her file waits under its key");

    const again = await sync({ fromMemberId: ids.rasha, toMemberIds: [ids.maha], scopes: ["member"] });
    assert.deepEqual(again.data.results.map(result => [result.added, result.renamed, result.removed, result.restored, result.filesToUnsorted]), [[[], [], [], [], 0]]);
    assert.equal(await auditCount(), audits + 2, "nothing changed, nothing audited");

    // Back to the defaults' «مدارس المشرفة» from a member who has it: restored, not added.
    const restored = await sync({ fromMemberId: ids.samah, toMemberIds: [ids.maha], scopes: ["member"] });
    assert.ok(restored.data.results[0].restored.includes("مدارس المشرفة"));
    assert.ok((await foldersOf(ids.maha)).layout.member.some(folder => folder.kind === "schools"));
    assert.equal((await sync({ fromMemberId: ids.rasha, toMemberIds: [ids.maha], scopes: ["files"] })).status, 422);
  });

  test("the head files a district document into a member's folder", async () => {
    const form = new FormData();
    form.append("files", new Blob(["تقرير"], { type: "text/plain" }), "تقرير.txt");
    const [attachment] = (await api.call<{ id: string }[]>("POST", "/chat/attachments", form, head)).data;
    const refused = await api.call("POST", `/district/documents/${attachment.id}/assign`, { memberId: ids.rasha, folder: "random" }, head);
    assert.deepEqual([refused.status, refused.error?.code], [422, "INVALID_FOLDER"]);
    assert.equal((await api.sql`select cluster_id from attachments where id = ${attachment.id}`)[0].clusterId, null, "nothing filed");
    assert.equal((await api.call("POST", `/district/documents/${attachment.id}/assign`, { folder: "initiatives" }, head)).status, 422);

    const filed = await api.call<DocumentInfo>("POST", `/district/documents/${attachment.id}/assign`, { memberId: ids.rasha, folder: "initiatives" }, head);
    assert.equal(filed.status, 200, JSON.stringify(filed.error));
    assert.deepEqual([filed.data.ownerId, filed.data.folder, filed.data.schoolId], [ids.rasha, "initiatives", null]);
    const unfiled = await api.call<DocumentInfo>("POST", `/district/documents/${attachment.id}/assign`, { memberId: ids.maha }, head);
    assert.deepEqual([unfiled.data.ownerId, unfiled.data.folder], [ids.maha, null], "another member's file starts out of the folders");
  });

  test("the overview of every member's folders", async () => {
    const overview = await api.call<{ members: { memberId: string; name: string; title: string; layout: FolderLayout; counts: Counts }[] }>("GET", "/district/folders", undefined, head);
    assert.equal(overview.status, 200);
    const [{ members }] = await api.sql`select count(*)::int as members from profiles where role = 'member' and deleted_at is null`;
    assert.equal(overview.data.members.length, members);
    const rashaRow = overview.data.members.find(member => member.memberId === ids.rasha)!;
    assert.equal(rashaRow.title, "عضو فريق تنفيذي");
    assert.deepEqual(rashaRow.layout, (await foldersOf(ids.rasha)).layout);
    assert.equal(rashaRow.counts.member.pd_presenter, 2);
  });

  test("members get 403 on the head's routes; another district's member is not found", async () => {
    const memberCalls: [string, string, unknown][] = [
      ["GET", "/district/folders", undefined], ["GET", `/district/members/${ids.rasha}/folders`, undefined],
      ["POST", "/district/folders/bulk", { memberIds: [ids.rasha], scope: "member", op: { type: "add", label: "س" } }],
      ["POST", "/district/folders/sync", { fromMemberId: ids.maha, toMemberIds: [ids.rasha] }],
      ["POST", `/district/documents/${ids.rasha}/assign`, { memberId: ids.rasha }],
    ];
    for (const [method, path, body] of memberCalls) assert.equal((await api.call(method, path, body, rasha)).status, 403, path);

    const [district] = await api.sql`insert into districts (name) values ('نطاق آخر') returning id`;
    const [user] = await api.sql`insert into auth.users (email) values ('other.district@example.com') returning id`;
    await api.sql`insert into profiles (id, district_id, role, name, email) values (${user.id}, ${district.id}, 'member', 'عضوة نطاق آخر', 'other.district@example.com')`;
    await api.sql`insert into clusters (district_id, member_id) values (${district.id}, ${user.id})`;
    const other = String(user.id);
    assert.equal((await api.call("GET", `/district/members/${other}/folders`, undefined, head)).status, 404);
    assert.equal((await bulk({ memberIds: [ids.rasha, other], scope: "member", op: { type: "add", label: "س" } })).status, 404);
    assert.equal((await sync({ fromMemberId: other, toMemberIds: [ids.rasha] })).status, 404);
    assert.equal((await sync({ fromMemberId: ids.rasha, toMemberIds: [other] })).status, 404);
    assert.equal((await api.sql`select count(*)::int as count from folders where label = 'س'`)[0].count, 0, "nothing written");
    assert.equal((await api.call("GET", `/district/members/not-a-uuid/folders`, undefined, head)).status, 404);
  });
});
