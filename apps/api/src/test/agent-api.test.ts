// The agent's full access to the head's API: the route catalog, the in-process API (internal-api.ts), reading with
// api_get, changing through one server-described card (propose_actions) that runs on approval as the head, and KPI
// sheets brought to the chat.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatBlock, ChatMessage, ProposalResolveResult } from "@rasd/schemas";
import { setupFixture, xlsxBuffer, type Fixture } from "./fixture.js";

let f: Fixture;
let tools: typeof import("../agent/claude-tools.js");
let catalog: typeof import("../agent/catalog.js");
let internal: typeof import("../internal-api.js");

type Proposal = Extract<ChatBlock, { type: "proposal" }>;
const proposalOf = (blocks: ChatBlock[]) => blocks.find((block): block is Proposal => block.type === "proposal");
const toolContext = async (attachments: Awaited<ReturnType<Fixture["document"]>>[] = []) => {
  const { id } = await f.chat.createConversation(f.sql, f.head.id, "api");
  return tools.toolContext({ db: f.sql, head: f.head, audit: f.audit, conversationId: id }, attachments.filter(<T>(item: T | null): item is T => Boolean(item)));
};
/** Runs propose_actions and returns its card (the tool must succeed). */
async function propose(actions: unknown[], title?: string) {
  const ctx = await toolContext();
  const result = await tools.runTool("propose_actions", { actions, ...(title ? { title } : {}) }, ctx);
  assert.equal(result.isError, false, result.content);
  return proposalOf(ctx.blocks)!;
}
const schoolOf = async (memberId: string, name: string) => (await f.detail(memberId)).workspace.schools.find(school => school.name === name)!;
const apply = (proposalId: string) => f.api.call<ProposalResolveResult>("POST", `/chat/proposals/${proposalId}/apply`, undefined, f.headToken);
const ID = "11111111-2222-4333-8444-555555555555";

before(async () => {
  f = await setupFixture();
  tools = await import("../agent/claude-tools.js");
  catalog = await import("../agent/catalog.js");
  internal = await import("../internal-api.js");
});
after(async () => { await f?.stop(); });

describe("the route catalog", () => {
  test("paths cannot be forged: params are ids (or an earlier action's id), never path pieces", () => {
    const { ActionError, checkAction, pathOf, catalogById } = catalog;
    const refused: [unknown, number, "read" | "change"][] = [
      [{ route: "member", params: { id: "../../chat/conversations" } }, 0, "read"],
      [{ route: "school_update", params: { memberId: "%2e%2e%2fchat", id: ID } }, 0, "change"],
      [{ route: "school_update", params: { memberId: ID, id: ID, extra: ID } }, 0, "change"],
      [{ route: "school_update", params: { memberId: ID } }, 0, "change"],
      [{ route: "school_update", params: { memberId: "$1.id", id: ID } }, 0, "change"], // no earlier action yet
      [{ route: "school_update", params: { memberId: "$3.id", id: ID } }, 1, "change"],
      [{ route: "chat_messages" }, 0, "read"],
      [{ route: "team" }, 0, "change"], // reads go through api_get
      [{ route: "member_delete", params: { id: ID } }, 0, "read"],
      [{ route: "kpi_import" }, 0, "change"], // a sheet only through import_kpis
      [{ route: "members", query: { path: "/chat" } }, 0, "read"],
      [{ route: "school_create", params: { memberId: ID }, body: { name: "س", parentId: "$2.id" } }, 1, "change"],
    ];
    for (const [action, index, use] of refused) assert.throws(() => checkAction(action as never, index, use), ActionError, JSON.stringify(action));
    assert.doesNotThrow(() => checkAction({ route: "school_update", params: { memberId: "$1.id", id: ID } }, 1, "change"));
    assert.equal(pathOf(catalogById("member")!, { id: ID }), `/district/members/${ID}`);
    const search = new URL(pathOf(catalogById("members")!, {}, { q: "رشا&filter=all" }), "http://x").searchParams;
    assert.deepEqual([...search.entries()], [["q", "رشا&filter=all"]], "a query value stays one value");
  });

  test("every catalog route is a registered head route of the internal API", () => {
    const registered = new Set(internal.internalApi.routes.filter(route => route.method !== "ALL").map(route => `${route.method} ${route.path}`));
    for (const entry of catalog.CATALOG) assert.ok(registered.has(`${entry.method} ${entry.path}`), `${entry.id}: ${entry.method} ${entry.path}`);
    const reference = catalog.apiReference();
    assert.doesNotMatch(reference, /kpi_import\b(?!_)/, "the import route is not offered to the model");
    assert.match(reference, /folders_bulk/);
  });
});

