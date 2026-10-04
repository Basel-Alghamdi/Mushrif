// Edit commands apply immediately with an undo; adding members; undo through chat and through the proposal route.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatBlock } from "@rasd/schemas";
import { setupFixture, type Fixture, type TeamMember } from "./fixture.js";

type Reply = { text: string; blocks: ChatBlock[]; intent?: string };
let f: Fixture;

const fieldOf = (member: { id: string }, fieldId: string) => f.valueOf(member.id, fieldId);
const fieldByLabel = async (member: { id: string }, label: string) => (await f.profile(member.id)).find(field => field.label === label);
const appliedOf = (reply: Reply) => reply.blocks.find((block): block is Extract<ChatBlock, { type: "applied" }> => block.type === "applied");
const byEmail = (email: string): TeamMember => f.members.find(member => member.email === email)!;

before(async () => { f = await setupFixture(); });
after(() => f?.stop());

describe("edit commands", () => {
  test("غيري جوال رشا إلى … applies at once and offers an undo", async () => {
    f.newConversation();
    const reply = await f.ask("غيري جوال رشا إلى 0551234567") as Reply;
    assert.equal(reply.intent, "edit");
    assert.equal(await fieldOf(f.rasha, "phone"), "0551234567");
    assert.equal((await f.account(f.rasha.id)).phone, "0551234567", "the account mirrors the profile");
    const applied = appliedOf(reply);
    assert.ok(applied?.undoProposalId);
    assert.match(reply.text, /كانت: 0551112233/);
    const [audit] = await f.sql`select actor_id, source, cluster_id from audit_log where entity = 'profile_field' and after = to_jsonb('0551234567'::text) order by at desc limit 1`;
    assert.deepEqual([audit.actorId, audit.source, audit.clusterId], [f.head.id, "agent", f.rasha.clusterId], "audited as the head, source agent, in her cluster");

    const undone = await f.ask("تراجعي") as Reply;
    assert.equal(undone.intent, "undo");
    assert.match(undone.text, /رجّعت «رقم الجوال» لـ رشا القرني كما كان: 0551112233/);
    assert.equal(await fieldOf(f.rasha, "phone"), "0551112233");
    assert.equal((await f.chat.getProposal(f.sql, applied.undoProposalId!))!.status, "applied");
    assert.match((await f.ask("تراجعي") as Reply).text, /لا يوجد تعديل/);
  });

  test("the head's and the agent's changes do not count as the member's own activity", async () => {
    const before = (await f.detail(f.manal.id)).lastActivityAt;
    await f.ask("غيري تخصص منال إلى كيمياء");
    const detail = await f.detail(f.manal.id);
    assert.equal(detail.lastActivityAt, before);
    assert.equal(detail.submittedToday, false);
    assert.ok(detail.workspace.updatedAt, "…but her file shows when it last changed");
    await f.ask("تراجعي");
  });

  test("answers that show a member's personal data are audited like the head's detail view (read_pii)", async () => {
    const jawhara = byEmail("jawhara.member@example.com");
    const reads = async () => Number((await f.sql`
      select count(*)::int as n from audit_log
      where action = 'read_pii' and cluster_id = ${jawhara.clusterId} and actor_id = ${f.head.id} and source = 'agent'`)[0].n);
    const before = await reads();
    await f.ask("جوال جوهرة");
    assert.equal(await reads(), before + 1);
    await f.ask("كم عدد المشرفات");
    await f.ask("المدارس الثانوية");
    assert.equal(await reads(), before + 1, "team numbers and school lists read no one's personal data");
    assert.equal((await f.detail(jawhara.id)).workspace.updatedAt, null, "a read is not a change to her file");
  });

  test("صفة مها: … (colon form) updates the title and the account", async () => {
    const reply = await f.ask("صفة مها: عضو نواتج تعلم") as Reply;
    assert.equal(reply.intent, "edit");
    assert.equal(await fieldOf(f.maha, "title"), "عضو نواتج تعلم");
    assert.equal((await f.account(f.maha.id)).title, "عضو نواتج تعلم");
  });

  test("a split qualifier targets the right field (ايميل … الوزاري ≠ login email)", async () => {
    await f.ask("حدثي ايميل منال الوزاري إلى m.malki@moe.gov.sa");
    assert.equal(await fieldOf(f.manal, "moe_email"), "m.malki@moe.gov.sa");
    assert.equal((await f.account(f.manal.id)).email, "manal.member@example.com");
  });

  test("Arabic-Indic digits are stored as western digits", async () => {
    await f.ask("سجّلي رقم الهوية لجوهرة ١٠٢٣٤٥٦٧٨٩");
    assert.equal(await fieldOf(byEmail("jawhara.member@example.com"), "national_id"), "1023456789");
    await f.ask("غيري جوال رشا إلى ٠٥٥١٢٣٠٠٠٠");
    assert.equal(await fieldOf(f.rasha, "phone"), "0551230000");
  });

  test("a statement without a verb sets the value (مؤهل جوهرة بكالوريوس)", async () => {
    const reply = await f.ask("مؤهل جوهرة بكالوريوس") as Reply;
    assert.equal(reply.intent, "edit");
    assert.equal(await fieldOf(byEmail("jawhara.member@example.com"), "qualification"), "بكالوريوس");
    // …but a question stays a question
    const question = await f.ask("مؤهل جوهرة؟") as Reply;
    assert.equal(question.intent, "member");
  });

  test("أضيفي حقل … creates a custom field", async () => {
    const reply = await f.ask("أضيفي حقل الدورات التدريبية لمنيرة قيمته ٥ دورات") as Reply;
    assert.equal(reply.intent, "add_field");
    assert.equal((await fieldByLabel(f.muneera, "الدورات التدريبية"))?.value, "٥ دورات");
    assert.equal((await fieldByLabel(f.muneera, "الدورات التدريبية"))?.custom, true);
    assert.ok(appliedOf(reply)?.undoProposalId);
    const undone = await f.ask("تراجعي") as Reply;
    assert.match(undone.text, /أزلت حقل «الدورات التدريبية» من ملف منيرة الرويلي/);
    assert.equal(await fieldByLabel(f.muneera, "الدورات التدريبية"), undefined);
  });

  test("the cluster label and the login email are changed where main keeps them", async () => {
    f.newConversation();
    await f.ask("غيري عنقود منال إلى عنقود ٧");
    assert.equal((await f.detail(f.manal.id)).clusterLabel, "عنقود ٧");
    await f.ask("غيري بريد منال إلى Manal.New@gmail.com");
    assert.equal((await f.account(f.manal.id)).email, "manal.new@gmail.com");
    const [user] = await f.sql`select email from auth.users where id = ${f.manal.id}`;
    assert.equal(user.email, "manal.new@gmail.com", "her sign-in moved too");
    await f.ask("تراجعي");
    assert.equal((await f.account(f.manal.id)).email, "manal.member@example.com");
  });

  test("an ambiguous name asks instead of editing", async () => {
    const haifas = f.members.filter(member => member.name.startsWith("هيفاء"));
    const before = await Promise.all(haifas.map(member => fieldOf(member, "phone")));
    const reply = await f.ask("غيري جوال هيفاء إلى 0501112222") as Reply;
    const options = reply.blocks.find(block => block.type === "choices");
    assert.ok(options && options.type === "choices" && options.options.length === 2);
    assert.ok(options.options.every(option => option.message.includes("0501112222")), "each option repeats the command with the full name");
    assert.deepEqual(await Promise.all(haifas.map(member => fieldOf(member, "phone"))), before);
  });

  test("a follow-up edit uses the member discussed last (غيري جوالها …)", async () => {
    f.newConversation();
    await f.ask("ملف منيرة");
    await f.ask("غيري جوالها إلى 0500000000");
    assert.equal(await fieldOf(f.muneera, "phone"), "0500000000");
  });

  test("امسحي clears a field", async () => {
    await f.ask("امسحي جوال منيرة");
    assert.equal(await fieldOf(f.muneera, "phone"), "");
  });

  test("the derived years-of-experience field is explained, not edited", async () => {
    const reply = await f.ask("غيري سنوات الخبرة لرشا إلى 30") as Reply;
    assert.match(reply.text, /تُحسب تلقائياً/);
  });

  test("undo through the proposal route (the تراجع button) restores the value", async () => {
    f.newConversation();
    const reply = await f.ask("غيري تخصص منال إلى لغة عربية") as Reply;
    assert.equal(await fieldOf(f.manal, "major"), "لغة عربية");
    const proposal = (await f.chat.getProposal(f.sql, appliedOf(reply)!.undoProposalId!))!;
    assert.equal(proposal.kind, "undo");
    const result = await f.approve(proposal.id);
    assert.match(result.text, /تم التراجع/);
    assert.equal(await fieldOf(f.manal, "major"), "");
  });
});

