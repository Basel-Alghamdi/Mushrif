// Finding which team members a piece of text refers to (fuzzy Arabic names, partial emails).
import { PROFILE_FIELD_WORDS, METRIC_WORDS } from "./lexicon.js";
import { coreWord, levenshtein, normalizeArabic, normalizeText, tokenize, type Token } from "./normalize.js";

export type NamedMember = { id: string; name: string; email: string };

type NameKind = "first" | "last" | "middle";
type NameWord = { core: string; kind: NameKind; article: boolean };
type IndexedMember = NamedMember & { words: NameWord[]; emailLocal: string };
export type NameIndex = { members: IndexedMember[]; byId: Map<string, IndexedMember> };

const FILLER = new Set(["بنت", "بن", "ابن", "ابو", "ام"]);
// Name words that are also everyday words: they only count next to another part of the same name.
const COMMON_WORDS = new Set(["شهري", "سلامي", "عمري", "حسن", "غالب", "سعيد", "علي", "ملحق", "عاقل", "عايش", "ناصر", "منصور", "زياد", "زيد", "محمد", "عبدالله"]);

/** Normalized words of a full name, with "عبد الله" joined and fillers (بنت/بن) removed. */
export function nameWords(fullName: string) {
  return normalizeText(fullName).replace(/(^| )عبد ال/g, "$1عبدال").split(" ").filter(word => word && !FILLER.has(word));
}

export function buildNameIndex(members: NamedMember[]): NameIndex {
  const indexed = members.map(member => {
    const words = nameWords(member.name);
    return {
      ...member,
      emailLocal: member.email.toLowerCase().split("@")[0] ?? "",
      words: words.map((word, index): NameWord => ({
        core: coreWord(word),
        kind: index === 0 ? "first" : index === words.length - 1 ? "last" : "middle",
        article: word !== coreWord(word),
      })),
    };
  });
  return { members: indexed, byId: new Map(indexed.map(member => [member.id, member])) };
}

// Everyday words that must never be "corrected" into a name (السلام → سهام).
const EVERYDAY_WORDS = ["السلام", "سلام", "الله", "الخير", "النور", "الفريق", "الكل", "الجميع", "اليوم", "الوضع", "التقرير", "الرسائل", "التذكير", "المنصة", "الحساب", "الحسابات", "الأعلى", "الأقل", "الأكثر", "الشكر"];
const LEXICON_WORDS = new Set(
  [...Object.values(PROFILE_FIELD_WORDS), ...Object.values(METRIC_WORDS), EVERYDAY_WORDS].flat().flatMap(item => normalizeText(item.replace(/\*/g, "")).split(" ")).map(coreWord),
);

type Hit = { id: string; kind: NameKind | "email"; fuzzy: boolean; core: string };

/** Which members a single token could refer to. */
function tokenHits(token: Token, index: NameIndex, allowFuzzy: boolean): Hit[] {
  if (token.punct) return [];
  const word = token.norm;
  if (word.includes("@")) {
    return index.members.filter(member => member.email.toLowerCase() === word).map(member => ({ id: member.id, kind: "email" as const, fuzzy: false, core: word }));
  }
  if (/^[a-z0-9._+-]{4,}$/.test(word)) {
    return index.members.filter(member => member.emailLocal.includes(word)).map(member => ({ id: member.id, kind: "email" as const, fuzzy: false, core: word }));
  }
  if (/^ى|^على$/.test(token.raw.trim())) return []; // "على" normalizes to the name "علي"
  const cores = new Set(token.variants.map(coreWord).filter(item => item.length >= 2));
  const hits: Hit[] = [];
  for (const member of index.members) {
    const word = member.words.find(item => cores.has(item.core));
    if (word) hits.push({ id: member.id, kind: word.kind, fuzzy: false, core: word.core });
  }
  if (hits.length || !allowFuzzy) return hits;
  // Typo tolerance for family-name-like words (الشهرني → الشهراني). Never for everyday vocabulary.
  const core = coreWord(word);
  if (!/^[؀-ۿ]+$/.test(word) || LEXICON_WORDS.has(core) || !(word.startsWith("ال") ? core.length >= 4 : core.length >= 6)) return [];
  // A word written with "ال" can only be a family name that carries it too — first names never take the article.
  const withArticle = word.startsWith("ال");
  for (const member of index.members) {
    const match = member.words.find(item => item.kind !== "middle" && item.core.length >= 4 && (!withArticle || (item.kind === "last" && item.article))
      && levenshtein(item.core, core) <= (core.length >= 8 ? 2 : 1));
    if (match) hits.push({ id: member.id, kind: match.kind, fuzzy: true, core: match.core });
  }
  return hits;
}

const WEIGHT: Record<Hit["kind"], number> = { email: 10, first: 3, last: 3, middle: 1 };

export type Mention = { start: number; end: number; candidates: string[]; ambiguous: boolean; text: string };

/**
 * Mentions of team members in the token list. Consecutive name words narrow each other down
 * ("فاطمة الدوسري" → one member); a mention matching several members equally is ambiguous ("فاطمة" → 3).
 */
