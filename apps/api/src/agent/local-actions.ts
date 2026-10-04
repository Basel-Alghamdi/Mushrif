// Local-engine handlers that do something: edit data, add members, prepare messages and reports, undo.
import type { ChatBlock, MemberSummary, ProposalChange } from "@rasd/schemas";
import type { Account } from "../accounts.js";
import { findMessageWithProposal, getProposal, resolveProposal, updateMessageBlocks } from "../chat-store.js";
import { builtInField, normalizeFieldValue, profileField, profileFieldByLabel } from "./data.js";
import { askWhich, has, negated, reply, spanOf, words, type Ctx } from "./engine-context.js";
import { phrases, W } from "./lexicon.js";
import type { Mention } from "./names.js";
import { EMAIL_PATTERN, westernDigits } from "./normalize.js";
import { executePayload, executeProposal, type AgentReply } from "./proposals.js";
import { appUrl, ar, choices, count, firstName, listText, NOUNS, pct, riyadhDateLabel, shortName, statsBlock } from "./render.js";

const VALUE_MARKERS = new Set([":", "=", "الي", "يكون", "تكون", "يصير", "تصير", "صار", "صارت", "قيمته", "قيمتها", "بقيمه", "وقيمته", "وقيمتها", "الجديد", "الجديده"]);
const WEAK_VERBS = new Set(["اكتبي", "خلي", "سجلي", "حطي", "حطيها", "ضعي", "عبي", "املي", "املئي", "set"]);
const FILLER = new Set(["ل", "لها", "عند", "عندها", "في", "حق", "حقها", "تبع", "تبعها", "هو", "هي", "رقم", "يا", "لو", "سمحت", "ملف", "ملفها", "من", "فضلك"]);

