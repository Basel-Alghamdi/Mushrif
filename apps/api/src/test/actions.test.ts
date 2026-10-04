// Edit commands apply immediately with an undo; adding members; undo through chat and through the proposal route.
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { ChatBlock } from "@rasd/schemas";
import { setupFixture } from "./fixture.js";

type Fixture = Awaited<ReturnType<typeof setupFixture>>;
type Reply = { text: string; blocks: ChatBlock[]; intent?: string };
let f: Fixture;

const fieldOf = (account: { id: string }, fieldId: string) => {
  const member = f.accounts.findAccountById(account.id)!;
  return f.workspaces.getWorkspace(member).profile.find(field => field.id === fieldId)?.value ?? "";
};
const fieldByLabel = (account: { id: string }, label: string) => {
  const member = f.accounts.findAccountById(account.id)!;
  return f.workspaces.getWorkspace(member).profile.find(field => field.label === label);
};
const appliedOf = (reply: Reply) => reply.blocks.find((block): block is Extract<ChatBlock, { type: "applied" }> => block.type === "applied");
const byEmail = (email: string) => f.members.find(member => member.email === email)!;

describe("edit commands", () => {
  before(async () => { f = await setupFixture(); });

  test("غيري جوال رشا إلى … applies at once and offers an undo", async () => {
    f.newConversation();
    const reply = await f.ask("غيري جوال رشا إلى 0551234567") as Reply;
    assert.equal(reply.intent, "edit");
    assert.equal(fieldOf(f.rasha, "phone"), "0551234567");
    assert.equal(f.accounts.findAccountById(f.rasha.id)!.phone, "0551234567", "the account mirrors the profile");
    const applied = appliedOf(reply);
    assert.ok(applied?.undoProposalId);
    assert.match(reply.text, /كانت: 0551112233/);

    const undone = await f.ask("تراجعي") as Reply;
    assert.equal(undone.intent, "undo");
    assert.match(undone.text, /رجّعت «رقم الجوال» لـ رشا القرني كما كان: 0551112233/);
    assert.equal(fieldOf(f.rasha, "phone"), "0551112233");
    assert.equal(f.chat.getProposal(applied.undoProposalId!)!.status, "applied");
    assert.match((await f.ask("تراجعي") as Reply).text, /لا يوجد تعديل/);
  });

  test("صفة مها: … (colon form) updates the title and the account", async () => {
    const reply = await f.ask("صفة مها: عضو نواتج تعلم") as Reply;
    assert.equal(reply.intent, "edit");
    assert.equal(fieldOf(f.maha, "title"), "عضو نواتج تعلم");
    assert.equal(f.accounts.findAccountById(f.maha.id)!.title, "عضو نواتج تعلم");
  });

  test("a split qualifier targets the right field (ايميل … الوزاري ≠ login email)", async () => {
    await f.ask("حدثي ايميل منال الوزاري إلى m.malki@moe.gov.sa");
    assert.equal(fieldOf(f.manal, "moe_email"), "m.malki@moe.gov.sa");
    assert.equal(f.accounts.findAccountById(f.manal.id)!.email, "manal.member@example.com");
  });

  test("Arabic-Indic digits are stored as western digits", async () => {
    await f.ask("سجّلي رقم الهوية لجوهرة ١٠٢٣٤٥٦٧٨٩");
    assert.equal(fieldOf(byEmail("jawhara.member@example.com"), "national_id"), "1023456789");
    await f.ask("غيري جوال رشا إلى ٠٥٥١٢٣٠٠٠٠");
    assert.equal(fieldOf(f.rasha, "phone"), "0551230000");
  });

  test("a statement without a verb sets the value (مؤهل جوهرة بكالوريوس)", async () => {
    const reply = await f.ask("مؤهل جوهرة بكالوريوس") as Reply;
    assert.equal(reply.intent, "edit");
    assert.equal(fieldOf(byEmail("jawhara.member@example.com"), "qualification"), "بكالوريوس");
    // …but a question stays a question
    const question = await f.ask("مؤهل جوهرة؟") as Reply;
    assert.equal(question.intent, "member");
  });

  test("أضيفي حقل … creates a custom field", async () => {
    const reply = await f.ask("أضيفي حقل الدورات التدريبية لمنيرة قيمته ٥ دورات") as Reply;
    assert.equal(reply.intent, "add_field");
    assert.equal(fieldByLabel(f.muneera, "الدورات التدريبية")?.value, "٥ دورات");
    assert.equal(fieldByLabel(f.muneera, "الدورات التدريبية")?.custom, true);
    assert.ok(appliedOf(reply)?.undoProposalId);
  });

  test("an ambiguous name asks instead of editing", async () => {
    const before = f.members.filter(member => member.name.startsWith("هيفاء")).map(member => fieldOf(member, "phone"));
    const reply = await f.ask("غيري جوال هيفاء إلى 0501112222") as Reply;
    const options = reply.blocks.find(block => block.type === "choices");
    assert.ok(options && options.type === "choices" && options.options.length === 2);
    assert.ok(options.options.every(option => option.message.includes("0501112222")), "each option repeats the command with the full name");
    assert.deepEqual(f.members.filter(member => member.name.startsWith("هيفاء")).map(member => fieldOf(member, "phone")), before);
  });

  test("a follow-up edit uses the member discussed last (غيري جوالها …)", async () => {
    f.newConversation();
    await f.ask("ملف منيرة");
    await f.ask("غيري جوالها إلى 0500000000");
    assert.equal(fieldOf(f.muneera, "phone"), "0500000000");
  });

  test("امسحي clears a field", async () => {
    await f.ask("امسحي جوال منيرة");
    assert.equal(fieldOf(f.muneera, "phone"), "");
  });

  test("the derived years-of-experience field is explained, not edited", async () => {
    const reply = await f.ask("غيري سنوات الخبرة لرشا إلى 30") as Reply;
    assert.match(reply.text, /تُحسب تلقائياً/);
  });

  test("undo through the proposal route (the تراجع button) restores the value", async () => {
    f.newConversation();
    const reply = await f.ask("غيري تخصص منال إلى لغة عربية") as Reply;
    assert.equal(fieldOf(f.manal, "major"), "لغة عربية");
    const proposal = f.chat.getProposal(appliedOf(reply)!.undoProposalId!)!;
    assert.equal(proposal.kind, "undo");
    const result = await f.agent.applyProposal(f.head, proposal);
    assert.match(result.text, /تم التراجع/);
    assert.equal(fieldOf(f.manal, "major"), "");
  });
});

