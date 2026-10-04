// The built-in Arabic engine: answers Khulood's questions from the database without any API key.
import type { ChatBlock, MemberDetail, MemberSummary } from "@rasd/schemas";
import { riyadhDay } from "../db.js";
import {
  builtInField, FILTER_LABELS, filterMembers, findDocumentByName, membersMissingField, metricValue, profileField, profileFieldByLabel, searchDocuments, searchPhrase,
  searchVisits, updatedToday, type MemberFilter,
} from "./data.js";
import { askWhich, buildContext, has, metric, negated, reply, smallNumber, spanOf, words, type Ctx, type EngineInput } from "./engine-context.js";
import { METRIC_LABELS, phrases, TITLE_FILTERS, W, type MetricId } from "./lexicon.js";
import { addCustomField, addMember, deleteMemberHelp, editCommand, implicitEdit, messages, report, undoLast } from "./local-actions.js";
import { normalizeArabic, normalizeText } from "./normalize.js";
import { describeSchool, type AgentReply } from "./proposals.js";
import {
  activationLabel, ar, choices, cleanExcerpt, completionTone, count, countAcc, countGen, dayLabel, documentsBlock, firstName, listText, memberBlock, membersTable, NOUNS, pct,
  relativeTime, shortName, statsBlock,
} from "./render.js";

export type { EngineInput } from "./engine-context.js";

const mention = (member: { name: string }) => shortName(member.name);
/** "المدارس" → "مدارس" (for "لا توجد مدارس …"). */
const indefinite = (label: string) => label.replace(/^ال/, "");

// ---------- Greeting & help ----------
function starterChoices(ctx: Ctx) {
  const someone = ctx.team.members[0];
  return choices([
    { label: "أرقام الفريق" },
    { label: "مين ما فعّلت حسابها؟" },
    { label: "نواقص الفريق" },
    { label: "جهّزي رسائل الدخول" },
    ...(someone ? [{ label: `ملف ${mention(someone)}`, message: `ملف ${someone.name}` }] : []),
    { label: "جهّزي التقرير" },
  ]);
}

const HELP_TEXT = [
  "أقدر أساعدك في:",
  "- **الأرقام**: «أرقام الفريق»، «كم عدد المدارس؟»، «متوسط الاكتمال»",
  "- **أي مشرفة**: «ملف رشا»، «جوال منيرة»، «وش ناقص مها؟»",
  "- **المتابعة**: «مين ما فعّلت حسابها؟»، «الأقل اكتمالاً»، «مين بدون مدارس؟»",
  "- **الملفات**: «ابحثي في الملفات عن خطة»، أو ارفعي ملف إكسل/وورد/PDF وأنا أعبّي بياناته في ملفات المشرفات",
  "- **التعديل**: «غيري جوال رشا إلى 0551234567»، «أضيفي عضوة اسمها … وبريدها …»",
  "- **الرسائل والتقارير**: «جهّزي رسائل الدخول»، «جهّزي رسالة تذكير»، «جهّزي التقرير»",
].join("\n");

function social(ctx: Ctx): AgentReply | null {
  if (has(ctx, W.whoAmI)) return reply(`أنا مساعد رَصد — أقرأ كل ما ترسله المشرفات وأجيبك عنه بالأرقام.\n\n${HELP_TEXT}`, starterChoices(ctx));
  if (has(ctx, W.help)) return reply(HELP_TEXT, starterChoices(ctx));
  if (has(ctx, W.thanks) && words(ctx).length <= 5) return reply("العفو يا خلود، في الخدمة دائماً. تحتاجين شيئاً آخر؟", choices([{ label: "أرقام الفريق" }, { label: "نواقص الفريق" }]));
  if (has(ctx, W.greet) && words(ctx).length <= 6) return greeting(ctx);
  return null;
}

function greeting(ctx: Ctx): AgentReply {
  const { stats } = ctx.team;
  const status = `الآن: ${count(stats.members, NOUNS.member)}، فعّلت ${ar(stats.activated)} منهن حساباتهن، ومتوسط اكتمال الملفات ${pct(stats.averageCompletion)}.`;
  return reply(
    `أهلاً خلود 👋 أنا مساعدك في رَصد. اسأليني عن أي مشرفة أو عن أرقام الفريق، وأقدر أعدّل البيانات بطلبك، وإذا رفعتِ ملفاً أقرأه وأعبّي بياناته في ملفات المشرفات.\n\n${status}`,
    starterChoices(ctx),
  );
}

// ---------- Team overview ----------
function overviewText(ctx: Ctx) {
  const { stats, members } = ctx.team;
  const best = [...members].sort((a, b) => b.completion - a.completion)[0];
  const work = [
    stats.visits ? `سجّلن ${countAcc(stats.visits, NOUNS.visit)}` : "",
    stats.documents ? `رفعن ${countAcc(stats.documents, NOUNS.file)}` : "",
  ].filter(Boolean);
  const lines = [
    `عندك ${count(stats.members, NOUNS.member)}: ${stats.activated ? `فعّلت ${ar(stats.activated)} منهن حساباتهن` : "لم تفعّل أي واحدة حسابها بعد"}${stats.notActivated && stats.activated ? `، و${ar(stats.notActivated)} لم يدخلن بعد` : ""}.`,
    `متوسط اكتمال الملفات ${pct(stats.averageCompletion)}${best && best.completion > 0 ? `، وأعلى ملف لـ ${mention(best)} (${pct(best.completion)})` : ""}.`,
    stats.schools ? `سُجّلت ${count(stats.schools, NOUNS.school)} تضم ${count(stats.students, NOUNS.student)} و${count(stats.teachers, NOUNS.teacher)}.` : "لم تُسجَّل أي مدرسة بعد.",
    work.length ? `و${work.join(" و")}.` : "",
  ];
  return lines.filter(Boolean).join(" ");
}