describe("the internal API", () => {
  test("answers only in-process calls, and only for catalog routes", async () => {
    // Over the network every path needs a token; the internal API itself refuses requests without the private symbol.
    assert.equal((await f.api.call("GET", "/district/team")).status, 401);
    assert.equal((await internal.internalApi.fetch(new Request("http://x/district/team"))).status, 401);
    assert.equal((await internal.internalApi.fetch(new Request("http://x/district/team"), { incoming: {} } as never)).status, 401);

    const head = await internal.currentHead(f.head.id);
    assert.equal((await internal.callInternal(head, "GET", "/district/team")).status, 200);
    const [{ before: reminders }] = await f.sql`select count(*)::int as before from reminders`;
    for (const [method, path] of [["POST", "/district/reminders"], ["GET", "/chat/conversations"], ["GET", "/district/kpis/export"], ["POST", "/district/members/x/documents"]]) {
      const result = await internal.callInternal(head, method, path, method === "POST" ? { memberIds: [f.rasha.id], body: "x" } : undefined);
      assert.equal(result.status, 404, `${method} ${path}`);
    }
    assert.equal((await f.sql`select count(*)::int as n from reminders`)[0].n, reminders, "nothing outside the catalog ran");

    // The routes' own checks still apply: a member is not the head.
    const member = { ...head, id: f.rasha.id, role: "member" as const, clusterId: f.rasha.clusterId };
    assert.equal((await internal.callInternal(member, "GET", "/district/team")).status, 403);
    await assert.rejects(internal.currentHead(f.rasha.id), /لرئيسة النطاق/);
  });
});

describe("api_get", () => {
  test("one status line, then the answer inside untrusted tags; file text turns immediate writes off", async () => {
    const ctx = await toolContext();
    const folders = await tools.runTool("api_get", { route: "member_folders", params: { memberId: f.rasha.id } }, ctx);
    assert.equal(folders.isError, false, folders.content);
    assert.match(folders.content, /^\{"route":"member_folders","status":200\}\n<untrusted_member_data route="member_folders">\n/);
    assert.equal(ctx.readDocuments, false);

    const member = await tools.runTool("api_get", { route: "member", params: { id: f.rasha.id } }, ctx);
    assert.equal(member.isError, false, member.content);
    assert.doesNotMatch(member.content, /excerpt/, "file text reaches the model only through the routes that say so");
    assert.equal(ctx.readDocuments, false);

    const files = await tools.runTool("api_get", { route: "member_documents", params: { id: f.rasha.id } }, ctx);
    assert.match(files.content, /^\{"route":"member_documents","status":200,"count":1\}\n<untrusted_document route="member_documents">/);
    assert.equal(ctx.readDocuments, true);
    assert.equal((await tools.runTool("update_member_fields", { member: "رشا", fields: [{ field: "phone", value: "0500000009" }] }, ctx)).content, tools.WRITES_OFF_MESSAGE);

    const forged = await tools.runTool("api_get", { route: "member", params: { id: "../../chat" } }, ctx);
    assert.equal(forged.isError, true);
    const missing = await tools.runTool("api_get", { route: "member", params: { id: ID } }, ctx);
    assert.match(missing.content, /"status":404/);
  });
});

