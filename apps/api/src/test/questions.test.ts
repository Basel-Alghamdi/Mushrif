// The local engine's question bank: dialect, typos, with/without "ال", Arabic-Indic digits and follow-ups,
// each checked against what the database actually holds.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { yearsSinceHijri, type ChatBlock } from "@rasd/schemas";
import { setupFixture, type Fixture } from "./fixture.js";

type Reply = { text: string; blocks: ChatBlock[]; intent?: string };
type Truth = Awaited<ReturnType<typeof loadTruth>>;

let f: Fixture;
let truth: Truth;

/** What the database actually holds, read through the same snapshot the agent answers from. */
async function loadTruth(fixture: Fixture) {
  const { ar, pct, appUrl } = await import("../agent/render.js");
  const team = await fixture.team();
  const byEmail = (email: string) => team.members.find(member => member.email === email)!;
  return { team, stats: team.stats, byEmail, detail: (id: string) => team.details.get(id)!, ar, pct, appUrl: appUrl(), yearsSince: (date: string) => yearsSinceHijri(date) };
}

const everything = (reply: Reply) => `${reply.text}\n${JSON.stringify(reply.blocks)}`;
const blockOf = <T extends ChatBlock["type"]>(reply: Reply, type: T) => reply.blocks.find((block): block is Extract<ChatBlock, { type: T }> => block.type === type);
const tableOf = (reply: Reply) => {
  const table = blockOf(reply, "table");
  assert.ok(table, `expected a table in: ${reply.text}`);
  return table;
};
const includes = (reply: Reply, ...parts: string[]) => {
  for (const part of parts) assert.ok(everything(reply).includes(part), `expected «${part}» in:\n${reply.text}`);
};
const excludes = (reply: Reply, ...parts: string[]) => {
  for (const part of parts) assert.ok(!everything(reply).includes(part), `did not expect «${part}» in:\n${reply.text}`);
};
const memberCard = (reply: Reply, email: string) => {
  const card = blockOf(reply, "member");
  assert.ok(card, `expected a member card in: ${reply.text}`);
  assert.equal(card.memberId, truth.byEmail(email).id);
};
const choiceMessages = (reply: Reply) => blockOf(reply, "choices")?.options.map(option => option.message) ?? [];

const RASHA = "rasha.member@example.com";
const MUNEERA = "munira.member@example.com";
const MAHA = "maha.member@example.com";
const MANAL = "manal.member@example.com";
const JAWHARA = "jawhara.member@example.com";
const FATIMA_ZAHRANI = "fatima1.member@example.com";
const BADRIA = "badriya.member@example.com";

type Case = { q: string; intent: string; check?: (reply: Reply) => void };