function overview(ctx: Ctx): AgentReply | null {
  if (!has(ctx, W.overview)) return null;
  const follow = [
    ctx.team.stats.notActivated ? { label: "مين ما فعّلت حسابها؟" } : null,
    { label: "نواقص الفريق" },
    { label: "الأعلى اكتمالاً" },
    { label: "جهّزي التقرير" },
  ].filter((item): item is { label: string } => Boolean(item));
  return reply(overviewText(ctx), statsBlock(ctx.team.stats), choices(follow));
}

// ---------- Members list ----------
const LIST_CUES = phrases(["المشرفات", "العضوات", "الفريق", "أعضاء", "الاعضاء", "عضوات", "مشرفات"]);

function listMembers(ctx: Ctx): AgentReply | null {
  const title = TITLE_FILTERS.find(item => spanOf(ctx, [item.phrase]));
  if (!has(ctx, W.list) && !title && !has(ctx, LIST_CUES)) return null;
  if (title) {
    const members = ctx.team.members.filter(member => normalizeArabic(member.title).includes(title.match));
    if (!members.length) return reply(`لا يوجد في الفريق أحد بصفة تحتوي «${title.match}».`);
    return reply(`${title.label} (${ar(members.length)}):`, membersTable(members));
  }
  return reply(`فريقك ${count(ctx.team.members.length, NOUNS.member)} — اضغطي على أي اسم لفتح ملفها:`, membersTable(ctx.team.members), choices([{ label: "أرقام الفريق" }, { label: "نواقص الفريق" }]));
}

// ---------- One member ----------
const METRIC_RANK_LABEL: Partial<Record<MetricId, string>> = {
  completion: "اكتمالاً", schools: "مدارس", students: "طالبات", teachers: "معلمات", visits: "زيارات", documents: "ملفات مرفوعة", missing: "نواقص", programs: "برامج",
};

function memberChoices(member: MemberSummary) {
  const options = [
    member.missing.length ? { label: `نواقص ${mention(member)}`, message: `نواقص ${member.name}` } : null,
    member.schoolCount ? { label: `مدارس ${mention(member)}`, message: `مدارس ${member.name}` } : null,
    member.documentCount ? { label: `ملفات ${mention(member)}`, message: `ملفات ${member.name}` } : null,
    !member.activated ? { label: "رسالة دخول لها", message: `جهّزي رسالة دخول لـ ${member.name}` } : member.completion < 100 ? { label: "رسالة تذكير لها", message: `جهّزي رسالة تذكير لـ ${member.name}` } : null,
  ].filter((item): item is { label: string; message: string } => Boolean(item));
  return options.length ? choices(options) : null;
}

function summaryOf(detail: MemberDetail): AgentReply {
  const activation = !detail.activated ? "لم تفعّل حسابها بعد" : detail.lastLoginAt ? `فعّلت حسابها (آخر دخول ${relativeTime(detail.lastLoginAt)})` : "فعّلت حسابها";
  const missing = detail.missing.length ? `، وينقصها: ${listText(detail.missing, 5)}` : " — ملفها مكتمل";
  const work = [
    detail.schoolCount ? count(detail.schoolCount, NOUNS.school) : "",
    detail.visitCount ? count(detail.visitCount, NOUNS.visit) : "",
    detail.documentCount ? count(detail.documentCount, NOUNS.file) : "",
  ].filter(Boolean);
  const text = [
    `**${detail.name}**${detail.title ? ` — ${detail.title}` : ""}`,
    `${activation}. اكتمال ملفها ${pct(detail.completion)}${missing}.`,
    work.length ? `عندها ${work.join(" و")}.` : "",
  ].filter(Boolean).join("\n");
  return reply(text, memberBlock(detail), memberChoices(detail));
}

function fieldAnswer(detail: MemberDetail, fieldId: string): string {
  const field = profileField(detail, fieldId);
  const who = mention(detail);
  if (!field) return `لا يوجد حقل بهذا الاسم في ملف ${who}.`;
  const value = String(field.value ?? "").trim();
  if (fieldId === "experience_years") {
    const hire = profileField(detail, "hire_date")?.value;
    return value ? `خبرة ${who}: **${ar(Number(value))} سنة** (محسوبة من تاريخ التعيين ${hire}).` : `${who} لم تعبّئ تاريخ التعيين بعد، لذلك لا أقدر أحسب سنوات خبرتها.`;
  }
  if (!value) return `${who} لم تعبّئ «${field.label}» بعد.`;
  if (fieldId === "email") return `بريد ${who}: ${value} — وهو البريد الذي تدخل به للمنصة.`;
  return `${field.label} لـ ${who}: **${value}**`;
}

