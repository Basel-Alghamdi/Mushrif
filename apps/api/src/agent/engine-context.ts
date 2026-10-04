// Parsed view of Khulood's message that every local-engine handler works from.
import type { ChatBlock, ChatMessage } from "@rasd/schemas";
import type { Actor } from "../auth.js";
import { allDetails, detailOf, type TeamSnapshot } from "./data.js";
import { firstSpan, hasAny, METRIC_TABLE, phrases, PROFILE_FIELD_TABLE, scan, W, type MetricId, type Phrase, type Span } from "./lexicon.js";
import type { MemberDetail, MemberSummary, Session } from "./model.js";
import { findMentions, resolvedIds, type Mention } from "./names.js";
import { tokenize, type Token } from "./normalize.js";
import type { AgentReply } from "./proposals.js";
import { ar, choices, shortName } from "./render.js";

/** One message to answer: who asks (and where changes go), the team as read for this message, and the conversation so far. */
export type EngineInput = { session: Session; team: TeamSnapshot; history: ChatMessage[]; text: string };

export type Ctx = {
  session: Session;
  head: Actor;
  conversationId: string | null;
  history: ChatMessage[];
  raw: string;
  tokens: Token[];
  team: TeamSnapshot;
  mentions: Mention[];
  memberIds: string[]; // members named unambiguously, in order of appearance
  ambiguous: Mention | null;
  fields: { key: string; span: Span }[];
  metrics: { key: MetricId; span: Span }[];
  /** The member this message is about: named, or the one discussed just before ("وجوالها؟"). */
  targetId: string | null;
  fromFocus: boolean;
  /** "pronoun" when the follow-up points at her explicitly ("جوالها"), "topic" for a bare topic ("والمدارس؟"). */
  focusBy: "pronoun" | "topic" | null;
  member: (id: string) => MemberSummary;
  detail: (id: string) => MemberDetail | null;
  details: () => MemberDetail[];
};

// "مادخلت" → "ما" + "دخلت" so negation is seen as its own word.
const FUSED_NEGATION = /^(ما|لم)(دخل|فعل|سجل|عب|كمل|اكمل|ارسل|رفع|اضاف|ضاف|حدث|عدل|كتب)/;

function splitFusedNegation(tokens: Token[]) {
  const out: Token[] = [];
  for (const token of tokens) {
    const match = token.norm.match(FUSED_NEGATION);
    if (match && token.norm.length > match[1].length + 2) {
      const rest = token.norm.slice(match[1].length);
      out.push({ ...token, raw: match[1], norm: match[1], variants: [match[1]] });
      out.push({ ...token, raw: token.raw.slice(match[1].length), norm: rest, variants: [rest] });
    } else out.push(token);
  }
  return out.map((token, index) => ({ ...token, index }));
}

// Not "الي": it is also how "إلى" normalizes ("غيري جوالها إلى …").
const TEAM_WORDS = phrases(["الفريق", "المشرفات", "العضوات", "الكل", "كل", "جميع", "جميعهن", "كلهن", "مين", "منهن", "اللي", "التي"]);
const FOCUS_PRONOUNS = phrases(["هي", "عنها", "لها", "عندها", "حقها", "تبعها", "ملفها", "حسابها"]);

/** Members a stored message is about: its member card, a one-row table, or the names in its text. */
function messageMembers(message: ChatMessage, team: TeamSnapshot): string[] {
  const member = message.blocks.find(block => block.type === "member");
  if (member?.type === "member") return [member.memberId];
  const tables = message.blocks.filter(block => block.type === "table");
  const tableIds = [...new Set(tables.flatMap(block => (block.type === "table" ? block.memberIds ?? [] : [])).filter((id): id is string => Boolean(id)))];
  if (tableIds.length > 1) return tableIds;
  const textIds = resolvedIds(findMentions(tokenize(message.text), team.index));
  return [...new Set([...tableIds, ...textIds])];
}

/** The member the conversation was last about, following a chain of follow-ups ("ملف رشا" → "وجوالها؟" → "وش ناقصها؟"). */
function lastFocus(history: ChatMessage[], team: TeamSnapshot): string | null {
  for (let i = history.length - 1; i >= Math.max(0, history.length - 8); i--) {
    const ids = messageMembers(history[i], team);
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) return null;
  }
  return null;
}

const TEAM_LEVEL = [...W.rankHigh, ...W.rankLow, ...W.rankVerb, ...W.overview, ...W.average, ...phrases(["عدد", "مجموع", "إجمالي", "اجمالي", "المرفوعة", "الكل"])];

function refersToFocus(ctx: Pick<Ctx, "tokens" | "fields" | "metrics" | "mentions">): Ctx["focusBy"] {
  const words = ctx.tokens.filter(token => !token.punct);
  const teamLevel = hasAny(ctx.tokens, TEAM_WORDS) || hasAny(ctx.tokens, TEAM_LEVEL) || ctx.metrics.some(metric => metric.key === "members");
  if (ctx.mentions.length || teamLevel || words[0]?.norm === "من") return null; // "كم مشرفة فعّلت حسابها؟" is about the team
  const pronoun = words.some(token => token.norm.length >= 4 && token.norm.endsWith("ها")) || hasAny(ctx.tokens, FOCUS_PRONOUNS);
  const topic = ctx.fields.length > 0 || ctx.metrics.some(metric => metric.key !== "members") || hasAny(ctx.tokens, W.incomplete);
  if (pronoun && words.length <= 8) return "pronoun";
  return topic && words.length <= 4 ? "topic" : null;
}

