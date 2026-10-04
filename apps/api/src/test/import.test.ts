// Files dropped into the chat: rosters, school tables, label:value documents, unknown owners.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatBlock } from "@rasd/schemas";
import { docxBuffer, setupFixture, xlsxBuffer, type Fixture } from "./fixture.js";

type Reply = { text: string; blocks: ChatBlock[]; intent?: string };
type ProposalBlock = Extract<ChatBlock, { type: "proposal" }>;
let f: Fixture;

const proposalOf = (reply: Reply) => {
  const block = reply.blocks.find((item): item is ProposalBlock => item.type === "proposal");
  assert.ok(block, `expected a proposal in:\n${reply.text}`);
  assert.equal(block.status, "pending");
  return block;
};
const choicesOf = (reply: Reply) => reply.blocks.find((item): item is Extract<ChatBlock, { type: "choices" }> => item.type === "choices");
const schoolsOf = async (memberId: string) => (await f.detail(memberId)).workspace.schools;
const ownerOf = async (documentId: string) => (await f.document(documentId))!.ownerId;

describe("importing files in the chat", () => {
  before(async () => { f = await setupFixture(); });
  after(() => f.stop());

  test("a roster spreadsheet: changed phones, an unknown header, a new person, an unusable row", async () => {
    f.newConversation();
    const id = await f.upload("كشف المشرفات.xlsx", xlsxBuffer({ "ردود النموذج 1": [
      ["طابع زمني", "الاسم رباعي", "الصفة", "البريد الالكتروني الخاص ( gmail )", "رقم الجوال", "السجل المدني", "الدورات"],
      ["2026/09/01", "رشا خالد سعد القرني", "عضو فريق تنفيذي", "rasha.member@example.com", "0551112233", "1012345678", "٣ دورات"],
      ["2026/09/01", "منيرة فهد عبدالرحمن الرويلي ", "عضو فريق تنفيذي", "Munira.member@example.com", "555443322", "1098765432", "دورتان"],
      ["2026/09/02", "فاطمة عوض الدوسري", "أخصائية نشاط طلابي", "", "٠٥٤٤٣٣٢٢١١", "", ""],
      ["2026/09/02", "نورة محمد القحطاني", "عضو فريق تنفيذي", "noura.q@gmail.com", "0533221100", "1122334455", ""],
      ["2026/09/03", "سارة الدوسري", "", "", "", "", ""],
    ] }));
    const reply = await f.ask("", [id]) as Reply;
    assert.equal(reply.intent, "import");
    const proposal = proposalOf(reply);

    const muneeraPhone = proposal.changes.find(change => change.memberId === f.muneera.id && change.fieldId === "phone");
    assert.deepEqual([muneeraPhone?.before, muneeraPhone?.after], ["0509998877", "0555443322"], "matched by email (case-insensitive), phone tidied");
    assert.ok(muneeraPhone?.source?.includes("الصف ٣"));
    const fatimaPhone = proposal.changes.find(change => change.memberId === f.fatimaDosari.id && change.fieldId === "phone");
    assert.equal(fatimaPhone?.after, "0544332211", "matched by unique full name; Arabic-Indic digits converted");
    const custom = proposal.changes.find(change => change.memberId === f.muneera.id && change.fieldLabel === "الدورات");
    assert.ok(custom && custom.fieldId === null, "an unknown header becomes a new custom field");
    assert.ok(!proposal.changes.some(change => change.memberId === f.rasha.id && change.fieldId === "phone"), "unchanged values are not proposed");
    assert.ok(!proposal.changes.some(change => change.fieldLabel.includes("طابع")), "timestamps are ignored");
    assert.deepEqual(proposal.newMembers?.map(member => member.email), ["noura.q@gmail.com"]);
    assert.deepEqual(proposal.unmatched, ["سارة الدوسري"]);
    assert.match(reply.text, /سارة الدوسري/);
    assert.equal(await f.valueOf(f.muneera.id, "phone"), "0509998877", "nothing changes before she approves");

    const applied = await f.approve(proposal.proposalId);
    assert.match(applied.text, /تم ✅/);
    assert.equal(await f.valueOf(f.muneera.id, "phone"), "0555443322");
    assert.equal(await f.valueOf(f.muneera.id, "national_id"), "1098765432");
    assert.equal((await f.profile(f.muneera.id)).find(field => field.label === "الدورات")?.value, "دورتان");
    assert.equal(await f.valueOf(f.fatimaDosari.id, "phone"), "0544332211");
    const noura = await f.accountByEmail("noura.q@gmail.com");
    assert.ok(noura);
    assert.equal(await f.valueOf(String(noura.id), "national_id"), "1122334455", "extra columns fill the new member's profile");
    assert.ok(applied.blocks.some(block => block.type === "table"));

    // Undo puts everything back and removes the new (never activated) account.
    const undoBlock = applied.blocks.find(block => block.type === "applied" && block.undoProposalId);
    assert.ok(undoBlock && undoBlock.type === "applied");
    await f.approve(undoBlock.undoProposalId!);
    assert.equal(await f.valueOf(f.muneera.id, "phone"), "0509998877");
    assert.equal((await f.profile(f.muneera.id)).some(field => field.label === "الدورات"), false);
    assert.equal(await f.accountByEmail("noura.q@gmail.com"), null);
  });

  test("the same roster with nothing new says so", async () => {
    f.newConversation();
    const id = await f.upload("كشف.xlsx", xlsxBuffer({ Sheet1: [["الاسم", "البريد", "الجوال"], ["رشا القرني", "rasha.member@example.com", "0551112233"]] }));
    const reply = await f.ask("", [id]) as Reply;
    assert.ok(!reply.blocks.some(block => block.type === "proposal"));
    assert.match(reply.text, /مطابقة/);
  });

  test("a school table with a member column becomes schools for each member (merged by name)", async () => {
    f.newConversation();
    const id = await f.upload("مدارس العنقود.xlsx", xlsxBuffer({ "المدارس": [
      ["م", "اسم المدرسة", "المرحلة", "عدد الطالبات", "عدد المعلمات", "التصنيف", "مديرة المدرسة", "اسم المشرفة", "ملاحظات"],
      [1, "الابتدائية ١٢٠", "ابتدائي", 450, 33, "تميز", "أ. هند", "رشا القرني", ""],
      [2, "الابتدائية ٤٤", "ابتدائي", "٣٠٠", 20, "تقدم", "", "رشا القرني", "مبنى جديد"],
      [3, "المتوسطة ٩", "متوسط", 280, 22, "انطلاق", "", "منيرة الرويلي", ""],
    ] }));
    const reply = await f.ask("", [id]) as Reply;
    const proposal = proposalOf(reply);
    assert.equal(proposal.changes.length, 3);
    assert.match(proposal.summary, /٣ مدارس/);
    const applied = await f.approve(proposal.proposalId);
    const schools = await schoolsOf(f.rasha.id);
    assert.equal(schools.length, 3, "two existing + one new");
    const merged = schools.find(school => school.name === "الابتدائية ١٢٠")!;
    assert.equal(merged.students, 450);
    assert.equal(merged.teachers, 33, "الهيئة التعليمية tile");
    assert.equal(merged.principal, "أ. هند", "the principal's leadership role");
    assert.equal(merged.area, "النزهة", "values the file does not mention are kept");
    const added = schools.find(school => school.name === "الابتدائية ٤٤")!;
    assert.equal(added.students, 300);
    assert.equal(added.tier, "تقدم");
    assert.equal(added.notes, "مبنى جديد");
    assert.deepEqual(added.madrasati, [0, 0, 0, 0, 0, 0], "new schools carry every required field");
    assert.deepEqual(added.staffTiles?.map(tile => tile.label), ["الهيئة التعليمية", "الهيئة الإدارية"], "new schools get main's default tiles");
    assert.equal((await schoolsOf(f.muneera.id))[0]?.name, "المتوسطة ٩");

    // Undo: the new schools disappear, the merged one gets its earlier numbers back.
    const undoBlock = applied.blocks.find(block => block.type === "applied" && block.undoProposalId);
    assert.ok(undoBlock && undoBlock.type === "applied");
    const undone = await f.approve(undoBlock.undoProposalId!);
    assert.match(undone.text, /رجّعت مدارس مشرفتين كما كانت/);
    const restored = await schoolsOf(f.rasha.id);
    assert.deepEqual(restored.map(school => school.name).sort(), ["الابتدائية ١٢٠", "المتوسطة ٣٣"].sort());
    assert.equal(restored.find(school => school.name === "الابتدائية ١٢٠")!.students, 420);
    assert.equal(restored.find(school => school.name === "الابتدائية ١٢٠")!.teachers, 31);
    assert.equal(restored.find(school => school.name === "الابتدائية ١٢٠")!.principal, "");
    assert.equal((await schoolsOf(f.muneera.id)).length, 0);
  });

  test("a school table for the member named in the message", async () => {
    f.newConversation();
    const id = await f.upload("حصر.xlsx", xlsxBuffer({ Sheet1: [["اسم المدرسة", "المرحلة", "عدد الطالبات"], ["الثانوية ١١", "ثانوي", 600]] }));
    const proposal = proposalOf(await f.ask("هذه مدارس مها", [id]) as Reply);
    assert.equal(proposal.changes[0].memberId, f.maha.id);
  });

  test("indicator columns (نافس، القدرات) land in main's evaluation indicators", async () => {
    f.newConversation();
    const id = await f.upload("نتائج.xlsx", xlsxBuffer({ Sheet1: [["اسم المدرسة", "نافس", "القدرات", "التحصيلي"], ["الثانوية ٧", "٧٢", 81, "غير متوفر"]] }));
    const proposal = proposalOf(await f.ask("هذه نتائج مدارس مها", [id]) as Reply);
    await f.approve(proposal.proposalId);
    const school = (await schoolsOf(f.maha.id)).find(item => item.name === "الثانوية ٧")!;
    assert.equal(school.nafes, "72");
    assert.equal(school.qudrat, 81);
    assert.equal(school.customFields?.find(field => field.label === "تحصيلي")?.value, "غير متوفر", "text that is not a percentage is kept as a custom field");
    const [row] = await f.sql`select imported_by from evaluation_indicators where school_id = ${school.id}`;
    assert.equal(row.importedBy, f.head.id);
  });

  test("a Word-like label:value form identifies the member, fills her profile and files the document", async () => {
    f.newConversation();
    const id = await f.upload("بيانات.txt", [
      "بيانات المشرفة",
      "الاسم: منال عبدالله إبراهيم المالكي",
      "رقم الجوال: 0501231234",
      "المؤهل: ماجستير",
      "التخصص: لغة عربية",
      "الدورات التدريبية: دورة القيادة",
    ].join("\n"));
    const reply = await f.ask("", [id]) as Reply;
    const proposal = proposalOf(reply);
    assert.ok(proposal.changes.every(change => change.memberId === f.manal.id));
    assert.ok(proposal.changes.some(change => change.fieldId === "phone" && change.after === "0501231234"));
    assert.ok(proposal.changes.some(change => change.fieldLabel === "الدورات التدريبية" && change.fieldId === null));
    assert.ok(proposal.changes.some(change => change.fieldLabel === "إضافة ملف إلى ملفها"));
    await f.approve(proposal.proposalId);
    assert.equal(await f.valueOf(f.manal.id, "qualification"), "ماجستير");
    assert.equal(await ownerOf(id), f.manal.id, "the document is now in her file");
  });

  test("a real .docx form: label:value paragraphs plus a two-column table", async () => {
    f.newConversation();
    const docx = docxBuffer(
      ["نموذج بيانات مشرفة", "الاسم: سهام محمد عبدالله السلمي", "المؤهل: ماجستير"],
      [["رقم الجوال", "0547778899"], ["الرتبة", "متقدم"], ["الدورات التدريبية", "التعلم النشط"]],
    );
    const id = await f.upload("نموذج سهام.docx", docx);
    assert.equal((await f.document(id))!.kind, "word");
    const proposal = proposalOf(await f.ask("", [id]) as Reply);
    const siham = f.members.find(member => member.email === "siham.member@example.com")!;
    const after = (fieldId: string) => proposal.changes.find(change => change.memberId === siham.id && change.fieldId === fieldId)?.after;
    assert.equal(after("qualification"), "ماجستير");
    assert.equal(after("phone"), "0547778899");
    assert.equal(after("rank"), "متقدم");
    assert.ok(proposal.changes.some(change => change.fieldLabel === "الدورات التدريبية"));
    await f.approve(proposal.proposalId);
    assert.equal(await ownerOf(id), siham.id);
    assert.equal(await f.valueOf(siham.id, "rank"), "متقدم");
  });

  test("a two-column form sheet is one member's form", async () => {
    f.newConversation();
    // (main seeds الرتبة with «ممارس», so the form sets another rank to be a change)
    const id = await f.upload("نموذج.xlsx", xlsxBuffer({ Sheet1: [["الاسم", "مريم حمد عايض الثبيتي"], ["رقم الجوال", "0567778888"], ["الرتبة", "خبير"]] }));
    const proposal = proposalOf(await f.ask("", [id]) as Reply);
    const maryam = f.members.find(member => member.email === "maryam.member@example.com")!;
    assert.ok(proposal.changes.some(change => change.memberId === maryam.id && change.fieldId === "rank" && change.after === "خبير"));
  });

  test("a file nobody can be matched to: «هذا الملف يخص من؟», then the answer files it", async () => {
    f.newConversation();
    const id = await f.upload("تقرير الأسبوع.txt", "تقرير أسبوعي عن زيارات المدارس\nتمت زيارة ثلاث مدارس وكانت النتائج جيدة");
    const asked = await f.ask("", [id]) as Reply;
    const question = choicesOf(asked);
    assert.ok(question?.prompt?.startsWith("هذا الملف يخص من؟"));
    assert.equal(question?.options.length, f.members.length);
    assert.equal(await ownerOf(id), null);

    const ambiguous = await f.ask("فاطمة") as Reply;
    assert.equal(choicesOf(ambiguous)?.options.length, 3, "an ambiguous answer narrows the choice instead of guessing");
    assert.equal(await ownerOf(id), null);

    const filed = await f.ask(choicesOf(ambiguous)!.options.find(option => option.label.includes("الدوسري"))!.message) as Reply;
    assert.equal(filed.intent, "import");
    assert.equal(await ownerOf(id), f.fatimaDosari.id);
    assert.match(filed.text, /حفظت «تقرير الأسبوع.txt» في ملف فاطمة الدوسري/);
    assert.ok(filed.blocks.some(block => block.type === "applied" && block.undoProposalId));

    // Afterwards the same name is an ordinary question again.
    const next = await f.ask("فاطمة الدوسري") as Reply;
    assert.equal(next.intent, "member");
  });

  test("a school list without an owner asks once, then fills the chosen member's schools", async () => {
    f.newConversation();
    const id = await f.upload("مدارس.xlsx", xlsxBuffer({ Sheet1: [["اسم المدرسة", "المرحلة", "عدد الطالبات"], ["الابتدائية ٧٠", "ابتدائي", 350]] }));
    const asked = await f.ask("", [id]) as Reply;
    assert.ok(choicesOf(asked)?.prompt?.startsWith("هذا الملف يخص من؟"));
    assert.doesNotMatch(asked.text, /لم أطابق/);
    const proposal = proposalOf(await f.ask("رشا") as Reply);
    assert.equal(proposal.changes[0].memberId, f.rasha.id);
  });

  test("an image is filed to the member named in the message, with a note about reading images", async () => {
    f.newConversation();
    const id = await f.upload("شهادة.png", Buffer.from("89504e470d0a1a0a", "hex"));
    const reply = await f.ask("هذه شهادة بدرية", [id]) as Reply;
    const badria = f.members.find(member => member.email === "badriya.member@example.com")!;
    assert.equal(await ownerOf(id), badria.id);
    assert.match(reply.text, /Claude/);
  });
});