function metricAnswer(ctx: Ctx, detail: MemberDetail, key: MetricId): AgentReply {
  const who = mention(detail);
  const schools = detail.workspace.schools;
  switch (key) {
    case "schools":
      if (!schools.length) return reply(`${who} لم تضف مدارسها بعد.`, memberChoices(detail));
      return reply(`عند ${who} ${count(schools.length, NOUNS.school)}: ${listText(schools.map(school => school.name), 8)} — فيها ${count(detail.studentCount, NOUNS.student)} و${count(detail.teacherCount, NOUNS.teacher)}.`,
        { type: "table", title: `مدارس ${who}`, columns: ["المدرسة", "المرحلة", "الطالبات", "المعلمات", "التصنيف"], rows: schools.map(school => [school.name, school.stage || "—", Number(school.students) || 0, Number(school.teachers) || 0, school.tier || "—"]) });
    case "students":
      return reply(schools.length ? `مجموع طالبات مدارس ${who}: **${ar(detail.studentCount)}** طالبة في ${countGen(schools.length, NOUNS.school)}.` : `${who} لم تضف مدارسها بعد، فلا يوجد عدد طالبات.`);
    case "teachers":
      return reply(schools.length ? `مجموع معلمات مدارس ${who}: **${ar(detail.teacherCount)}** معلمة في ${countGen(schools.length, NOUNS.school)}.` : `${who} لم تضف مدارسها بعد، فلا يوجد عدد معلمات.`);
    case "visits": {
      if (!detail.visits.length) return reply(`${who} لم تسجّل أي زيارة بعد.`);
      return reply(`سجّلت ${who} ${countAcc(detail.visits.length, NOUNS.visit)}، آخرها ${dayLabel(detail.visits[0].createdAt)}:`,
        { type: "table", title: `زيارات ${who}`, columns: ["التاريخ", "المدرسة", "النوع", "الوصف"], rows: detail.visits.slice(0, 15).map(visit => [riyadhDay(visit.createdAt), visit.schoolName || "—", visit.type, visit.text.slice(0, 120)]) });
    }
    case "documents":
      return memberDocuments(detail);
    case "programs":
      return reply(detail.workspace.programs.length ? `برامج ${who}: ${listText(detail.workspace.programs.map(program => program.label), 8)}.` : `${who} لم تسجّل برامج بعد.`);
    case "activated":
    case "lastLogin":
      return reply(detail.activated ? `نعم، ${who} فعّلت حسابها${detail.lastLoginAt ? ` — آخر دخول ${relativeTime(detail.lastLoginAt)}` : ""}.` : `لا، ${who} لم تفعّل حسابها بعد.`,
        !detail.activated && choices([{ label: "جهّزي رسالة دخول لها", message: `جهّزي رسالة دخول لـ ${detail.name}` }]));
    case "lastUpdate":
      return reply(detail.workspace.version > 1 ? `آخر تحديث لملف ${who}: ${relativeTime(detail.workspace.updatedAt)} (${detail.workspace.updatedAt.slice(0, 10)}).` : `ملف ${who} لم يُحدَّث منذ إنشاء حسابها.`);
    case "submitted":
      return reply(detail.lastActivityAt ? `آخر تحديث من ${who} كان ${relativeTime(detail.lastActivityAt)}${detail.submittedToday ? " (اليوم)" : ""}.` : `${who} لم تحدّث شيئاً في ملفها بعد.`);
    case "absence":
      return reply(`${who} رصدت الغياب اليوم في ${ar(detail.absenceDoneToday)} من ${countGen(schools.length, NOUNS.school)}.`);
    case "missing":
      return memberMissing(detail);
    default:
      return reply(`اكتمال ملف ${who}: **${pct(detail.completion)}**${detail.missing.length ? ` — ينقصها: ${listText(detail.missing, 6)}.` : " — ملفها مكتمل ✅"}`, memberChoices(detail));
  }
}

function memberDocuments(detail: MemberDetail): AgentReply {
  const who = mention(detail);
  if (!detail.documents.length) return reply(`${who} لم ترفع أي ملف بعد.`, choices([{ label: "جهّزي رسالة تذكير لها", message: `جهّزي رسالة تذكير لـ ${detail.name}` }]));
  return reply(`ملفات ${who} (${ar(detail.documents.length)}):`, documentsBlock(detail.documents.map(document => ({ ...document, snippet: cleanExcerpt(document, 160) }))));
}

function memberMissing(detail: MemberDetail): AgentReply {
  const who = mention(detail);
  if (!detail.missing.length) return reply(`ملف ${who} مكتمل ✅ لا ينقصه شيء.`);
  const text = `ينقص ملف ${who} (${pct(detail.completion)}):\n${detail.missing.map(item => `- ${item}`).join("\n")}`;
  return reply(text, choices([
    { label: "جهّزي رسالة تذكير لها", message: `جهّزي رسالة تذكير لـ ${detail.name}` },
    { label: `ملف ${who}`, message: `ملف ${detail.name}` },
  ]));
}

function answerFor(ctx: Ctx, id: string): AgentReply | null {
  const detail = ctx.detail(id);
  if (!detail) return null;
  if (ctx.fields.length) {
    const lines = [...new Set(ctx.fields.map(field => field.key))].map(fieldId => fieldAnswer(detail, fieldId));
    const empty = ctx.fields.some(field => !String(profileField(detail, field.key)?.value ?? "").trim());
    return reply(lines.join("\n"), empty && choices([{ label: "جهّزي رسالة تذكير لها", message: `جهّزي رسالة تذكير لـ ${detail.name}` }, { label: `ملف ${mention(detail)}`, message: `ملف ${detail.name}` }]));
  }
  const custom = profileFieldByLabel(detail, ctx.raw);
  if (custom && !["name"].includes(custom.id)) {
    const value = String(custom.value ?? "").trim();
    return reply(value ? `${custom.label} لـ ${mention(detail)}: **${value}**` : `${mention(detail)} لم تعبّئ «${custom.label}» بعد.`);
  }
  const key = ctx.metrics.find(item => item.key !== "members")?.key;
  if (key) return metricAnswer(ctx, detail, key);
  return summaryOf(detail);
}