const CASES: Case[] = [
  // ---------- 1. greeting & help ----------
  { q: "مرحبا", intent: "social", check: reply => assert.ok(blockOf(reply, "choices")) },
  { q: "السلام عليكم", intent: "social", check: reply => excludes(reply, "قصدك مين") },
  { q: "هلا والله", intent: "social" },
  { q: "وش تقدرين تسوين؟", intent: "social", check: reply => includes(reply, "أقدر أساعدك") },
  { q: "ساعديني", intent: "social", check: reply => includes(reply, "أقدر أساعدك") },
  { q: "شكراً", intent: "social", check: reply => includes(reply, "العفو") },
  { q: "مين انتي", intent: "social", check: reply => includes(reply, "مساعد رَصد") },

  // ---------- 2. team overview ----------
  ...["الأرقام", "وش وضع الفريق", "ملخص الفريق", "عطيني احصائيات الفريق", "كيف الوضع؟", "ابي نظرة عامة", "ايش الوضع العام"].map((q): Case => ({
    q, intent: "overview",
    check: reply => {
      const stats = blockOf(reply, "stats");
      assert.ok(stats);
      assert.equal(stats.items.find(item => item.label === "المشرفات")?.value, truth.stats.members);
      assert.equal(stats.items.find(item => item.label === "المدارس")?.value, truth.stats.schools);
      includes(reply, truth.ar(truth.stats.members));
    },
  })),

  // ---------- 3. list members ----------
  ...["اعرضي المشرفات", "قائمة العضوات", "مين المشرفات؟"].map((q): Case => ({ q, intent: "list", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.members) })),
  { q: "عضوات نواتج التعلم", intent: "list", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => member.title.includes("نواتج")).length) },
  { q: "الأخصائيات", intent: "list", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => member.title.startsWith("أخصائية")).length) },
  { q: "أعضاء الفريق التنفيذي", intent: "list", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => member.title.includes("تنفيذي")).length) },

  // ---------- 4. member summary (fuzzy names, emails) ----------
  { q: "ملف رشا", intent: "member", check: reply => memberCard(reply, RASHA) },
  { q: "وش وضع منيرة", intent: "member", check: reply => memberCard(reply, MUNEERA) },
  { q: "عطيني بيانات مها", intent: "member", check: reply => memberCard(reply, MAHA) },
  { q: "رشا القرني", intent: "member", check: reply => memberCard(reply, RASHA) },
  { q: "الزهراني", intent: "member", check: reply => memberCard(reply, FATIMA_ZAHRANI) },
  { q: "زهراني", intent: "member", check: reply => memberCard(reply, FATIMA_ZAHRANI) },
  { q: "الشهرني", intent: "member", check: reply => memberCard(reply, JAWHARA) },
  { q: "ودي اشوف ملف بدرية", intent: "member", check: reply => memberCard(reply, BADRIA) },
  { q: "rasha.member", intent: "member", check: reply => memberCard(reply, RASHA) },
  { q: "maha.member@example.com", intent: "member", check: reply => memberCard(reply, MAHA) },
  { q: "ابي ملف منيره", intent: "member", check: reply => memberCard(reply, MUNEERA) },

  // ---------- 5. one field of one member ----------
  { q: "جوال رشا", intent: "member", check: reply => includes(reply, "0551112233") },
  { q: "ايميل منيرة", intent: "member", check: reply => includes(reply, MUNEERA) },
  { q: "وش صفة منال؟", intent: "member", check: reply => includes(reply, "عضو نواتج تعلم") },
  { q: "السجل المدني لرشا", intent: "member", check: reply => includes(reply, "1012345678") },
  { q: "الرقم الوظيفي لرشا", intent: "member", check: reply => includes(reply, "445566") },
  { q: "رقم رشا الوظيفي", intent: "member", check: reply => includes(reply, "445566") },
  { q: "رتبة منيره", intent: "member", check: reply => includes(reply, "خبير") },
  { q: "مؤهل مها", intent: "member", check: reply => includes(reply, "بكالوريوس") },
  { q: "تخصص رشا", intent: "member", check: reply => { includes(reply, "رياضيات"); excludes(reply, "إشراف تربوي"); } },
  { q: "تخصص رشا الإشرافي", intent: "member", check: reply => includes(reply, "إشراف تربوي — رياضيات") },
  { q: "تاريخ تعيين رشا", intent: "member", check: reply => includes(reply, "2010-09-01") },
  { q: "كم سنوات خبرة رشا", intent: "member", check: reply => includes(reply, `${truth.ar(Number(truth.yearsSince("2010-09-01")))} سنة`) },
  { q: "عنقود رشا", intent: "member", check: reply => includes(reply, "عنقود ٤") },
  { q: "البريد الوزاري لرشا", intent: "member", check: reply => includes(reply, "r.qarni@moe.gov.sa") },
  { q: "ايميل رشا الوزاري", intent: "member", check: reply => { includes(reply, "r.qarni@moe.gov.sa"); excludes(reply, RASHA); } },
  { q: "جوال جوهرة", intent: "member", check: reply => { includes(reply, "لم تعبّئ"); assert.ok(choiceMessages(reply).some(message => message.includes("تذكير"))); } },
  { q: "وش الدورات التدريبية لرشا", intent: "member", check: reply => includes(reply, "٣ دورات") },

  // ---------- per-member numbers ----------
  { q: "كم مدرسة عند رشا", intent: "member", check: reply => { includes(reply, "مدرستان", "الابتدائية ١٢٠"); tableOf(reply); } },
  { q: "كم طالبة عند مها", intent: "member", check: reply => includes(reply, truth.ar(510)) },
  { q: "زيارات رشا", intent: "member", check: reply => { includes(reply, "زيارة واحدة"); assert.equal(tableOf(reply).rows.length, 1); } },
  { q: "ملفات مها", intent: "documents", check: reply => includes(reply, "حصر المدارس.xlsx") },
  { q: "هل دخلت منال؟", intent: "member", check: reply => assert.match(reply.text, /^لا،/) },
  { q: "هل فعّلت رشا حسابها", intent: "member", check: reply => assert.match(reply.text, /^نعم،/) },
  { q: "آخر تحديث لملف مها", intent: "member", check: reply => includes(reply, "آخر تحديث") },

  // ---------- ambiguity: never guess between ties ----------
  ...["فاطمة", "فاطمه"].map((q): Case => ({
    q, intent: "member",
    check: reply => {
      const messages = choiceMessages(reply);
      assert.equal(messages.length, 3);
      for (const name of ["فاطمة ناصر علي الزهراني", "فاطمة سعيد محمد الجهني", "فاطمة عوض الدوسري"]) assert.ok(messages.includes(name), name);
      assert.ok(!blockOf(reply, "member"));
    },
  })),
  { q: "جوال هيفاء", intent: "member", check: reply => assert.deepEqual(choiceMessages(reply).sort(), ["جوال هيفاء حسن علي الأحمدي", "جوال هيفاء صالح محمد البلوي"].sort()) },
  { q: "ملف الحارثي", intent: "member", check: reply => assert.equal(choiceMessages(reply).length, 2) },
  { q: "هيفاء وش رتبتها؟", intent: "member", check: reply => { assert.equal(choiceMessages(reply).length, 2); assert.ok(choiceMessages(reply).every(message => message.includes("رتبتها"))); } },
  { q: "رسالة تذكير لفاطمة", intent: "messages", check: reply => { assert.equal(choiceMessages(reply).length, 3); assert.ok(!blockOf(reply, "copy")); } },

  // ---------- 6. filters ----------
  ...["مين ما فعّلت حسابها؟", "من لم تدخل", "مين اللي مادخلت", "مين ما سجلت دخول"].map((q): Case => ({
    q, intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.notActivated),
  })),
  { q: "من دخلت؟", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.activated) },
  { q: "من أكملت ملفها", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.completeProfiles) },
  // رشا ومها ومنيرة عبّأن ملفاتهن بأنفسهن اليوم (main: any work of her own counts as «حدّثت اليوم»).
  { q: "من أرسلت اليوم", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.submittedToday) },
  { q: "من أرسلت تحديثها اليوم؟", intent: "filter", check: reply => assert.deepEqual([...tableOf(reply).memberIds!].sort(), [RASHA, MAHA, MUNEERA].map(email => truth.byEmail(email).id).sort()) },
  { q: "رتبي المشرفات حسب المدارس", intent: "ranking", check: reply => assert.equal(tableOf(reply).memberIds?.[0], truth.byEmail(RASHA).id) },
  { q: "مين ما ارسلت", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.members - truth.stats.submittedToday) },
  { q: "من بدون مدارس", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => !member.schoolCount).length) },
  { q: "مين ما رفعت ملفات", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => !member.documentCount).length) },
  { q: "مين ما سجلت زيارات", intent: "filter", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => !member.visitCount).length) },
  { q: "من لم تعبئ السجل المدني", intent: "missing", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.members - 1) },
  { q: "مين ما عبت الجوال", intent: "missing", check: reply => assert.equal(tableOf(reply).rows.length, truth.stats.members - 2) },

  // ---------- 7. rankings ----------
  { q: "الأعلى اكتمالاً", intent: "ranking", check: reply => assert.equal(tableOf(reply).memberIds?.[0], truth.byEmail(RASHA).id) },
  { q: "الأقل اكتمال", intent: "ranking", check: reply => assert.notEqual(tableOf(reply).memberIds?.[0], truth.byEmail(RASHA).id) },
  { q: "أكثر مدارس", intent: "ranking", check: reply => { const table = tableOf(reply); assert.equal(table.rows.length, 2); assert.equal(table.memberIds?.[0], truth.byEmail(RASHA).id); excludes(reply, "(٠)"); } },
  { q: "أكثر وحدة عندها طالبات", intent: "ranking", check: reply => includes(reply, `رشا القرني (${truth.ar(800)})`) },
  { q: "رتبي حسب الزيارات", intent: "ranking", check: reply => assert.equal(tableOf(reply).rows.length, 2) },
  { q: "أعلى ٣ في الاكتمال", intent: "ranking", check: reply => assert.equal(tableOf(reply).rows.length, 3) },
  { q: "الأقل مدارس", intent: "ranking", check: reply => includes(reply, `${truth.ar(16)} مشرفة بلا مدارس`) },

  // ---------- schools across the team ----------
  { q: "مين عندها مدارس تصنيفها تميز؟", intent: "schools", check: reply => { assert.equal(tableOf(reply).rows.length, 1); includes(reply, "الابتدائية ١٢٠", "رشا القرني"); } },
  { q: "المدارس الثانوية", intent: "schools", check: reply => { assert.equal(tableOf(reply).rows.length, 1); includes(reply, "الثانوية ٧", "مها السبيعي"); } },
  { q: "المتوسطة ٣٣ لمين؟", intent: "schools", check: reply => includes(reply, "في ملف رشا القرني", "٣٨٠ طالبة") },

  // ---------- 8. counts & sums ----------
  { q: "كم عدد المشرفات", intent: "count", check: reply => includes(reply, `**${truth.ar(truth.stats.members)}**`) },
  { q: "كم مدرسة عندنا", intent: "count", check: reply => includes(reply, "٣ مدارس") },
  { q: "كم عدد المدراس", intent: "count", check: reply => includes(reply, "٣ مدارس") },
  { q: "كم عدد الطالبات", intent: "count", check: reply => includes(reply, truth.ar(truth.stats.students)) },
  { q: "كم معلمة", intent: "count", check: reply => includes(reply, truth.ar(truth.stats.teachers)) },
  { q: "عدد الزيارات", intent: "count", check: reply => includes(reply, "زيارتان") },
  { q: "كم ملف مرفوع", intent: "count", check: reply => includes(reply, "٣ ملفات") },
  { q: "متوسط الاكتمال", intent: "count", check: reply => includes(reply, truth.pct(truth.stats.averageCompletion)) },

  // ---------- 9. missing data ----------
  { q: "نواقص الفريق", intent: "missing", check: reply => assert.equal(tableOf(reply).rows.length, truth.team.members.filter(member => member.missing.length).length) },
  { q: "مين ملفها ناقص", intent: "missing", check: reply => tableOf(reply) },
  { q: "نواقص منيرة", intent: "missing", check: reply => { for (const item of truth.byEmail(MUNEERA).missing) includes(reply, item); } },
  { q: "وش ناقص مها؟", intent: "missing", check: reply => includes(reply, "رقم الجوال", "السجل المدني") },

  // ---------- 10. documents ----------
  { q: "الملفات المرفوعة", intent: "documents", check: reply => { assert.equal(blockOf(reply, "documents")?.items.length, 3); excludes(reply, "## "); } },
  { q: "ابحثي في الملفات عن نافس", intent: "search", check: reply => includes(reply, "خطة التحسين.txt", "اختبارات نافس") },
  { q: "دوري لي على كلمة القراءة", intent: "search", check: reply => includes(reply, "تقرير الزيارات.csv", "تحتاج دعماً في القراءة") },
  { q: "ابحثي في ملفات مها عن الثانوية", intent: "search", check: reply => { includes(reply, "حصر المدارس.xlsx"); excludes(reply, "خطة التحسين.txt"); } },
  { q: "وش في ملف خطة التحسين", intent: "documents", check: reply => includes(reply, "رفع نتائج نافس") },

  // ---------- 11. compare ----------
  { q: "قارني بين رشا ومها", intent: "compare", check: reply => assert.deepEqual(tableOf(reply).columns, ["البند", "رشا القرني", "مها السبيعي"]) },
  { q: "قارن رشا مع منيرة", intent: "compare", check: reply => assert.deepEqual(tableOf(reply).columns, ["البند", "رشا القرني", "منيرة الرويلي"]) },

  // ---------- one field for everyone ----------
  { q: "اعطيني جوالات المشرفات", intent: "team_field", check: reply => { assert.equal(tableOf(reply).rows.length, truth.stats.members); includes(reply, "0551112233", "0509998877"); } },
  { q: "ايميلات الفريق", intent: "team_field", check: reply => includes(reply, RASHA, MANAL) },

  // ---------- 13/14. messages & reports (read-only) ----------
  {
    q: "جهّزي رسائل الدخول", intent: "messages",
    check: reply => {
      const copies = reply.blocks.filter(block => block.type === "copy");
      assert.equal(copies.length, truth.stats.notActivated);
      includes(reply, truth.appUrl, "أول مرة اختاري كلمة مرور", MANAL);
      excludes(reply, RASHA);
    },
  },
  { q: "رسالة دخول لمنال", intent: "messages", check: reply => { assert.equal(reply.blocks.filter(block => block.type === "copy").length, 1); includes(reply, MANAL, truth.appUrl); } },
  { q: "ذكري منيرة", intent: "messages", check: reply => { const copy = blockOf(reply, "copy"); assert.ok(copy?.title.includes("منيرة")); includes(reply, "السجل المدني"); } },
  { q: "جهّزي رسالة تذكير", intent: "messages", check: reply => { assert.ok(blockOf(reply, "copy")?.title.includes("مجموعة")); excludes(reply, "تذكير — رشا"); } },
  { q: "جهّزي التقرير", intent: "report", check: reply => { assert.ok(blockOf(reply, "stats")); includes(reply, "تقرير متابعة", truth.pct(truth.stats.averageCompletion)); } },
  { q: "ابي تقرير عن رشا", intent: "report", check: reply => assert.ok(blockOf(reply, "copy")?.title.includes("رشا")) },

  // ---------- 16. fallback ----------
  { q: "ما هو لون السماء", intent: "fallback", check: reply => { assert.ok(blockOf(reply, "choices")); excludes(reply, "وجدت هذه الكلمات"); } },
];

