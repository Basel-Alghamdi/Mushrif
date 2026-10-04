// Files dropped into the chat: rosters, school tables, label:value documents, unknown owners.
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { ChatBlock } from "@rasd/schemas";
import { docxBuffer, setupFixture, xlsxBuffer } from "./fixture.js";

type Fixture = Awaited<ReturnType<typeof setupFixture>>;
type Reply = { text: string; blocks: ChatBlock[]; intent?: string };
type ProposalBlock = Extract<ChatBlock, { type: "proposal" }>;
let f: Fixture;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const upload = async (name: string, mime: string, buffer: Buffer) => (await f.documents.saveDocument({ ownerId: null, uploadedBy: f.head.id, name, mime, buffer })).id;
const proposalOf = (reply: Reply) => {
  const block = reply.blocks.find((item): item is ProposalBlock => item.type === "proposal");
  assert.ok(block, `expected a proposal in:\n${reply.text}`);
  assert.equal(block.status, "pending");
  return block;
};
const choicesOf = (reply: Reply) => reply.blocks.find((item): item is Extract<ChatBlock, { type: "choices" }> => item.type === "choices");
const approve = async (proposalId: string) => f.agent.applyProposal(f.head, f.chat.getProposal(proposalId)!);
const profileOf = (id: string) => f.workspaces.getWorkspace(f.accounts.findAccountById(id)!).profile;
const valueOf = (id: string, fieldId: string) => profileOf(id).find(field => field.id === fieldId)?.value ?? "";