const unquote = (value: string) => value.replace(/^[\s«"“'(]+|[\s»"”')]+$/g, "").replace(/[؟?]+$/, "").trim();

function targetMember(ctx: Ctx, mentions: Mention[]): { id: string } | { ask: AgentReply } | null {
  const resolved = mentions.find(mention => !mention.ambiguous);
  if (resolved) return { id: resolved.candidates[0] };
  const ambiguous = mentions.find(mention => mention.ambiguous);
  if (ambiguous) return { ask: askWhich(ctx, ambiguous) };
  return ctx.targetId ? { id: ctx.targetId } : null;
}

function valueAfterMarker(ctx: Ctx, from: number) {
  const marker = ctx.tokens.findIndex((token, index) => index >= from && VALUE_MARKERS.has(token.norm));
  return marker >= 0 ? { marker, value: unquote(ctx.tokens.slice(marker + 1).map(token => token.raw).join(" ")) } : null;
}

/** Value for a field when Khulood wrote no "إلى"/":" — a phone/ID number, an email, a date, or the words left over. */
function inferValue(ctx: Ctx, fieldId: string | null, consumed: Set<number>, after: number) {
  const rest = ctx.tokens.filter(token => token.index > after && !consumed.has(token.index));
  const text = westernDigits(rest.map(token => token.raw).join(" "));
  if (fieldId === "email" || fieldId === "moe_email") return text.match(EMAIL_PATTERN)?.[0] ?? "";
  if (fieldId === "phone" || fieldId === "national_id" || fieldId === "employee_no") return text.match(/\+?\d[\d\s-]{3,}\d/)?.[0].replace(/[\s-]/g, "") ?? "";
  if (fieldId === "hire_date" || fieldId === "assignment_date") {
    const date = text.match(/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/)?.[0];
    if (date) return date;
  }
  return unquote(rest.filter(token => !FILLER.has(token.norm) && !token.punct).map(token => token.raw).join(" "));
}

function singleEditText(name: string, label: string, before: string, after: string, fieldId: string | null) {
  if (!after) return `تم ✅ مسحت «${label}» من ملف ${shortName(name)}${before ? ` (كانت: ${before})` : ""}.`;
  const was = before ? ` — كانت: ${before}` : " — كانت فارغة";
  const loginNote = fieldId === "email" ? "\nصار دخولها للمنصة بهذا البريد." : "";
  return `تم ✅ صار «${label}» لـ ${shortName(name)}: **${after}**${was}.${loginNote}`;
}

function applyChanges(ctx: Ctx, changes: ProposalChange[]): AgentReply {
  const result = executePayload(ctx.head, ctx.conversationId, { title: "", summary: "", changes });
  const applied = result.blocks.filter(block => block.type === "applied");
  if (changes.length === 1 && applied.length && !result.text.includes("ملاحظات")) {
    const [change] = changes;
    const appliedBlock = applied[0];
    const text = singleEditText(change.memberName, change.fieldLabel, change.before, change.after, change.fieldId);
    return reply(text, appliedBlock.type === "applied" ? { ...appliedBlock, text: `${change.fieldLabel} — ${shortName(change.memberName)}` } : appliedBlock);
  }
  return result;
}

// ---------- Edit a profile field ----------
export function editCommand(ctx: Ctx): AgentReply | null {
  const verb = spanOf(ctx, W.edit);
  const clear = spanOf(ctx, W.clear);
  const colon = ctx.tokens.findIndex(token => token.norm === ":" || token.norm === "=");
  const verbEarly = verb !== null && verb.start <= 2;
  const clearEarly = clear !== null && clear.start <= 2;
  if (!verbEarly && !clearEarly && colon < 0) return null;
  if (has(ctx, W.customFieldNoun) && has(ctx, W.add)) return null;

  const start = Math.max(verb?.end ?? -1, clear?.end ?? -1) + 1;
  const markerInfo = valueAfterMarker(ctx, start);
  const until = markerInfo?.marker ?? ctx.tokens.length;
  const fields = ctx.fields.filter(field => field.span.start < until);
  const mentions = ctx.mentions.filter(mention => mention.start < until);
  const target = targetMember(ctx, mentions);
  if (target && "ask" in target) return target.ask;
  if (colon >= 0 && !verbEarly && !clearEarly && (!fields.length || !target)) return null;

  const detail = target ? ctx.detail(target.id) : null;
  let fieldId: string | null = fields[0]?.key ?? null;
  let fieldLabel = fieldId ? builtInField(fieldId)?.label ?? fieldId : "";
  if (!fieldId && detail) {
    const custom = profileFieldByLabel(detail, ctx.tokens.slice(0, until).map(token => token.raw).join(" "));
    if (custom) { fieldId = custom.id; fieldLabel = custom.label; }
  }
  if (!fieldId) {
    const strongVerb = verbEarly && !WEAK_VERBS.has(ctx.tokens[verb!.start].norm);
    if (strongVerb && detail) {
      const first = firstName(detail.name);
      return reply(`أي بيانات تقصدين في ملف ${shortName(detail.name)}؟ اكتبي مثلاً: «غيري جوال ${first} إلى 0551234567» أو «أضيفي حقل الدورات لـ${first} قيمته ٣».`);
    }
    return null;
  }
  if (!detail) {
    return reply(`لمن أعدّل «${fieldLabel}»؟ اكتبي اسم المشرفة، مثلاً: «غيري ${fieldLabel} لرشا إلى …».`);
  }

  const consumed = new Set<number>();
  for (const span of [verb, clear, ...fields.map(field => field.span), ...mentions]) {
    if (!span) continue;
    for (let i = span.start; i <= span.end; i++) consumed.add(i);
  }
  const lastUsed = Math.max(...consumed);
  const field = profileField(detail, fieldId);
  const rawValue = clearEarly ? "" : markerInfo ? markerInfo.value : inferValue(ctx, fieldId, consumed, lastUsed);
  const value = field?.custom ? rawValue : normalizeFieldValue(fieldId, rawValue);
  if (field?.derived) {
    return reply(`«${field.label}» تُحسب تلقائياً من تاريخ التعيين. عدّلي تاريخ التعيين وتتحدّث وحدها، مثلاً: «غيري تاريخ التعيين لـ${firstName(detail.name)} إلى 2012-09-01».`);
  }
  if (!clearEarly && !value) {
    return reply(`وش القيمة الجديدة لـ«${fieldLabel}» عند ${shortName(detail.name)}؟ اكتبيها بعد «إلى»، مثلاً: «غيري ${fieldLabel} ${firstName(detail.name)} إلى …».`);
  }
  const before = field?.value ?? "";
  if (before === value) return reply(`«${fieldLabel}» لـ ${shortName(detail.name)} مسجّل أصلاً بهذه القيمة: ${value || "فارغ"}.`);
  return applyChanges(ctx, [{ memberId: detail.id, memberName: detail.name, fieldId: field?.id ?? fieldId, fieldLabel: field?.label ?? fieldLabel, before, after: value }]);
}

// ---------- A statement without a verb: "مؤهل جوهرة بكالوريوس"، "جوالها 0551234567" ----------
const QUESTION_WORDS = new Set(["وش", "ايش", "شو", "كم", "هل", "مين", "من", "متي", "وين", "اين", "ماهو", "ماهي", "ما", "هو", "هي", "كيف", "ليش", "لماذا", "عطيني", "اعطيني", "ابي", "ابغي", "ودي", "ابغا", "اعرف", "ملف"]);
const LOOKS_LIKE: Partial<Record<string, RegExp>> = {
  phone: /^\+?\d[\d\s-]{6,}$/, national_id: /^\d{6,}$/, employee_no: /^\d{3,}$/,
  email: EMAIL_PATTERN, moe_email: EMAIL_PATTERN, hire_date: /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/, assignment_date: /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/,
};
const TEXT_FIELDS = new Set(["title", "rank", "qualification", "major", "supervision_major", "cluster"]);
// Words that qualify the question rather than give a value ("تخصص رشا الإشرافي"، "رتبتها الحالية").
const NOT_A_VALUE = new Set(["الاشرافي", "اشرافي", "الوزاري", "وزاري", "الوظيفي", "وظيفي", "المدني", "الحاليه", "حاليا", "الان", "الحين", "بالضبط", "كامل", "كامله"]);

export function implicitEdit(ctx: Ctx): AgentReply | null {
  if (ctx.fields.length !== 1 || ctx.metrics.length || ctx.mentions.length > 1 || ctx.ambiguous || !ctx.targetId) return null;
  if (!(ctx.memberIds.length === 1 || ctx.focusBy === "pronoun") || /[؟?]\s*$/.test(ctx.raw)) return null;
  const [field] = ctx.fields;
  const consumed = new Set<number>();
  for (const span of [field.span, ...ctx.mentions]) for (let i = span.start; i <= span.end; i++) consumed.add(i);
  const rest = ctx.tokens.filter(token => !consumed.has(token.index) && !token.punct);
  const value = unquote(westernDigits(rest.filter(token => !FILLER.has(token.norm)).map(token => token.raw).join(" ")));
  if (!value || rest[0]?.index < field.span.start) return null;
  if (rest.some(token => QUESTION_WORDS.has(token.norm) || NOT_A_VALUE.has(token.norm))) return null;
  const pattern = LOOKS_LIKE[field.key];
  const plausible = pattern ? pattern.test(value) : TEXT_FIELDS.has(field.key) && value.split(/\s+/).length <= 5;
  if (!plausible) return null;
  const detail = ctx.detail(ctx.targetId);
  const current = detail ? profileField(detail, field.key) : null;
  if (!detail || current?.derived) return null;
  const after = normalizeFieldValue(field.key, value);
  const before = current?.value ?? "";
  if (before === after) return reply(`«${current?.label ?? field.key}» لـ ${shortName(detail.name)} مسجّل أصلاً بهذه القيمة: ${after}.`);
  const label = current?.label ?? builtInField(field.key)?.label ?? field.key;
  return applyChanges(ctx, [{ memberId: detail.id, memberName: detail.name, fieldId: field.key, fieldLabel: label, before, after }]);
}

// ---------- Add a custom field ----------
const LABEL_FILLER = new Set(["ل", "لها", "عند", "في", "ملف", "اسمه", "عنوانه", "جديد", "باسم", "اسم", "اسمها", "بعنوان"]);
const EVERYONE = phrases(["لكل المشرفات", "لكل العضوات", "للجميع", "لكل الفريق", "لجميع المشرفات", "للكل", "لكلهن"]);

export function addCustomField(ctx: Ctx): AgentReply | null {
  const add = spanOf(ctx, W.add);
  const noun = spanOf(ctx, W.customFieldNoun);
  if (!add || add.start > 2 || !noun) return null;
  const markerInfo = valueAfterMarker(ctx, noun.end + 1);
  const until = markerInfo?.marker ?? ctx.tokens.length;
  const everyone = spanOf(ctx, EVERYONE);
  const mentions = ctx.mentions.filter(mention => mention.start < until);
  const inMention = (index: number) => mentions.some(mention => index >= mention.start && index <= mention.end) || (everyone !== null && index >= everyone.start && index <= everyone.end);
  const label = unquote(ctx.tokens.filter(token => token.index > noun.end && token.index < until && !inMention(token.index) && !LABEL_FILLER.has(token.norm) && !token.punct).map(token => token.raw).join(" "));
  if (!label) return reply("وش اسم الحقل الجديد؟ اكتبي مثلاً: «أضيفي حقل الدورات التدريبية لرشا قيمته ٣ دورات».");
  const value = markerInfo?.value ?? "";

  let targets: string[];
  if (everyone) targets = ctx.team.members.map(member => member.id);
  else {
    const target = targetMember(ctx, mentions);
    if (!target) return reply(`لمن أضيف حقل «${label}»؟ اكتبي اسم المشرفة، أو «لكل المشرفات».`);
    if ("ask" in target) return target.ask;
    targets = [target.id];
  }

  const changes: ProposalChange[] = [];
  for (const id of targets) {
    const detail = ctx.detail(id);
    if (!detail) continue;
    const existing = profileFieldByLabel(detail, label);
    changes.push({ memberId: id, memberName: detail.name, fieldId: existing?.id ?? null, fieldLabel: existing?.label ?? label, before: existing?.value ?? "", after: value });
  }
  if (!changes.length) return null;
  const result = executePayload(ctx.head, ctx.conversationId, { title: "", summary: "", changes });
  const who = everyone ? "لكل المشرفات" : `لـ ${shortName(changes[0].memberName)}`;
  const blocks = result.blocks.filter(block => block.type === "applied").map(block => ({ ...block, text: `حقل «${label}» ${who}` }));
  return { text: `تم ✅ أضفت حقل «${label}» ${who}${value ? ` بقيمة: ${value}` : " (فارغ — تعبّيه المشرفة)"}.`, blocks };
}

// ---------- Add a member ----------
const NAME_STOP = new Set(["و", "بريدها", "وبريدها", "ايميلها", "وايميلها", "بريد", "ايميل", "البريد", "الايميل", "جوالها", "وجوالها", "رقمها", "ورقمها", "صفتها", "وصفتها", "الصفه", "وظيفتها", "ووظيفتها", "جوال", ",", "،"]);
const TITLE_KEYS = new Set(["صفتها", "وصفتها", "الصفه", "وظيفتها", "ووظيفتها", "وصفة", "صفة"]);

export function addMember(ctx: Ctx): AgentReply | null {
  const add = spanOf(ctx, W.add);
  const noun = spanOf(ctx, W.newMemberNoun);
  if (!add || add.start > 2 || !noun || has(ctx, W.customFieldNoun)) return null;
  const email = ctx.raw.match(EMAIL_PATTERN)?.[0]?.toLowerCase() ?? "";
  const nameKey = ctx.tokens.findIndex(token => ["اسمها", "اسمه", "باسم", "واسمها"].includes(token.norm));
  if (!email && nameKey < 0) return null;

  let start = nameKey >= 0 ? nameKey + 1 : noun.end + 1;
  if (ctx.tokens[start]?.norm.startsWith("جديد")) start += 1;
  const nameTokens: string[] = [];
  for (let i = start; i < ctx.tokens.length; i++) {
    const token = ctx.tokens[i];
    if (NAME_STOP.has(token.norm) || TITLE_KEYS.has(token.norm) || token.norm.includes("@") || /^\+?\d{5,}$/.test(token.norm)) break;
    nameTokens.push(token.raw);
  }
  const name = unquote(nameTokens.join(" "));
  const titleKey = ctx.tokens.findIndex(token => TITLE_KEYS.has(token.norm));
  const titleTokens: string[] = [];
  if (titleKey >= 0) {
    for (let i = titleKey + 1; i < ctx.tokens.length; i++) {
      const token = ctx.tokens[i];
      if (NAME_STOP.has(token.norm) || token.norm.includes("@") || /^\+?\d{5,}$/.test(token.norm)) break;
      titleTokens.push(token.raw);
    }
  }
  const title = unquote(titleTokens.join(" "));
  const phone = westernDigits(ctx.raw).match(/(?:\+?966|0)?5\d{8}/)?.[0] ?? "";

  if (!name) return reply("وش اسم العضوة الجديدة؟ اكتبي مثلاً: «أضيفي عضوة اسمها نورة القحطاني وبريدها noura@gmail.com».");
  if (!email) return reply(`أحتاج بريد ${name} (Gmail) لأنها تدخل به للمنصة. اكتبي مثلاً: «أضيفي عضوة اسمها ${name} وبريدها name@gmail.com».`);
  const existing = ctx.team.members.find(member => member.email.toLowerCase() === email);
  if (existing) return reply(`هذا البريد مسجّل من قبل لـ ${existing.name}.`, choices([{ label: `ملف ${shortName(existing.name)}`, message: `ملف ${existing.name}` }]));

  const result = executePayload(ctx.head, ctx.conversationId, { title: "", summary: "", newMembers: [{ name, email, title, phone }] });
  if (!result.blocks.some(block => block.type === "applied")) return result;
  const applied = result.blocks.find(block => block.type === "applied")!;
  return reply(
    `تم ✅ أضفت ${name} للفريق${title ? ` (${title})` : ""}. تدخل ببريدها ${email} وتختار كلمة المرور أول مرة. هذه رسالة جاهزة ترسلينها لها:`,
    applied.type === "applied" ? { ...applied, text: `إضافة ${shortName(name)} للفريق` } : applied,
    { type: "copy", title: `رسالة دخول — ${shortName(name)}`, text: loginText(ctx.head, { name, email }) },
  );
}

export function deleteMemberHelp(ctx: Ctx): AgentReply | null {
  if (!has(ctx, W.deleteMember)) return null;
  const who = ctx.targetId ? ` ${shortName(ctx.member(ctx.targetId).name)}` : "";
  return reply(`حذف الحساب نهائي ويمسح بياناتها وملفاتها، لذلك يتم من صفحة ملفها${who ? ` (${who.trim()})` : ""} في قائمة الفريق بزر الحذف — حتى لا يُحذف أحد بالخطأ من المحادثة.`);
}

// ---------- Undo ----------
export function undoLast(ctx: Ctx): AgentReply | null {
  if (!has(ctx, W.undo) || words(ctx).length > 6) return null;
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    const message = ctx.history[i];
    if (message.role !== "assistant") continue;
    for (const block of message.blocks) {
      if (block.type !== "applied" || !block.undoProposalId) continue;
      const proposal = getProposal(block.undoProposalId);
      if (!proposal || proposal.status !== "pending" || proposal.userId !== ctx.head.id) continue;
      const result = executeProposal(ctx.head, proposal);
      resolveProposal(proposal.id, "applied", result.text);
      const original = findMessageWithProposal(proposal.id);
      if (original) {
        updateMessageBlocks(original.id, original.blocks.map(item => item.type === "applied" && item.undoProposalId === proposal.id ? { type: "applied", text: `${item.text} — تم التراجع` } : item));
      }
      return result;
    }
  }
  return reply("لا يوجد تعديل حديث في هذه المحادثة أقدر أتراجع عنه.");
}

// ---------- Messages ----------
export function loginText(head: Account, member: { name: string; email: string }) {
  return [
    `السلام عليكم أ. ${firstName(member.name)}`,
    "",
    "حسابك في منصة رَصد جاهز.",
    `الرابط: ${appUrl()}`,
    `البريد: ${member.email}`,
    "أول مرة اختاري كلمة مرور لحسابك، وبعدها ادخلي بها كل مرة.",
    "",
    `— ${head.name}`,
  ].join("\n");
}

export function reminderText(head: Account, member: MemberSummary) {
  const missing = member.missing.slice(0, 6);
  const more = member.missing.length - missing.length;
  return [
    `السلام عليكم أ. ${firstName(member.name)}`,
    "",
    `تذكير لطيف بإكمال ملفك في منصة رَصد — نسبة الاكتمال الآن ${pct(member.completion)}.`,
    missing.length ? `المتبقي: ${missing.join("، ")}${more > 0 ? ` و${ar(more)} غيرها` : ""}.` : "",
    member.activated ? `الرابط: ${appUrl()}` : `ادخلي من ${appUrl()} ببريدك ${member.email} (أول مرة اختاري كلمة مرور).`,
    "",
    `شاكرة تعاونك — ${head.name}`,
  ].filter((line, index, all) => line || all[index - 1]).join("\n");
}

function groupReminder(head: Account, members: MemberSummary[]) {
  const tally = new Map<string, number>();
  for (const member of members) for (const item of member.missing) tally.set(item, (tally.get(item) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([item]) => item);
  return [
    "السلام عليكم زميلاتي الغاليات",
    "",
    `تذكير بإكمال ملفاتكن في منصة رَصد: ${appUrl()}`,
    top.length ? `أكثر ما ينقص: ${top.join("، ")}.` : "",
    "من لم تدخل بعد: تكتب بريدها، وأول مرة تختار كلمة مرور.",
    "",
    `شاكرة تعاونكن — ${head.name}`,
  ].filter((line, index, all) => line || all[index - 1]).join("\n");
}

const ENTER_WORDS = phrases(["دخول", "تدخل", "يدخلن", "دخلت", "تفعيل", "فعلت", "تفعل", "مفعل*"]);
const FIX_WORDS = phrases(["نواقص", "ناقص*", "تكمل", "اكمال", "إكمال", "تعبئة", "تعبي", "اكتمال"]);

export function messages(ctx: Ctx): AgentReply | null {
  const loginAsk = has(ctx, W.login) || (has(ctx, W.message) && has(ctx, ENTER_WORDS) && !has(ctx, W.reminder));
  const reminderAsk = has(ctx, W.reminder) || (has(ctx, W.message) && has(ctx, FIX_WORDS));
  if (!loginAsk && !reminderAsk) return null;
  if (ctx.ambiguous && !ctx.memberIds.length) return askWhich(ctx, ctx.ambiguous);

  // Only an explicit "لها/ذكريها" follows the previous member; "جهّزي رسائل الدخول" alone means everyone who needs one.
  const named = ctx.memberIds.length ? ctx.memberIds : ctx.focusBy === "pronoun" && ctx.targetId ? [ctx.targetId] : [];
  // "جهّزي لهن …" right after a list means the members of that list.
  const listed = !named.length && has(ctx, THEM) ? lastListed(ctx) : [];
  const chosen = named.length ? named.map(ctx.member) : listed;
  const fromList = listed.length > 0 ? " من القائمة السابقة" : "";
  const notActivatedOnly = negated(ctx, spanOf(ctx, ENTER_WORDS)) || (loginAsk && !named.length);

  if (loginAsk || (reminderAsk && notActivatedOnly && !chosen.length)) {
    const pool = chosen.length ? chosen : ctx.team.members;
    const targets = named.length ? pool : pool.filter(member => !member.activated);
    if (!targets.length) {
      return reply(`${fromList ? "كلهن" : "كل المشرفات"} فعّلن حساباتهن 🎉 لا أحد يحتاج رسالة دخول.`, choices([{ label: "جهّزي رسالة تذكير للناقصات", message: "جهّزي رسالة تذكير للي ملفها ناقص" }]));
    }
    const intro = named.length
      ? `هذه رسالة الدخول جاهزة — انسخيها وأرسليها على واتساب:`
      : `جهّزت ${count(targets.length, { one: "رسالة واحدة", two: "رسالتين", few: "رسائل", many: "رسالة" })} دخول لمن لم تفعّل حسابها${fromList}. انسخي كل رسالة وأرسليها لصاحبتها:`;
    return reply(intro, ...targets.map(member => ({ type: "copy" as const, title: `رسالة دخول — ${shortName(member.name)}`, text: loginText(ctx.head, member) })));
  }

  const pool = chosen.length ? chosen : ctx.team.members;
  const targets = (named.length ? pool : pool.filter(member => member.completion < 100)).sort((a, b) => a.completion - b.completion);
  if (!targets.length) return reply(`${fromList ? "ملفاتهن" : "كل الملفات"} مكتملة ١٠٠٪ — لا أحد يحتاج تذكيراً 👏`);
  const blocks: ChatBlock[] = [];
  if (!named.length && targets.length > 1) blocks.push({ type: "copy", title: "رسالة للمجموعة", text: groupReminder(ctx.head, targets) });
  blocks.push(...targets.map(member => ({ type: "copy" as const, title: `تذكير — ${shortName(member.name)} (${pct(member.completion)})`, text: reminderText(ctx.head, member) })));
  const intro = targets.length === 1
    ? `هذه رسالة تذكير لـ ${shortName(targets[0].name)} فيها ما ينقص ملفها بالضبط:`
    : `جهّزت رسالة للمجموعة، ورسالة خاصة لكل واحدة من ${count(targets.length, NOUNS.member)} ملفاتهن ناقصة${fromList} (مرتبة من الأقل اكتمالاً):`;
  return { text: intro, blocks };
}

const THEM = phrases(["لهن", "لهم", "عليهن", "هن", "ذكريهن", "ذكريهم", "كلهن"]);

/** Members of the table shown in the previous reply ("مين ما رفعت ملفات؟" → "جهّزي لهن رسالة تذكير"). */
function lastListed(ctx: Ctx): MemberSummary[] {
  const last = [...ctx.history].reverse().find(message => message.role === "assistant");
  const ids = [...new Set(last?.blocks.flatMap(block => (block.type === "table" ? block.memberIds ?? [] : [])).filter((id): id is string => Boolean(id)))];
  return ids.length >= 2 ? ids.map(id => ctx.team.members.find(member => member.id === id)).filter((member): member is MemberSummary => Boolean(member)) : [];
}

// ---------- Reports ----------
function teamReportText(ctx: Ctx) {
  const { stats, members } = ctx.team;
  const sorted = [...members].sort((a, b) => b.completion - a.completion);
  const top = sorted.filter(member => member.completion > 0).slice(0, 3);
  const low = [...members].sort((a, b) => a.completion - b.completion).slice(0, 5);
  const notActivated = members.filter(member => !member.activated);
  const tally = new Map<string, number>();
  for (const member of members) for (const item of member.missing) tally.set(item, (tally.get(item) ?? 0) + 1);
  const gaps = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lines = [
    "تقرير متابعة فريق الإشراف",
    `التاريخ: ${riyadhDateLabel()}`,
    "",
    "أولاً: الأرقام",
    `- عدد المشرفات: ${ar(stats.members)} (فعّلت ${ar(stats.activated)} منهن حساباتهن، و${ar(stats.notActivated)} لم يدخلن بعد)`,
    `- متوسط اكتمال الملفات: ${pct(stats.averageCompletion)} — المكتملة (٨٥٪ فأكثر): ${ar(stats.completeProfiles)}`,
    `- المدارس المسجّلة: ${ar(stats.schools)}، تضم ${count(stats.students, NOUNS.student)} و${count(stats.teachers, NOUNS.teacher)}`,
    `- الزيارات المسجّلة: ${ar(stats.visits)} — الملفات المرفوعة: ${ar(stats.documents)}`,
    `- حدّثن ملفاتهن اليوم: ${ar(stats.submittedToday)}`,
  ];
  if (top.length) lines.push("", "ثانياً: الأعلى اكتمالاً", ...top.map(member => `- ${shortName(member.name)}: ${pct(member.completion)}`));
  lines.push("", `${top.length ? "ثالثاً" : "ثانياً"}: تحتاج متابعة`);
  if (notActivated.length) lines.push(`- لم يفعّلن الحساب (${ar(notActivated.length)}): ${listText(notActivated.map(member => shortName(member.name)), 8)}`);
  lines.push(`- الأقل اكتمالاً: ${low.map(member => `${shortName(member.name)} (${pct(member.completion)})`).join("، ")}`);
  if (gaps.length) lines.push("", "أكثر البيانات نقصاً:", ...gaps.map(([item, n]) => `- ${item}: ناقص عند ${count(n, NOUNS.member)}`));
  lines.push("", `التوصية: ${notActivated.length ? "إرسال رسائل الدخول لمن لم تفعّل حسابها، ثم " : ""}متابعة استكمال ${gaps[0]?.[0] ?? "البيانات"} خلال الأسبوع.`);
  return lines.join("\n");
}

export function report(ctx: Ctx): AgentReply | null {
  if (!has(ctx, W.report) || has(ctx, W.documentWords) && !has(ctx, W.reportVerb)) return null;
  if (ctx.ambiguous && !ctx.memberIds.length) return askWhich(ctx, ctx.ambiguous);
  if (ctx.targetId) {
    const detail = ctx.detail(ctx.targetId);
    if (!detail) return null;
    const text = [
      `تقرير عن ${detail.name}${detail.title ? ` — ${detail.title}` : ""}`,
      `التاريخ: ${riyadhDateLabel()}`,
      "",
      `- الحساب: ${detail.activated ? "مفعّل" : "لم تفعّله بعد"}`,
      `- اكتمال الملف: ${pct(detail.completion)}`,
      `- المدارس: ${ar(detail.schoolCount)} (${count(detail.studentCount, NOUNS.student)}، ${count(detail.teacherCount, NOUNS.teacher)})`,
      `- الزيارات: ${ar(detail.visitCount)} — الملفات المرفوعة: ${ar(detail.documentCount)}`,
      detail.missing.length ? `- ينقصها: ${detail.missing.join("، ")}` : "- ملفها مكتمل",
    ].join("\n");
    return reply(`جهّزت تقريراً مختصراً عن ${shortName(detail.name)} — انسخيه كما هو:`, { type: "copy", title: `تقرير — ${shortName(detail.name)}`, text });
  }
  const { stats } = ctx.team;
  const intro = `هذا تقرير الفريق حتى اليوم: ${count(stats.members, NOUNS.member)}، فعّلت ${ar(stats.activated)} منهن حساباتهن، ومتوسط اكتمال الملفات ${pct(stats.averageCompletion)}. النص الكامل جاهز للنسخ:`;
  return reply(intro, statsBlock(stats), { type: "copy", title: "تقرير متابعة الفريق", text: teamReportText(ctx) });
}