function memberQuestion(ctx: Ctx): AgentReply | null {
  if (ctx.ambiguous && (!ctx.targetId || ctx.memberIds.length)) return askWhich(ctx, ctx.ambiguous);
  if (!ctx.targetId) return null;
  const ids = ctx.memberIds.length ? ctx.memberIds : [ctx.targetId];
  if (ids.length > 1 && !ctx.fields.length && !ctx.metrics.length) return compareMembers(ctx, ids);
  const replies = ids.map(id => answerFor(ctx, id)).filter((item): item is AgentReply => Boolean(item));
  if (replies.length === 1) return replies[0];
  return { text: replies.map(item => item.text).join("\n"), blocks: replies.flatMap(item => item.blocks.filter(block => block.type !== "choices")) };
}

// ---------- Compare ----------
function compareMembers(ctx: Ctx, ids: string[]): AgentReply {
  const details = ids.map(id => ctx.detail(id)).filter((item): item is MemberDetail => Boolean(item)).slice(0, 4);
  const row = (label: string, pick: (detail: MemberDetail) => string | number) => [label, ...details.map(pick)];
  const rows = [
    row("الصفة", detail => detail.title || "—"),
    row("الحساب", detail => activationLabel(detail)),
    row("الاكتمال", detail => pct(detail.completion)),
    row("المدارس", detail => detail.schoolCount),
    row("الطالبات", detail => detail.studentCount),
    row("المعلمات", detail => detail.teacherCount),
    row("الزيارات", detail => detail.visitCount),
    row("الملفات", detail => detail.documentCount),
    row("آخر تحديث", detail => (detail.workspace.version > 1 ? relativeTime(detail.workspace.updatedAt) : "لم يُحدَّث")),
    row("عدد النواقص", detail => detail.missing.length),
  ];
  const leader = [...details].sort((a, b) => b.completion - a.completion)[0];
  const tie = details.every(detail => detail.completion === leader.completion);
  const text = tie
    ? `المقارنة بين ${details.map(mention).join(" و")} — اكتمالهن متساوٍ (${pct(leader.completion)}):`
    : `المقارنة بين ${details.map(mention).join(" و")} — الأعلى اكتمالاً ${mention(leader)} (${pct(leader.completion)}):`;
  return reply(text, { type: "table", title: "مقارنة", columns: ["البند", ...details.map(mention)], rows });
}

function compare(ctx: Ctx): AgentReply | null {
  if (!has(ctx, W.compare)) return null;
  if (ctx.ambiguous) return askWhich(ctx, ctx.ambiguous);
  if (ctx.memberIds.length >= 2) return compareMembers(ctx, ctx.memberIds);
  if (ctx.memberIds.length === 1) {
    const base = ctx.member(ctx.memberIds[0]);
    const others = ctx.team.members.filter(member => member.id !== base.id).sort((a, b) => b.completion - a.completion).slice(0, 4);
    return reply(`أقارن ${mention(base)} مع مين؟`, choices(others.map(other => ({ label: mention(other), message: `قارني بين ${base.name} و${other.name}` }))));
  }
  return rankingReply(ctx, "completion", "desc", ctx.team.members.length);
}

// ---------- Search & documents ----------
function search(ctx: Ctx): AgentReply | null {
  const verb = spanOf(ctx, W.search);
  if (!verb) return null;
  const inMention = (index: number) => ctx.mentions.some(item => index >= item.start && index <= item.end);
  const query = ctx.tokens.filter(token => !token.punct && !inMention(token.index) && (token.index < verb.start || token.index > verb.end)).map(token => token.raw).join(" ");
  const memberId = ctx.memberIds[0];
  const hits = searchDocuments(ctx.head.id, query, { memberId });
  const visits = searchVisits(memberId ? ctx.details().filter(detail => detail.id === memberId) : ctx.details(), query).slice(0, 8);
  const shownQuery = searchPhrase(query);
  if (!shownQuery) return reply("وش الكلمة اللي أبحث عنها؟ اكتبي مثلاً: «ابحثي في الملفات عن خطة التحسين».");
  if (!hits.length && !visits.length) {
    return reply(`ما لقيت «${shownQuery}» في ${memberId ? `ملفات ${mention(ctx.member(memberId))}` : "الملفات المرفوعة ولا في الزيارات"}. جرّبي كلمة أخرى أو جزءاً من الكلمة.`);
  }
  const blocks: ChatBlock[] = [];
  if (hits.length) {
    blocks.push(documentsBlock(hits.map(hit => ({ ...hit.document, snippet: [hit.where, hit.snippets[0]].filter(Boolean).join(" — ") })), `نتائج «${shownQuery}»`));
  }
  if (visits.length) {
    blocks.push({ type: "table", title: "في الزيارات", columns: ["المشرفة", "المدرسة", "النوع", "الوصف"], rows: visits.map(visit => [visit.memberName, visit.schoolName || "—", visit.type, visit.text.slice(0, 120)]), memberIds: visits.map(visit => visit.memberId) });
  }
  const parts = [hits.length ? countGen(hits.length, NOUNS.file) : "", visits.length ? countGen(visits.length, NOUNS.visit) : ""].filter(Boolean);
  return { text: `وجدت «${shownQuery}» في ${parts.join(" و")}:`, blocks };
}