describe("propose_actions", () => {
  test("the card is written by the server from the database; approving runs it as the head (source agent)", async () => {
    const school = await schoolOf(f.rasha.id, "الابتدائية ١٢٠");
    const card = await propose([
      { route: "school_update", params: { memberId: f.rasha.id, id: school.id }, body: { tier: "تقدم", students: 430 } },
      { route: "staff_tile_create", params: { memberId: f.rasha.id, parentId: school.id }, body: { label: "الوكيلات", value: 3 } },
    ], "تحديث بيانات المدرسة");
    assert.equal(card.title, "تغييرات في ملف رشا القرني");
    assert.equal(card.summary, "تعديل ١ · إضافة ١\nوصف المساعد: تحديث بيانات المدرسة");
    const tier = card.changes.find(change => change.fieldLabel.endsWith("التصنيف"))!;
    assert.deepEqual([tier.memberId, tier.fieldLabel, tier.before, tier.after], [f.rasha.id, "مدرسة «الابتدائية ١٢٠»: التصنيف", "تميز", "تقدم"]);
    assert.ok(card.changes.some(change => change.fieldLabel === "إضافة مؤشر «الوكيلات» في «الابتدائية ١٢٠»" && change.after === "الوكيلات · القيمة: 3"));
    assert.equal((await schoolOf(f.rasha.id, "الابتدائية ١٢٠")).tier, "تميز", "nothing changes before she approves");

    const applied = await apply(card.proposalId);
    assert.equal(applied.status, 200, JSON.stringify(applied.error));
    assert.equal(applied.data.assistantMessage.text, "تم ✅ نفّذت البنود كلها (بندان).");
    const table = applied.data.assistantMessage.blocks.find(block => block.type === "table");
    assert.ok(table && table.type === "table");
    assert.deepEqual(table.rows.map(row => row[1]), ["تم", "تم"]);
    const after = await schoolOf(f.rasha.id, "الابتدائية ١٢٠");
    assert.deepEqual([after.tier, after.students, after.staffTiles?.some(tile => tile.label === "الوكيلات" && tile.value === 3)], ["تقدم", 430, true]);
    const [row] = await f.sql`select actor_id, source from audit_log where entity = 'school' and entity_id = ${school.id} and field = 'tier' order by at desc limit 1`;
    assert.deepEqual([row.actorId, row.source], [f.head.id, "agent"]);
  });

  test("\"$N.id\" stands for what an earlier action creates", async () => {
    const card = await propose([
      { route: "school_create", params: { memberId: f.maha.id }, body: { name: "الابتدائية ٤٠", stage: "ابتدائية" } },
      { route: "school_field_create", params: { memberId: f.maha.id, parentId: "$1.id" }, body: { label: "ملاحظات", value: "افتُتحت هذا العام" } },
    ]);
    assert.ok(card.changes.some(change => change.fieldLabel === "إضافة حقل «ملاحظات» في «الابتدائية ٤٠»"));
    assert.equal((await apply(card.proposalId)).status, 200);
    const school = await schoolOf(f.maha.id, "الابتدائية ٤٠");
    assert.equal(school.customFields?.find(field => field.label === "ملاحظات")?.value, "افتُتحت هذا العام");
  });

  test("a failing action stops the rest; if the first fails nothing changed and the card stays", async () => {
    const [first, second] = (await f.detail(f.rasha.id)).workspace.schools;
    const card = await propose([
      { route: "school_update", params: { memberId: f.rasha.id, id: first.id }, body: { classes: 15 } },
      { route: "school_update", params: { memberId: f.rasha.id, id: second.id }, body: { tier: "ممتاز" } },
      { route: "school_update", params: { memberId: f.rasha.id, id: second.id }, body: { classes: 99 } },
    ]);
    const applied = await apply(card.proposalId);
    assert.equal(applied.status, 200);
    assert.match(applied.data.assistantMessage.text, /^نفّذت بنداً واحداً من ٣، ثم توقف التنفيذ عند «تعديل مدرسة «المتوسطة ٣٣»»: اختاري قيمة من القائمة/);
    const table = applied.data.assistantMessage.blocks.find(block => block.type === "table");
    assert.ok(table && table.type === "table");
    assert.deepEqual(table.rows.map(row => row[1]), ["تم", "اختاري قيمة من القائمة", "لم يُنفّذ"]);
    assert.equal((await schoolOf(f.rasha.id, "المتوسطة ٣٣")).classes, 12, "the third action never ran");

    const failing = await propose([{ route: "school_update", params: { memberId: f.rasha.id, id: second.id }, body: { tier: "ممتاز" } }]);
    const refused = await apply(failing.proposalId);
    assert.equal(refused.status, 422);
    assert.equal((await f.chat.getProposal(f.sql, failing.proposalId))?.status, "pending");
  });

  test("a row edited after the card was made is not overwritten (409)", async () => {
    const school = await schoolOf(f.maha.id, "الثانوية ٧");
    const card = await propose([{ route: "school_update", params: { memberId: f.maha.id, id: school.id }, body: { area: "العليا" } }]);
    await f.sql`update schools set area = 'الملز' where id = ${school.id}`;
    const stale = await apply(card.proposalId);
    assert.equal(stale.status, 409);
    assert.equal((await schoolOf(f.maha.id, "الثانوية ٧")).area, "الملز");
  });

  test("ids that are not hers, unknown members and no-op changes are refused before anything is stored", async () => {
    const rashaSchool = await schoolOf(f.rasha.id, "الابتدائية ١٢٠");
    const ctx = await toolContext();
    const cases = [
      [{ route: "school_update", params: { memberId: f.maha.id, id: rashaSchool.id }, body: { classes: 1 } }],
      [{ route: "school_update", params: { memberId: ID, id: rashaSchool.id }, body: { classes: 1 } }],
      [{ route: "school_update", params: { memberId: f.rasha.id, id: rashaSchool.id }, body: { tier: rashaSchool.tier } }],
    ];
    const [{ count: before }] = await f.sql`select count(*)::int as count from agent_runs where action = 'api_requests'`;
    for (const actions of cases) assert.equal((await tools.runTool("propose_actions", { actions }, ctx)).isError, true, JSON.stringify(actions));
    assert.equal((await f.sql`select count(*)::int as count from agent_runs where action = 'api_requests'`)[0].count, before);
  });

  test("destructive changes lead the card and say they cannot be undone", async () => {
    const card = await propose([
      { route: "member_contact", params: { id: f.muneera.id }, body: { title: "عضو نواتج تعلم" } },
      { route: "member_reset_password", params: { id: f.muneera.id } },
    ]);
    assert.equal(card.changes[0].fieldLabel, "إعادة تعيين كلمة المرور");
    assert.match(card.changes[0].source ?? "", /لا يمكن التراجع/);
    assert.deepEqual([card.changes[1].before, card.changes[1].after], ["عضو فريق تنفيذي", "عضو نواتج تعلم"]);
  });

  test("a card left for a day expires instead of applying data that moved on", async () => {
    const school = await schoolOf(f.maha.id, "الثانوية ٧");
    const ctx = await toolContext();
    await tools.runTool("propose_actions", { actions: [{ route: "school_update", params: { memberId: f.maha.id, id: school.id }, body: { classes: 20 } }] }, ctx);
    const card = proposalOf(ctx.blocks)!;
    await f.chat.addMessage(f.sql, (await f.chat.getProposal(f.sql, card.proposalId))!.conversationId!, { role: "assistant", text: "جهّزت البطاقة", blocks: ctx.blocks });
    await f.sql`update agent_runs set proposed_at = now() - interval '25 hours' where id = ${card.proposalId}`;
    const expired = await apply(card.proposalId);
    assert.equal(expired.status, 410);
    assert.equal(expired.error?.code, "PROPOSAL_EXPIRED");
    assert.equal((await f.chat.getProposal(f.sql, card.proposalId))?.status, "rejected");
    assert.notEqual((await schoolOf(f.maha.id, "الثانوية ٧")).classes, 20);
  });

  test("folders for several members: one bulk action, described by the API's own dry run", async () => {
    const card = await propose([{ route: "folders_bulk", body: { memberIds: "all", scope: "member", op: { type: "add", label: "تقارير الفصل الأول" } } }]);
    assert.equal(card.changes.length, f.members.length, "one row per member");
    assert.ok(card.changes.every(change => change.fieldLabel === "إضافة مجلد «تقارير الفصل الأول»"));
    assert.equal(card.title, `تغييرات في ملفات ${new Intl.NumberFormat("ar-SA").format(f.members.length)} مشرفة`);
    assert.equal((await apply(card.proposalId)).status, 200);
    const layouts = await f.sql`select count(distinct key)::int as keys, count(*)::int as rows from folders where label = 'تقارير الفصل الأول' and deleted_at is null`;
    assert.deepEqual([layouts[0].keys, layouts[0].rows], [1, f.members.length], "one key for everyone");

    const remove = await propose([{ route: "folders_bulk", body: { memberIds: [f.rasha.id, f.maha.id], scope: "member", op: { type: "delete", key: "visit_plan" } } }]);
    assert.ok(remove.changes.every(change => change.fieldLabel === "حذف مجلد «خطة الزيارات» ومجلداته الفرعية"));
  });
});