describe("adding a member from the chat", () => {
  test("creates the account and hands over a login message; undo removes it", async () => {
    f.newConversation();
    const reply = await f.ask("أضيفي عضوة اسمها نورة القحطاني وبريدها Noura.Q@gmail.com وصفتها عضو فريق تنفيذي") as Reply;
    assert.equal(reply.intent, "add_member");
    const found = f.accounts.findAccountByEmail("noura.q@gmail.com");
    assert.ok(found, "account created");
    assert.equal(found.account.name, "نورة القحطاني");
    assert.equal(found.account.title, "عضو فريق تنفيذي");
    assert.equal(found.account.activated, false);
    const copy = reply.blocks.find(block => block.type === "copy");
    assert.ok(copy && copy.type === "copy" && copy.text.includes("https://rasd.example") && copy.text.includes("noura.q@gmail.com") && copy.text.includes("أول مرة"));

    const again = await f.ask("أضيفي عضوة اسمها نورة القحطاني وبريدها noura.q@gmail.com") as Reply;
    assert.match(again.text, /مسجّل من قبل/);

    await f.ask("تراجعي");
    assert.equal(f.accounts.findAccountByEmail("noura.q@gmail.com"), null);
  });

  test("asks for the email when it is missing", async () => {
    const reply = await f.ask("أضيفي عضوة اسمها سارة الدوسري") as Reply;
    assert.match(reply.text, /بريد/);
    assert.equal(f.accounts.findAccountByEmail("sara@gmail.com"), null);
  });
});