describe("local engine question bank", () => {
  before(async () => {
    f = await setupFixture();
    truth = await loadTruth(f);
  });

  test("the bank is broad (at least 80 phrasings)", () => assert.ok(CASES.length >= 80, `${CASES.length} cases`));

  for (const item of CASES) {
    test(`«${item.q}» → ${item.intent}`, async () => {
      f.newConversation();
      const reply = await f.ask(item.q) as Reply;
      assert.equal(reply.intent, item.intent, `«${item.q}» answered by ${reply.intent}: ${reply.text}`);
      assert.ok(reply.text.trim(), "the reply has text");
      item.check?.(reply);
    });
  }
});

describe("follow-ups use the member discussed last", () => {
  test("ملف رشا → وجوالها؟ → وش ناقصها؟", async () => {
    f.newConversation();
    await f.ask("ملف رشا");
    includes(await f.ask("وجوالها؟"), "0551112233");
    const missing = await f.ask("وش ناقصها؟") as Reply;
    assert.equal(missing.intent, "missing");
    includes(missing, "رشا القرني", "مكتمل");
  });

  test("ملف مها → كم مدرسة عندها؟", async () => {
    f.newConversation();
    await f.ask("ملف مها");
    includes(await f.ask("كم مدرسة عندها؟"), "مها السبيعي", "مدرسة واحدة");
  });

  test("ملف منيرة → وايميلها", async () => {
    f.newConversation();
    await f.ask("ملف منيرة");
    includes(await f.ask("وايميلها"), MUNEERA);
  });

  test("an ambiguous name, then the chosen option, answers for that member", async () => {
    f.newConversation();
    const ask = await f.ask("جوال هيفاء") as Reply;
    const option = choiceMessages(ask).find(message => message.includes("الأحمدي"))!;
    const answer = await f.ask(option) as Reply;
    includes(answer, "هيفاء الأحمدي", "لم تعبّئ");
  });

  test("a team question after a member question is about the team", async () => {
    f.newConversation();
    await f.ask("ملف رشا");
    const reply = await f.ask("جهّزي رسائل الدخول") as Reply;
    assert.equal(reply.blocks.filter(block => block.type === "copy").length, truth.stats.notActivated);
  });

  test("«كم مشرفة فعلت حسابها؟» after a member card is about the team", async () => {
    f.newConversation();
    await f.ask("ملف منال");
    const reply = await f.ask("كم مشرفة فعلت حسابها؟") as Reply;
    assert.equal(reply.intent, "filter");
    assert.equal(tableOf(reply).rows.length, truth.stats.activated);
  });

  test("«جهّزي لهن رسالة تذكير» after a filtered list targets exactly that list", async () => {
    f.newConversation();
    const list = await f.ask("مين ما رفعت ملفات؟") as Reply;
    const listed = tableOf(list).memberIds!;
    const reply = await f.ask("جهّزي لهن رسالة تذكير") as Reply;
    const personal = reply.blocks.filter(block => block.type === "copy" && block.title.startsWith("تذكير"));
    assert.equal(personal.length, listed.length);
    includes(reply, "من القائمة السابقة");
  });

  test("رسالة تذكير لها after a member card is for her", async () => {
    f.newConversation();
    await f.ask("ملف مها");
    const reply = await f.ask("رسالة تذكير لها") as Reply;
    assert.equal(reply.blocks.filter(block => block.type === "copy").length, 1);
    assert.ok(blockOf(reply, "copy")?.title.includes("مها"));
  });
});

// One stack for the whole file (both describe blocks use it).
after(() => f?.stop());