describe("importing files in the chat", () => {
  before(async () => { f = await setupFixture(); });

  test("a roster spreadsheet: changed phones, an unknown header, a new person, an unusable row", async () => {
    f.newConversation();
    const id = await upload("كشف المشرفات.xlsx", XLSX_MIME, xlsxBuffer({ "ردود النموذج 1": [
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

    const applied = await approve(proposal.proposalId);
    assert.match(applied.text, /تم ✅/);
    assert.equal(valueOf(f.muneera.id, "phone"), "0555443322");
    assert.equal(valueOf(f.muneera.id, "national_id"), "1098765432");
    assert.equal(profileOf(f.muneera.id).find(field => field.label === "الدورات")?.value, "دورتان");
    assert.equal(valueOf(f.fatimaDosari.id, "phone"), "0544332211");
    const noura = f.accounts.findAccountByEmail("noura.q@gmail.com");
    assert.ok(noura);
    assert.equal(valueOf(noura.account.id, "national_id"), "1122334455", "extra columns fill the new member's profile");
    assert.ok(applied.blocks.some(block => block.type === "table"));

    // Undo puts everything back and removes the new (never activated) account.
    const undoId = applied.blocks.find(block => block.type === "applied" && block.undoProposalId);
    assert.ok(undoId && undoId.type === "applied");
    await approve(undoId.undoProposalId!);
    assert.equal(valueOf(f.muneera.id, "phone"), "0509998877");
    assert.equal(profileOf(f.muneera.id).some(field => field.label === "الدورات"), false);
    assert.equal(f.accounts.findAccountByEmail("noura.q@gmail.com"), null);
  });

  test("the same roster with nothing new says so", async () => {
    f.newConversation();
    const id = await upload("كشف.xlsx", XLSX_MIME, xlsxBuffer({ Sheet1: [["الاسم", "البريد", "الجوال"], ["رشا القرني", "rasha.member@example.com", "0551112233"]] }));
    const reply = await f.ask("", [id]) as Reply;
    assert.ok(!reply.blocks.some(block => block.type === "proposal"));
    assert.match(reply.text, /مطابقة/);
  });

  test("a school table with a member column becomes schools for each member (merged by name)", async () => {
    f.newConversation();
    const id = await upload("مدارس العنقود.xlsx", XLSX_MIME, xlsxBuffer({ "المدارس": [
      ["م", "اسم المدرسة", "المرحلة", "عدد الطالبات", "عدد المعلمات", "التصنيف", "مديرة المدرسة", "اسم المشرفة", "ملاحظات"],
      [1, "الابتدائية ١٢٠", "ابتدائي", 450, 33, "تميز", "أ. هند", "رشا القرني", ""],
      [2, "الابتدائية ٤٤", "ابتدائي", "٣٠٠", 20, "تقدم", "", "رشا القرني", "مبنى جديد"],
      [3, "المتوسطة ٩", "متوسط", 280, 22, "انطلاق", "", "منيرة الرويلي", ""],
    ] }));
    const reply = await f.ask("", [id]) as Reply;
    const proposal = proposalOf(reply);
    assert.equal(proposal.changes.length, 3);
    assert.match(proposal.summary, /٣ مدارس/);
    await approve(proposal.proposalId);
    const schools = f.workspaces.getWorkspace(f.accounts.findAccountById(f.rasha.id)!).schools;
    assert.equal(schools.length, 3, "two existing + one new");
    const merged = schools.find(school => school.name === "الابتدائية ١٢٠")!;
    assert.equal(merged.students, 450);
    assert.equal(merged.principal, "أ. هند");
    const added = schools.find(school => school.name === "الابتدائية ٤٤")!;
    assert.equal(added.students, 300);
    assert.equal(added.notes, "مبنى جديد");
    assert.deepEqual(added.madrasati, [0, 0, 0, 0, 0, 0], "new schools carry every required field");
    assert.equal(f.workspaces.getWorkspace(f.accounts.findAccountById(f.muneera.id)!).schools[0]?.name, "المتوسطة ٩");
  });

  test("a school table for the member named in the message", async () => {
    f.newConversation();
    const id = await upload("حصر.xlsx", XLSX_MIME, xlsxBuffer({ Sheet1: [["اسم المدرسة", "المرحلة", "عدد الطالبات"], ["الثانوية ١١", "ثانوي", 600]] }));
    const proposal = proposalOf(await f.ask("هذه مدارس مها", [id]) as Reply);
    assert.equal(proposal.changes[0].memberId, f.maha.id);
  });

  test("a Word-like label:value form identifies the member, fills her profile and files the document", async () => {
    f.newConversation();
    const id = await upload("بيانات.txt", "text/plain", Buffer.from([
      "بيانات المشرفة",
      "الاسم: منال عبدالله إبراهيم المالكي",
      "رقم الجوال: 0501231234",
      "المؤهل: ماجستير",
      "التخصص: لغة عربية",
      "الدورات التدريبية: دورة القيادة",
    ].join("\n"), "utf8"));
    const reply = await f.ask("", [id]) as Reply;
    const proposal = proposalOf(reply);
    assert.ok(proposal.changes.every(change => change.memberId === f.manal.id));
    assert.ok(proposal.changes.some(change => change.fieldId === "phone" && change.after === "0501231234"));
    assert.ok(proposal.changes.some(change => change.fieldLabel === "الدورات التدريبية" && change.fieldId === null));
    assert.ok(proposal.changes.some(change => change.fieldLabel === "إضافة ملف إلى ملفها"));
    await approve(proposal.proposalId);
    assert.equal(valueOf(f.manal.id, "qualification"), "ماجستير");
    assert.equal(f.documents.getDocument(id)!.ownerId, f.manal.id, "the document is now in her file");
  });

  test("a real .docx form: label:value paragraphs plus a two-column table", async () => {
    f.newConversation();
    const docx = docxBuffer(
      ["نموذج بيانات مشرفة", "الاسم: سهام محمد عبدالله السلمي", "المؤهل: ماجستير"],
      [["رقم الجوال", "0547778899"], ["الرتبة", "متقدم"], ["الدورات التدريبية", "التعلم النشط"]],
    );
    const id = await upload("نموذج سهام.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx);
    assert.equal(f.documents.getDocument(id)!.kind, "word");
    const proposal = proposalOf(await f.ask("", [id]) as Reply);
    const siham = f.members.find(member => member.email === "siham.member@example.com")!;
    const after = (fieldId: string) => proposal.changes.find(change => change.memberId === siham.id && change.fieldId === fieldId)?.after;
    assert.equal(after("qualification"), "ماجستير");
    assert.equal(after("phone"), "0547778899");
    assert.equal(after("rank"), "متقدم");
    assert.ok(proposal.changes.some(change => change.fieldLabel === "الدورات التدريبية"));
    await approve(proposal.proposalId);
    assert.equal(f.documents.getDocument(id)!.ownerId, siham.id);
    assert.equal(valueOf(siham.id, "rank"), "متقدم");
  });

  test("a two-column form sheet is one member's form", async () => {
    f.newConversation();
    const id = await upload("نموذج.xlsx", XLSX_MIME, xlsxBuffer({ Sheet1: [["الاسم", "مريم حمد عايض الثبيتي"], ["رقم الجوال", "0567778888"], ["الرتبة", "ممارس"]] }));
    const proposal = proposalOf(await f.ask("", [id]) as Reply);
    const maryam = f.members.find(member => member.email === "maryam.member@example.com")!;
    assert.ok(proposal.changes.some(change => change.memberId === maryam.id && change.fieldId === "rank" && change.after === "ممارس"));
  });

  test("a file nobody can be matched to: «هذا الملف يخص من؟», then the answer files it", async () => {
    f.newConversation();
    const id = await upload("تقرير الأسبوع.txt", "text/plain", Buffer.from("تقرير أسبوعي عن زيارات المدارس\nتمت زيارة ثلاث مدارس وكانت النتائج جيدة", "utf8"));
    const asked = await f.ask("", [id]) as Reply;
    const question = choicesOf(asked);
    assert.ok(question?.prompt?.startsWith("هذا الملف يخص من؟"));
    assert.equal(question?.options.length, f.members.length);
    assert.equal(f.documents.getDocument(id)!.ownerId, null);

    const ambiguous = await f.ask("فاطمة") as Reply;
    assert.equal(choicesOf(ambiguous)?.options.length, 3, "an ambiguous answer narrows the choice instead of guessing");
    assert.equal(f.documents.getDocument(id)!.ownerId, null);

    const filed = await f.ask(choicesOf(ambiguous)!.options.find(option => option.label.includes("الدوسري"))!.message) as Reply;
    assert.equal(filed.intent, "import");
    assert.equal(f.documents.getDocument(id)!.ownerId, f.fatimaDosari.id);
    assert.match(filed.text, /حفظت «تقرير الأسبوع.txt» في ملف فاطمة الدوسري/);
    assert.ok(filed.blocks.some(block => block.type === "applied" && block.undoProposalId));

    // Afterwards the same name is an ordinary question again.
    const next = await f.ask("فاطمة الدوسري") as Reply;
    assert.equal(next.intent, "member");
  });

  test("a school list without an owner asks once, then fills the chosen member's schools", async () => {
    f.newConversation();
    const id = await upload("مدارس.xlsx", XLSX_MIME, xlsxBuffer({ Sheet1: [["اسم المدرسة", "المرحلة", "عدد الطالبات"], ["الابتدائية ٧٠", "ابتدائي", 350]] }));
    const asked = await f.ask("", [id]) as Reply;
    assert.ok(choicesOf(asked)?.prompt?.startsWith("هذا الملف يخص من؟"));
    assert.doesNotMatch(asked.text, /لم أطابق/);
    const proposal = proposalOf(await f.ask("رشا") as Reply);
    assert.equal(proposal.changes[0].memberId, f.rasha.id);
  });

  test("an image is filed to the member named in the message, with a note about reading images", async () => {
    f.newConversation();
    const id = await upload("شهادة.png", "image/png", Buffer.from("89504e470d0a1a0a", "hex"));
    const reply = await f.ask("هذه شهادة بدرية", [id]) as Reply;
    const badria = f.members.find(member => member.email === "badriya.member@example.com")!;
    assert.equal(f.documents.getDocument(id)!.ownerId, badria.id);
    assert.match(reply.text, /Claude/);
  });
});