export function findMentions(tokens: Token[], index: NameIndex, options: { until?: number } = {}): Mention[] {
  const limit = options.until ?? tokens.length;
  const hits = tokens.slice(0, limit).map(token => tokenHits(token, index, true));
  const spans: { start: number; end: number; hits: Hit[][]; ids: Set<string> }[] = [];
  let current: { start: number; end: number; hits: Hit[][]; ids: Set<string> } | null = null;
  for (let i = 0; i < hits.length; i++) {
    const ids = new Set(hits[i].map(hit => hit.id));
    if (!ids.size) { current = null; continue; }
    const shared = current ? [...current.ids].filter(id => ids.has(id)) : [];
    if (current && shared.length) {
      current.end = i;
      current.hits.push(hits[i]);
      current.ids = new Set(shared);
    } else {
      current = { start: i, end: i, hits: [hits[i]], ids };
      spans.push(current);
    }
  }

  const mentions: Mention[] = [];
  for (const span of spans) {
    const scores = new Map<string, { score: number; strong: boolean }>();
    for (const tokenHitsList of span.hits) {
      for (const hit of tokenHitsList) {
        if (!span.ids.has(hit.id)) continue;
        const entry = scores.get(hit.id) ?? { score: 0, strong: false };
        entry.score += WEIGHT[hit.kind] * (hit.fuzzy ? 0.6 : 1);
        if (hit.kind !== "middle") entry.strong = true;
        scores.set(hit.id, entry);
      }
    }
    // A lone everyday word ("الشهري" = monthly) only counts as a name with a cue (أ. / المشرفة) or as the whole message.
    const lone = span.start === span.end && tokens.filter(token => !token.punct).length > 2 && !hasTitleCue(tokens, span.start);
    const eligible = [...scores.entries()].filter(([id, entry]) => {
      if (!entry.strong) return false;
      return !(lone && span.hits[0].some(hit => hit.id === id && COMMON_WORDS.has(hit.core)));
    });
    if (!eligible.length) continue;
    const best = Math.max(...eligible.map(([, entry]) => entry.score));
    const candidates = eligible.filter(([, entry]) => entry.score === best).map(([id]) => id);
    mentions.push({
      start: span.start, end: span.end, candidates, ambiguous: candidates.length > 1,
      text: tokens.slice(span.start, span.end + 1).map(token => token.raw).join(" "),
    });
  }
  return mentions;
}

function hasTitleCue(tokens: Token[], at: number) {
  const before = tokens[at - 1]?.norm ?? "";
  return ["ا", "استاذه", "الاستاذه", "المشرفه", "مشرفه", "ابله", "الزميله", "د"].includes(before);
}

/** Unique members mentioned (ambiguous mentions excluded). */
export const resolvedIds = (mentions: Mention[]) => [...new Set(mentions.filter(mention => !mention.ambiguous).map(mention => mention.candidates[0]))];

/**
 * Strict match for a full-name cell in an imported file: the first name (or the family name in a two-word cell)
 * must match, and most words of the cell must belong to the same member. Returns null when unsure.
 */
export function matchFullName(value: string, index: NameIndex): { id: string | null; ambiguous: string[] } {
  const words = nameWords(value).map(coreWord);
  if (!words.length) return { id: null, ambiguous: [] };
  const scored = index.members.map(member => {
    const cores = member.words.map(word => word.core);
    const matched = words.filter(word => cores.includes(word)).length;
    const firstOk = cores[0] === words[0];
    const lastOk = cores[cores.length - 1] === words[words.length - 1];
    return { id: member.id, matched, firstOk, lastOk };
  }).filter(item => {
    if (!item.firstOk && !(item.lastOk && item.matched >= 2)) return false;
    if (words.length >= 3) return item.matched >= Math.min(words.length - 1, 3) || (item.matched >= 2 && item.firstOk && item.lastOk);
    return words.length === 1 ? item.firstOk : item.matched === 2;
  });
  if (!scored.length) return { id: null, ambiguous: [] };
  const best = Math.max(...scored.map(item => item.matched + (item.lastOk ? 0.5 : 0)));
  const top = scored.filter(item => item.matched + (item.lastOk ? 0.5 : 0) === best);
  return top.length === 1 ? { id: top[0].id, ambiguous: [] } : { id: null, ambiguous: top.map(item => item.id) };
}

/** Free-text lookup used by tools: an id, an email, or any part of a name. */
export function lookupMembers(query: string, index: NameIndex): string[] {
  const clean = query.trim();
  if (index.byId.has(clean)) return [clean];
  const email = clean.toLowerCase();
  const byEmail = index.members.filter(member => member.email.toLowerCase() === email);
  if (byEmail.length) return byEmail.map(member => member.id);
  const full = matchFullName(clean, index);
  if (full.id) return [full.id];
  const mentions = findMentions(tokenize(clean), index);
  if (mentions.length) {
    const [first] = mentions.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    return first.candidates;
  }
  const normalized = normalizeArabic(clean);
  return index.members.filter(member => normalizeArabic(member.name).includes(normalized) || member.email.toLowerCase().includes(email)).map(member => member.id);
}