describe("adding a member from the chat", () => {
  test("creates the account and hands over a login message; undo removes it", async () => {
    f.newConversation();
    const reply = await f.ask("أضيفي عضوة اسمها نورة القحطاني وبريدها Noura.Q@gmail.com وصفتها عضو فريق تنفيذي") as Reply;
    assert.equal(reply.intent, "add_member");
    const found = await f.accountByEmail("noura.q@gmail.com");
    assert.ok(found, "account created");
    assert.equal(found.name, "نورة القحطاني");
    assert.equal(found.title, "عضو فريق تنفيذي");
    assert.equal(found.activatedAt, null, "she chooses her password at first sign-in");
    assert.equal(await f.valueOf(String(found.id), "title"), "عضو فريق تنفيذي", "الصفة is in her file too");
    const { appUrl } = await import("../agent/render.js");
    const copy = reply.blocks.find(block => block.type === "copy");
    assert.ok(copy && copy.type === "copy" && copy.text.includes(appUrl()) && copy.text.includes("noura.q@gmail.com") && copy.text.includes("أول مرة"));

    const again = await f.ask("أضيفي عضوة اسمها نورة القحطاني وبريدها noura.q@gmail.com") as Reply;
    assert.match(again.text, /مسجّل من قبل/);

    await f.ask("تراجعي");
    assert.equal(await f.accountByEmail("noura.q@gmail.com"), null);
    assert.equal((await f.sql`select id from auth.users where email = 'noura.q@gmail.com'`).length, 0, "the sign-in account is gone too");
  });

  test("asks for the email when it is missing", async () => {
    const reply = await f.ask("أضيفي عضوة اسمها سارة الدوسري") as Reply;
    assert.match(reply.text, /بريد/);
    assert.equal(await f.accountByEmail("sara@gmail.com"), null);
  });
});