function documentContent(ctx: Ctx): AgentReply | null {
  const summarize = has(ctx, W.summarize);
  const fileWord = has(ctx, W.documentWords);
  if (!summarize && !fileWord) return null;
  const textWithoutNames = ctx.tokens.filter(token => !ctx.mentions.some(item => token.index >= item.start && token.index <= item.end)).map(token => token.raw).join(" ");
  const document = findDocumentByName(ctx.head.id, textWithoutNames);
  if (!document || (!summarize && ctx.targetId)) return null;
  const body = document.text.trim();
  const owner = document.ownerName ? ` (ملف ${shortName(document.ownerName)})` : "";
  if (!body) return reply(`«${document.name}»${owner} لا يحتوي نصاً أقدر أقرأه${document.kind === "image" ? " — قراءة الصور تحتاج تفعيل Claude" : ""}.`, documentsBlock([document]));
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const preview = lines.slice(0, 25).join("\n").slice(0, 1800);
  const structure = document.kind === "spreadsheet" ? `فيه ${document.tables.length === 1 ? "ورقة واحدة" : `${ar(document.tables.length)} أوراق`} و${count(document.tables.reduce((sum, table) => sum + table.rows.length, 0), NOUNS.row)}. ` : "";
  return reply(`هذا محتوى «${document.name}»${owner}. ${structure}أول ما فيه:\n\n${preview}${body.length > preview.length ? "\n…" : ""}`, documentsBlock([document]));
}

function documents(ctx: Ctx): AgentReply | null {
  const content = documentContent(ctx);
  if (content) return content;
  if (!metric(ctx, "documents")) return null;
  if (ctx.ambiguous && !ctx.targetId) return askWhich(ctx, ctx.ambiguous);
  if (ctx.targetId) {
    const detail = ctx.detail(ctx.targetId);
    return detail ? memberDocuments(detail) : null;
  }
  if (has(ctx, W.count)) return null;
  const all = ctx.details().flatMap(detail => detail.documents).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!all.length) return reply("لم ترفع أي مشرفة ملفاً بعد.", choices([{ label: "جهّزي رسالة تذكير" }]));
  return reply(`آخر الملفات المرفوعة (${count(all.length, NOUNS.file)} إجمالاً):`, documentsBlock(all.slice(0, 20).map(document => ({ ...document, snippet: cleanExcerpt(document, 140) }))));
}