// A qualifier anywhere in the message refines a generic field: "ايميل منال الوزاري" → moe_email, "رقم رشا الوظيفي" → employee_no.
const FIELD_QUALIFIERS: { from: string[]; to: string; words: Phrase[] }[] = [
  { from: ["email"], to: "moe_email", words: phrases(["الوزاري", "الوزارة", "الرسمي", "وزاري"]) },
  { from: ["major"], to: "supervision_major", words: phrases(["الإشرافي", "اشرافي"]) },
  { from: ["phone"], to: "employee_no", words: phrases(["الوظيفي", "وظيفي"]) },
  { from: ["phone"], to: "national_id", words: phrases(["المدني", "الهوية", "هويتها"]) },
];

function qualifyFields(tokens: Token[], fields: Ctx["fields"]): Ctx["fields"] {
  return fields.map(field => {
    const rule = FIELD_QUALIFIERS.find(item => item.from.includes(field.key) && hasAny(tokens, item.words));
    return rule && !fields.some(other => other.key === rule.to) ? { ...field, key: rule.to } : field;
  });
}

export function buildContext(input: EngineInput): Ctx {
  const { team } = input;
  const tokens = splitFusedNegation(tokenize(input.text));
  const mentions = findMentions(tokens, team.index);
  const memberIds = resolvedIds(mentions);
  const fields = qualifyFields(tokens, scan(tokens, PROFILE_FIELD_TABLE));
  const metrics = scan(tokens, METRIC_TABLE);
  const byId = new Map(team.members.map(member => [member.id, member]));

  let targetId: string | null = memberIds[0] ?? null;
  let focusBy: Ctx["focusBy"] = null;
  if (!targetId) {
    const reason = refersToFocus({ tokens, fields, metrics, mentions });
    targetId = reason ? lastFocus(input.history, team) : null;
    focusBy = targetId ? reason : null;
  }

  return {
    session: input.session,
    head: input.session.head,
    conversationId: input.session.conversationId,
    history: input.history,
    raw: input.text.trim(),
    tokens,
    team,
    mentions,
    memberIds,
    ambiguous: mentions.find(mention => mention.ambiguous) ?? null,
    fields,
    metrics,
    targetId,
    fromFocus: focusBy !== null,
    focusBy,
    member: id => byId.get(id)!,
    detail: id => detailOf(team, id),
    details: () => allDetails(team),
  };
}

export const has = (ctx: Ctx, list: Parameters<typeof hasAny>[1]) => hasAny(ctx.tokens, list);
export const spanOf = (ctx: Ctx, list: Parameters<typeof firstSpan>[1]) => firstSpan(ctx.tokens, list);
export const metric = (ctx: Ctx, key: MetricId) => ctx.metrics.some(item => item.key === key);
export const words = (ctx: Ctx) => ctx.tokens.filter(token => !token.punct);

const NEGATIONS = new Set(["لم", "ما", "مو", "مب", "غير", "بدون", "ليس", "ليست", "بلا", "لسه", "للحين", "مازالت", "مازال", "ماعد", "ولا"]);

/** True when one of the two words before the span negates it ("ما دخلت", "لم تعبي"، "بدون مدارس"). */
export function negated(ctx: Ctx, span: Span | null) {
  if (!span) return false;
  return [span.start - 1, span.start - 2].some(index => index >= 0 && NEGATIONS.has(ctx.tokens[index].norm));
}

/** A number written in the message (Arabic or western digits), e.g. "أعلى ٣". */
export function smallNumber(ctx: Ctx) {
  const token = ctx.tokens.find(item => /^\d{1,2}$/.test(item.norm));
  return token ? Number(token.norm) : null;
}

/** Repeats Khulood's message with the ambiguous name replaced by each full name, as quick replies. */
export function askWhich(ctx: Ctx, mention: Mention, question = "قصدك مين؟"): AgentReply {
  const first = ctx.tokens[mention.start];
  const particle = /^[وفبلك]/.test(first.norm) && !mention.candidates.some(id => ctx.member(id).name.startsWith(first.raw[0])) ? first.raw[0] : "";
  const before = ctx.tokens.slice(0, mention.start).map(token => token.raw).join(" ");
  const after = ctx.tokens.slice(mention.end + 1).map(token => token.raw).join(" ");
  const options = mention.candidates.map(id => {
    const member = ctx.member(id);
    return { label: member.name, message: [before, `${particle}${member.name}`, after].filter(Boolean).join(" ").replace(/\s+([؟?!،,:])/g, "$1") };
  });
  const names = mention.candidates.map(id => shortName(ctx.member(id).name));
  const howMany = names.length === 2 ? "اثنتان" : ar(names.length);
  return { text: `${question} عندنا ${howMany} بهذا الاسم: ${names.join("، ")}.`, blocks: [choices(options, "اختاري المقصودة")] };
}

export const reply = (text: string, ...blocks: (ChatBlock | null | undefined | false)[]): AgentReply => ({ text, blocks: blocks.filter((block): block is ChatBlock => Boolean(block)) });