describe("KPI sheets in the chat", () => {
  const sheet = () => xlsxBuffer({
    "التعليمات": [["تعليمات تعبئة الملف"], ["", "", "اسم المدرسة"], ["M3995842", "", "ثانوية مثال"]],
    "الفريق التنفيذي 5": [
      ["البيانات الأولية", "", "", "", "", "", "", "الإدارة المدرسية", "", "", "اسم عضو الفريق التنفيذي المتابع"],
      ["الرقم الوزاري", "اسم المدرسة", "المرحلة", "نوع التقويم", "المستوى العام للمدرسة رقما للعام 1447", "درجة النواتج",
        "مستوى المتابعة في مؤشرات الالتزام في الانضباط التعليمي", "التخطيط رقما", "التخطيط", "تقويم التعلم رقما", "-"],
      ["120120", "الابتدائية ١٢٠", "الابتدائية", "خارجي", 82.5, 70, "متابعة عالية", 84.75, "التقدم", 60, "رشا القرني"],
      ["4455667", "المتوسطة الرابعة", "المتوسطة", "خارجي", 45, 40, "متابعة شديدة", 30, "التهيئة", 48, "مها السبيعي"],
      ["7788990", "الثانوية الخامسة", "الثانوية", "ذاتي", 91, 88, "متابعة متوسطة", 95, "التميز", 90, "اسم ليس في الفريق"],
    ],
  });

  test("the local engine turns a KPI sheet into a register import card — never school rows — applied with an undo", async () => {
    const id = await f.upload("مؤشرات الأداء.xlsx", sheet());
    const schoolsBefore = (await f.sql`select count(*)::int as n from schools`)[0].n;
    f.newConversation();
    const reply = await f.ask("", [id]);
    const card = proposalOf(reply.blocks);
    assert.ok(card, reply.text);
    assert.equal((await f.chat.getProposal(f.sql, card.proposalId))?.kind, "kpi_import");
    assert.match(reply.text, /ملف مؤشرات أداء/);
    assert.equal(card.title, "استيراد مؤشرات الأداء من «مؤشرات الأداء.xlsx»");
    assert.match(card.summary, /العام 1447 · تُضاف ٣/);
    assert.ok(card.changes.some(change => change.fieldLabel === "ورقة «الفريق التنفيذي 5»"));
    assert.ok(!card.changes.some(change => change.fieldLabel.includes("التعليمات") && change.after !== "لن تُستورد"));
    const rasha = card.changes.find(change => change.fieldLabel.startsWith("«رشا القرني»"))!;
    assert.deepEqual([rasha.memberId, rasha.after], [f.rasha.id, f.rasha.name]);
    assert.ok(card.changes.some(change => change.fieldLabel.startsWith("«اسم ليس في الفريق»") && change.after === "لن تُسند لأحد"));
    assert.equal((await f.sql`select count(*)::int as n from school_kpis where deleted_at is null`)[0].n, 0, "nothing before approval");

    const applied = await f.approve(card.proposalId);
    assert.match(applied.text, /^تم ✅ استوردت مؤشرات الأداء/);
    assert.equal((await f.sql`select count(*)::int as n from schools`)[0].n, schoolsBefore, "no school was added to any member's file");
    const rows = await f.sql`select school_name, assigned_member_id from school_kpis where deleted_at is null order by school_name`;
    assert.equal(rows.length, 3);
    assert.equal(rows.find(row => row.schoolName === "المتوسطة الرابعة")?.assignedMemberId, f.maha.id);

    const undo = applied.blocks.find(block => block.type === "applied");
    assert.ok(undo && undo.type === "applied" && undo.undoProposalId);
    const undone = await f.approve(undo.undoProposalId);
    assert.equal(undone.text, "تم التراجع ✅ أعدت سجل مؤشرات الأداء كما كان قبل الاستيراد.");
    assert.equal((await f.sql`select count(*)::int as n from school_kpis where deleted_at is null`)[0].n, 0);
  });

  test("Claude: import_attachment refuses a KPI sheet; import_kpis makes the card and counts as reading the file", async () => {
    const id = await f.upload("مؤشرات ١٤٤٧.xlsx", sheet());
    const ctx = await toolContext([await f.document(id)]);
    const refused = await tools.runTool("import_attachment", { document_id: id }, ctx);
    assert.deepEqual([refused.isError, refused.content], [true, "هذا ملف مؤشرات أداء — استخدمي import_kpis"]);

    const fresh = await toolContext();
    const result = await tools.runTool("import_kpis", { document_id: id }, fresh);
    assert.equal(result.isError, false, result.content);
    assert.match(result.content, /^\{"created":true,"year":"1447","added":3/);
    assert.match(result.content, /<untrusted_document name="مؤشرات ١٤٤٧\.xlsx"/);
    assert.equal(fresh.readDocuments, true);
    const card = proposalOf(fresh.blocks)!;
    assert.equal((await f.chat.getProposal(f.sql, card.proposalId))?.kind, "kpi_import");
  });

  test("query_kpis and find_school read the register inside untrusted tags", async () => {
    const id = await f.upload("سجل.xlsx", sheet());
    const ctx = await toolContext();
    await tools.runTool("import_kpis", { document_id: id }, ctx);
    await f.approve(proposalOf(ctx.blocks)!.proposalId);

    const kpis = await tools.runTool("query_kpis", { member: "مها السبيعي" }, ctx);
    assert.match(kpis.content, /^<untrusted_member_data source="مؤشرات الأداء">/);
    const data = JSON.parse(kpis.content.replace(/^<untrusted_member_data[^>]*>\n/, "").replace(/\n<\/untrusted_member_data>$/, ""));
    assert.deepEqual(data.rows.map((row: { school: string }) => row.school), ["المتوسطة الرابعة"]);
    assert.equal(data.rows[0].overall, "45 (تهيئة)");
    assert.equal(data.rows[0].standards["التخطيط"], "30 (دعم ومساندة شديدة)");

    const found = await tools.runTool("find_school", { query: "الابتدائيه 120" }, ctx);
    const schools = JSON.parse(found.content.replace(/^<untrusted_member_data[^>]*>\n/, "").replace(/\n<\/untrusted_member_data>$/, ""));
    assert.equal(schools.schools[0].memberId, f.rasha.id);
    assert.equal(schools.register[0].ministryNo, "120120");
    const byNumber = await tools.runTool("find_school", { query: "٤٤٥٥٦٦٧" }, ctx);
    assert.match(byNumber.content, /"schoolName":"المتوسطة الرابعة"/);
  });
});

describe("assign_document", () => {
  test("files a chat upload straight into one of her folders (checked again on approval)", async () => {
    const id = await f.upload("خطة دعم.pdf", Buffer.from("%PDF-1.4 plan"));
    const ctx = await toolContext();
    const wrong = await tools.runTool("assign_document", { document_id: id, member: "رشا القرني", folder_key: "no_such_folder" }, ctx);
    assert.equal(wrong.isError, true);
    assert.match(wrong.content, /initiatives \(مبادرات المشرفة\)/, "the model is told her real folders");
    const result = await tools.runTool("assign_document", { document_id: id, member: "رشا القرني", folder_key: "support_plan", school: "الابتدائية ١٢٠" }, ctx);
    assert.equal(result.isError, false, result.content);
    const card = proposalOf(ctx.blocks)!;
    assert.equal(card.changes[0].after, "خطة دعم.pdf — في مدارس المشرفة › الابتدائية ١٢٠ › خطة دعم المدرسة");
    await f.approve(card.proposalId);
    const filed = (await f.document(id))!;
    const school = await schoolOf(f.rasha.id, "الابتدائية ١٢٠");
    assert.deepEqual([filed.ownerId, filed.folder, filed.schoolId], [f.rasha.id, "support_plan", school.id]);
  });
});

describe("chat speed", () => {
  test("a reply reads only the last messages, and the conversation comes back without a second read", async () => {
    const sent = await f.api.call<{ conversation: { id: string; preview: string }; assistantMessage: ChatMessage }>("POST", "/chat/messages", { text: "أرقام الفريق" }, f.headToken);
    assert.equal(sent.status, 201);
    assert.equal(sent.data.conversation.preview, sent.data.assistantMessage.text.replace(/\s+/g, " ").trim().slice(0, 120));
    for (let i = 0; i < 15; i++) await f.chat.addMessage(f.sql, sent.data.conversation.id, { role: i % 2 ? "assistant" : "user", text: `رسالة ${i}` });
    const recent = await f.chat.listMessages(f.sql, sent.data.conversation.id, 24);
    assert.equal(recent.length, 17);
    const last = await f.chat.listMessages(f.sql, sent.data.conversation.id, 4);
    assert.deepEqual(last.map(message => message.text), ["رسالة 11", "رسالة 12", "رسالة 13", "رسالة 14"]);
  });
});