// ---------- Missing data ----------
function missing(ctx: Ctx): AgentReply | null {
  const incomplete = has(ctx, W.incomplete) || metric(ctx, "missing");
  const fillSpan = spanOf(ctx, W.fill);
  const notFilled = negated(ctx, fillSpan);
  const fieldWithout = ctx.fields.some(field => negated(ctx, field.span));
  if (!incomplete && !notFilled && !fieldWithout) return null;
  if (!ctx.fields.length && (metric(ctx, "schools") || metric(ctx, "documents") || metric(ctx, "visits"))) return null; // "ما ضافت مدارس" → filters
  if (!ctx.fields.length && !incomplete && has(ctx, W.enter)) return null; // "ما سجلت دخول" → filters
  if (ctx.ambiguous && !ctx.targetId) return askWhich(ctx, ctx.ambiguous);
  if (ctx.targetId) {
    const detail = ctx.detail(ctx.targetId);
    return detail ? memberMissing(detail) : null;
  }
  if (ctx.fields.length) {
    const fieldId = ctx.fields[0].key;
    const label = ctx.details()[0]?.workspace.profile.find(field => field.id === fieldId)?.label ?? fieldId;
    const members = membersMissingField(ctx.details(), fieldId, label);
    if (!members.length) return reply(`كل المشرفات عبّأن «${label}» ✅`);
    return reply(`${count(members.length, NOUNS.member)} لم يعبّئن «${label}»:`, membersTable(members), choices([{ label: "جهّزي رسالة تذكير لهن", message: "جهّزي رسالة تذكير" }]));
  }
  const members = ctx.team.members.filter(member => member.missing.length).sort((a, b) => a.completion - b.completion);
  if (!members.length) return reply("كل الملفات مكتملة ✅ لا توجد نواقص.");
  const tally = new Map<string, number>();
  for (const member of members) for (const item of member.missing) tally.set(item, (tally.get(item) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([item, n]) => `${item} (${ar(n)})`);
  return reply(
    `${count(members.length, NOUNS.member)} ملفاتهن ناقصة. أكثر ما ينقص: ${top.join("، ")}.`,
    { type: "table", title: "نواقص الفريق", columns: ["الاسم", "الاكتمال", "عدد النواقص", "أهم ما ينقص"], rows: members.map(member => [member.name, pct(member.completion), member.missing.length, listText(member.missing, 3)]), memberIds: members.map(member => member.id) },
    choices([{ label: "جهّزي رسالة تذكير" }, { label: "الأقل اكتمالاً" }]),
  );
}

// ---------- Filters ----------
const WHO_CUES = phrases(["مين", "من", "منهن", "اللي", "الي", "التي", "اسماء", "أسماء", "قائمة", "وريني", "اعرضي", "كم", "عدد", "المشرفات", "العضوات", "هل", "فيه", "أحد", "احد", "وحدة", "وحده"]);

function detectFilter(ctx: Ctx): { filter: MemberFilter | "updated_today" } | null {
  const negatedMetric = (key: MetricId) => ctx.metrics.some(item => item.key === key && (negated(ctx, item.span) || negated(ctx, spanOf(ctx, W.fill))));
  if (negatedMetric("schools")) return { filter: "no_schools" };
  if (negatedMetric("documents")) return { filter: "no_documents" };
  if (negatedMetric("visits")) return { filter: "no_visits" };
  // "أرسلت تحديثها" is about sending the update, not editing the file, so it is checked first.
  const submit = spanOf(ctx, W.submit);
  if (submit && !metric(ctx, "documents")) return { filter: negated(ctx, submit) ? "not_submitted_today" : "submitted_today" };
  if (has(ctx, W.updated) && has(ctx, W.today)) return { filter: "updated_today" };
  const enter = spanOf(ctx, W.enter);
  if (enter) return { filter: negated(ctx, enter) ? "not_activated" : "activated" };
  const complete = spanOf(ctx, W.complete);
  if (complete) return { filter: negated(ctx, complete) ? "incomplete" : "complete" };
  return null;
}

const FILTER_FOLLOWUPS: Partial<Record<MemberFilter | "updated_today", { label: string; message?: string }[]>> = {
  not_activated: [{ label: "جهّزي رسائل الدخول لهن", message: "جهّزي رسائل الدخول" }],
  incomplete: [{ label: "جهّزي رسالة تذكير لهن", message: "جهّزي رسالة تذكير" }, { label: "نواقص الفريق" }],
  no_schools: [{ label: "جهّزي رسالة تذكير لهن", message: "جهّزي رسالة تذكير" }],
  no_documents: [{ label: "جهّزي رسالة تذكير لهن", message: "جهّزي رسالة تذكير" }],
  not_submitted_today: [{ label: "جهّزي رسالة تذكير لهن", message: "جهّزي رسالة تذكير" }],
};

function filters(ctx: Ctx): AgentReply | null {
  if (ctx.targetId || ctx.ambiguous) return null;
  const detected = detectFilter(ctx);
  if (!detected || (!has(ctx, WHO_CUES) && words(ctx).length > 3)) return null;
  const { filter } = detected;
  const members = filter === "updated_today"
    ? updatedToday(ctx.details())
    : filterMembers(ctx.team.members, filter);
  const label = filter === "updated_today" ? FILTER_LABELS.submitted_today : FILTER_LABELS[filter];
  if (!members.length) {
    const none: Record<string, string> = {
      not_activated: "كل المشرفات فعّلن حساباتهن ✅",
      activated: "لم تفعّل أي مشرفة حسابها بعد.",
      complete: "لا يوجد ملف مكتمل بعد (٨٥٪ فأكثر).",
      incomplete: "كل الملفات مكتملة ✅",
      submitted_today: "لم تحدّث أي مشرفة شيئاً اليوم بعد.",
      not_submitted_today: "كل المشرفات حدّثن اليوم ✅",
      no_schools: "كل المشرفات أضفن مدارسهن ✅",
      no_documents: "كل المشرفات رفعن ملفات ✅",
      no_visits: "كل المشرفات سجّلن زيارات ✅",
      updated_today: "لم تحدّث أي مشرفة شيئاً اليوم بعد.",
    };
    return reply(none[filter]);
  }
  const total = ctx.team.members.length;
  const text = members.length === total ? `كل المشرفات (${ar(total)}) ${label}:` : `${count(members.length, NOUNS.member)} من ${ar(total)} ${label}:`;
  const followups = FILTER_FOLLOWUPS[filter];
  return reply(text, membersTable(members), followups && choices(followups));
}

// ---------- Schools across the team ("مدارس تصنيفها تميز"، "المدارس الابتدائية"، "المتوسطة ٣٣ لمين؟") ----------
const TIERS = ["تميز", "تقدم", "انطلاق", "تهيئه"];
const STAGES: { stem: string; label: string }[] = [
  { stem: "ابتداي", label: "الابتدائية" }, { stem: "متوسط", label: "المتوسطة" }, { stem: "ثانوي", label: "الثانوية" }, { stem: "رياض", label: "رياض الأطفال" },
];

function schoolSearch(ctx: Ctx): AgentReply | null {
  if (ctx.targetId || ctx.ambiguous) return null;
  const words = ctx.tokens.flatMap(token => token.variants);
  const all = ctx.details().flatMap(detail => detail.workspace.schools.map(school => ({ school, member: detail })));
  if (!all.length) return null;

  // A school named in full ("الابتدائية ١٢٠") — two words or more, so a lone "الثانوية" is not a name.
  const named = all.filter(({ school }) => {
    const parts = normalizeText(school.name).split(" ");
    return parts.length >= 2 && parts.every(part => words.includes(part));
  });
  if (named.length) {
    const [{ school, member }] = named;
    return reply(`«${school.name}» في ملف ${mention(member)} — ${describeSchool(school)}.`, choices([{ label: `مدارس ${mention(member)}`, message: `مدارس ${member.name}` }, { label: `ملف ${mention(member)}`, message: `ملف ${member.name}` }]));
  }

  if (!metric(ctx, "schools")) return null;
  const tier = TIERS.find(item => words.includes(item));
  const stage = STAGES.find(item => words.some(word => word.startsWith(item.stem) || word.startsWith(`ال${item.stem}`)));
  if (!tier && !stage) return null;
  const matches = all.filter(({ school }) => (!tier || normalizeArabic(school.tier) === tier) && (!stage || normalizeArabic(school.stage).replace(/^ال/, "").startsWith(stage.stem)));
  const what = [stage ? `في المرحلة ${stage.label}` : "", tier ? `تصنيفها «${matches[0]?.school.tier || tier}»` : ""].filter(Boolean).join(" و");
  if (!matches.length) return reply(`لا توجد مدارس مسجّلة ${what} — حسب ما أدخلته المشرفات حتى الآن.`);
  return reply(`${count(matches.length, NOUNS.school)} ${what}:`, {
    type: "table",
    columns: ["المدرسة", "المرحلة", "الطالبات", "المعلمات", "التصنيف", "المشرفة"],
    rows: matches.map(({ school, member }) => [school.name, school.stage || "—", Number(school.students) || 0, Number(school.teachers) || 0, school.tier || "—", mention(member)]),
    memberIds: matches.map(({ member }) => member.id),
  });
}

// ---------- One field for the whole team ("جوالات المشرفات"، "ايميلات الفريق") ----------
function teamField(ctx: Ctx): AgentReply | null {
  if (!ctx.fields.length || ctx.targetId || ctx.ambiguous || ctx.fields[0].key === "name") return null;
  const fieldId = ctx.fields[0].key;
  const details = ctx.details();
  const label = details[0]?.workspace.profile.find(field => field.id === fieldId)?.label ?? builtInField(fieldId)?.label ?? fieldId;
  const valueOf = (detail: MemberDetail) => String(profileField(detail, fieldId)?.value ?? "").trim();
  const filled = details.filter(detail => valueOf(detail)).length;
  const text = filled
    ? `«${label}» لكل المشرفات — مسجّل عند ${filled === details.length ? "الجميع" : `${countGen(filled, NOUNS.member)} من ${ar(details.length)}`}:`
    : `لم تعبّئ أي مشرفة «${label}» بعد.`;
  return reply(
    text,
    filled > 0 && { type: "table", title: label, columns: ["الاسم", label], rows: details.map(detail => [detail.name, valueOf(detail) || "لم تُعبّأ بعد"]), memberIds: details.map(detail => detail.id) },
    filled < details.length && choices([{ label: `من لم تعبّئ ${label}؟` }, { label: "جهّزي رسالة تذكير" }]),
  );
}

// ---------- Rankings ----------
function rankingReply(ctx: Ctx, key: MetricId, direction: "asc" | "desc", limit: number): AgentReply {
  const sorted = [...ctx.team.members].sort((a, b) => (direction === "desc" ? metricValue(b, key) - metricValue(a, key) : metricValue(a, key) - metricValue(b, key)));
  // "Most schools" lists only members who have some; zeros say nothing about who leads.
  const ranked = direction === "desc" && key !== "completion" ? sorted.filter(member => metricValue(member, key) > 0) : sorted;
  const shown = ranked.slice(0, Math.max(1, limit));
  const format = (member: MemberSummary) => (key === "completion" ? pct(member.completion) : ar(metricValue(member, key)));
  const label = METRIC_RANK_LABEL[key] ?? METRIC_LABELS[key];
  const heading = `${direction === "asc" ? "الأقل" : key === "completion" ? "الأعلى" : "الأكثر"} ${label}`;
  const what = indefinite(METRIC_LABELS[key]);
  if (!shown.length || sorted.every(member => metricValue(member, key) === 0)) {
    return reply(`لا توجد ${what} مسجّلة بعد عند أي مشرفة، فلا يوجد ترتيب.`, choices([{ label: "نواقص الفريق" }, { label: "جهّزي رسالة تذكير" }]));
  }
  const zeros = key === "completion" ? 0 : sorted.filter(member => metricValue(member, key) === 0).length;
  const headline = shown.slice(0, 3).map(member => `${mention(member)} (${format(member)})`).join("، ثم ");
  const text = direction === "desc"
    ? `${heading}: ${headline}.${zeros ? ` والبقية (${ar(zeros)}) لم يسجّلن ${what} بعد.` : ""}`
    : zeros ? `${count(zeros, NOUNS.member)} بلا ${what} بعد، منهن: ${listText(shown.map(mention), 5)}.` : `${heading}: ${headline}.`;
  return reply(text, {
    type: "table",
    title: heading,
    columns: ["#", "الاسم", METRIC_LABELS[key]],
    rows: shown.map((member, index) => [ar(index + 1), member.name, format(member)]),
    memberIds: shown.map(member => member.id),
  });
}

function rankings(ctx: Ctx): AgentReply | null {
  const high = spanOf(ctx, W.rankHigh);
  const low = spanOf(ctx, W.rankLow);
  const verb = spanOf(ctx, W.rankVerb);
  if ((!high && !low && !verb) || ctx.targetId || ctx.ambiguous) return null;
  const key = ctx.metrics.find(item => !["members", "activated", "submitted", "lastLogin", "lastUpdate"].includes(item.key))?.key
    ?? (has(ctx, W.incomplete) ? "missing" : "completion");
  const n = smallNumber(ctx);
  const limit = n ?? (verb && !high && !low ? ctx.team.members.length : 5);
  return rankingReply(ctx, key, low ? "asc" : "desc", limit);
}

// ---------- Counts ----------
const SUMMABLE: Partial<Record<MetricId, { noun: typeof NOUNS.school; field: keyof MemberSummary }>> = {
  schools: { noun: NOUNS.school, field: "schoolCount" },
  students: { noun: NOUNS.student, field: "studentCount" },
  teachers: { noun: NOUNS.teacher, field: "teacherCount" },
  visits: { noun: NOUNS.visit, field: "visitCount" },
  documents: { noun: NOUNS.file, field: "documentCount" },
  programs: { noun: NOUNS.program, field: "programCount" },
};

function counts(ctx: Ctx): AgentReply | null {
  if (!has(ctx, W.count) || ctx.targetId || ctx.ambiguous) return null;
  const { stats, members } = ctx.team;
  const key = ctx.metrics[0]?.key
    ?? (ctx.tokens.some(token => ["ملف", "ملفات"].includes(token.norm)) ? "documents" : null)
    ?? (ctx.tokens.some(token => ["وحده", "وحدة", "عضوه", "مشرفه"].includes(token.norm)) ? "members" : null);
  if (!key) return null;
  if (key === "members") {
    return reply(`عدد المشرفات في الفريق: **${ar(stats.members)}** — فعّلت ${ar(stats.activated)} منهن حساباتهن، و${ar(stats.notActivated)} لم يدخلن بعد.`, choices([{ label: "قائمة المشرفات", message: "اعرضي المشرفات" }]));
  }
  if (key === "completion") {
    return reply(`متوسط اكتمال ملفات الفريق: **${pct(stats.averageCompletion)}**${stats.completeProfiles ? ` — ${count(stats.completeProfiles, NOUNS.completeFile)} (٨٥٪ فأكثر)` : " — ولا يوجد ملف مكتمل بعد"}.`,
      { type: "stats", items: [{ label: "متوسط الاكتمال", value: pct(stats.averageCompletion), tone: completionTone(stats.averageCompletion) }, { label: "ملفات مكتملة", value: stats.completeProfiles }, { label: "أقل من ٥٠٪", value: members.filter(member => member.completion < 50).length, tone: "warn" }] },
      choices([{ label: "الأقل اكتمالاً" }, { label: "نواقص الفريق" }]));
  }
  if (key === "absence") {
    const done = members.reduce((sum, member) => sum + member.absenceDoneToday, 0);
    return reply(`رُصد الغياب اليوم في ${count(done, NOUNS.school)} من أصل ${ar(stats.schools)}.`);
  }
  const summable = SUMMABLE[key];
  if (!summable) return null;
  const valueOf = (member: MemberSummary) => Number(member[summable.field]) || 0;
  const total = members.reduce((sum, member) => sum + valueOf(member), 0);
  const contributors = members.filter(member => valueOf(member) > 0).sort((a, b) => valueOf(b) - valueOf(a));
  const label = METRIC_LABELS[key];
  if (!total) return reply(`لا توجد ${indefinite(label)} مسجّلة بعد — لم تضف أي مشرفة شيئاً منها.`, choices([{ label: "جهّزي رسالة تذكير" }]));
  return reply(
    `مجموع ${label} المسجّلة: **${count(total, summable.noun)}**، عند ${countGen(contributors.length, NOUNS.member)} من ${ar(members.length)}.`,
    { type: "table", title: `${label} حسب المشرفة`, columns: ["الاسم", label], rows: contributors.map(member => [member.name, valueOf(member)]), memberIds: contributors.map(member => member.id) },
  );
}

// ---------- Fallback ----------
function fallback(ctx: Ctx): AgentReply {
  const hits = searchDocuments(ctx.head.id, ctx.raw, { limit: 5, requireAll: true });
  if (hits.length) {
    return reply(
      "ما فهمت سؤالك بالضبط، لكن وجدت هذه الكلمات في الملفات المرفوعة:",
      documentsBlock(hits.map(hit => ({ ...hit.document, snippet: hit.snippets[0] }))),
      choices([{ label: "أرقام الفريق" }, { label: "وش تقدرين تسوين؟" }]),
    );
  }
  return reply("ما فهمت المطلوب تماماً. جرّبي تسأليني بطريقة أخرى، مثلاً:", starterChoices(ctx));
}

// Order matters: actions first, then specific question types, then the broad ones.
const HANDLERS: [intent: string, handler: (ctx: Ctx) => AgentReply | null][] = [
  ["undo", undoLast], ["add_field", addCustomField], ["add_member", addMember], ["delete_member", deleteMemberHelp],
  ["edit", editCommand], ["edit", implicitEdit], ["messages", messages], ["report", report], ["compare", compare], ["search", search],
  ["missing", missing], ["filter", filters], ["schools", schoolSearch], ["documents", documents], ["ranking", rankings], ["count", counts],
  ["member", memberQuestion], ["team_field", teamField], ["overview", overview], ["list", listMembers], ["social", social],
];

export function localRespond(input: EngineInput): AgentReply {
  const ctx = buildContext(input);
  if (!words(ctx).length) return { ...greeting(ctx), intent: "social" };
  for (const [intent, handler] of HANDLERS) {
    const result = handler(ctx);
    if (result) return { ...result, intent };
  }
  return { ...fallback(ctx), intent: "fallback" };
}

