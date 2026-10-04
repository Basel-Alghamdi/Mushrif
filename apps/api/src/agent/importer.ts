// Reads files dropped into the chat and turns them into profile/school changes for the right members.
import type { ChatBlock, MemberDetail, ProposalChange, School } from "@rasd/schemas";
import type { Account } from "../accounts.js";
import { cleanText, normalizeEmail } from "../db.js";
import type { DocumentTable, StoredDocument } from "../documents.js";
import { detailOf, normalizeFieldValue, profileField, type TeamSnapshot } from "./data.js";
import { findPhrase, phrase, PROFILE_FIELD_TABLE, type Phrase } from "./lexicon.js";
import { findMentions, matchFullName, resolvedIds } from "./names.js";
import { comparable, EMAIL_PATTERN, normalizeText, tokenize, westernDigits } from "./normalize.js";
import { executePayload, proposeChanges, type AgentReply, type DocumentAssignment, type NewMemberSuggestion, type ProposalPayload, type SchoolUpsert } from "./proposals.js";
import { ar, choices, count, countAcc, countGen, NOUNS, shortName } from "./render.js";

export const OWNER_PROMPT = "هذا الملف يخص من؟";
const NEW_VALUE = { one: "قيمة جديدة واحدة", two: "قيمتان جديدتان", twoGen: "قيمتين جديدتين", few: "قيم جديدة", many: "قيمة جديدة" };

// ---------- Header recognition ----------
type SchoolKey = Exclude<keyof School, "id" | "madrasati" | "discipline" | "absence" | "absenceDate" | "customFields" | "staffTiles" | "leadership" | "updatedAt">;
type Column =
  | { kind: "profile"; fieldId: string; label: string }
  | { kind: "school"; key: SchoolKey; label: string }
  | { kind: "member"; label: string }
  | { kind: "custom"; label: string }
  | { kind: "ignore"; label: string };

const SCHOOL_HEADERS: Partial<Record<SchoolKey, string[]>> = {
  name: ["اسم المدرسة", "المدرسة", "school"],
  stage: ["المرحلة", "المرحلة الدراسية", "stage"],
  area: ["الحي", "المنطقة", "الموقع", "المكتب"],
  ministryNo: ["الرقم الوزاري", "رقم المدرسة", "الرقم الإحصائي", "رمز المدرسة"],
  email: ["بريد المدرسة", "ايميل المدرسة"],
  educationType: ["نوع التعليم", "نوع المدرسة"],
  specialEducation: ["التربية الخاصة"],
  hasGuard: ["حارس", "يوجد حارس"],
  classes: ["عدد الفصول", "الفصول"],
  students: ["عدد الطالبات", "الطالبات", "عدد الطلاب", "الطلاب"],
  teachers: ["عدد المعلمات", "المعلمات", "عدد المعلمين", "المعلمين"],
  admin: ["عدد الإداريات", "الإداريات", "الإداريين"],
  deputies: ["عدد الوكيلات", "الوكيلات"],
  giftedStudents: ["عدد الموهوبات", "الموهوبات"],
  tier: ["التصنيف", "تصنيف المدرسة", "مستوى المدرسة"],
  principal: ["مديرة المدرسة", "المديرة", "اسم المديرة", "قائدة المدرسة", "القائدة", "اسم القائدة"],
  notes: ["ملاحظات", "الملاحظات"],
};
const SCHOOL_NUMBERS = new Set<SchoolKey>(["classes", "students", "teachers", "admin", "deputies", "giftedStudents", "giftedClasses", "expert", "advanced", "qudrat", "tahsili"]);
const MEMBER_COLUMN = ["اسم المشرفة", "المشرفة", "اسم العضوة", "العضوة", "المسؤولة", "المشرفة المسؤولة", "اسم المسؤولة"].map(phrase);
const IGNORED_HEADERS = new Set(["م", "#", "ت", "ر", "no", "رقم", "الرقم", "التسلسل", "تسلسل", "الرقم التسلسلي", "طابع زمني", "الطابع الزمني", "timestamp"].map(item => normalizeText(item)));
const SCHOOL_TABLE = (Object.entries(SCHOOL_HEADERS) as [SchoolKey, string[]][]).flatMap(([key, list]) => list.map(item => ({ key, phrase: phrase(item) })));

/** Share of the header's words covered by the phrase (0 when absent). */
function coverage(header: string, target: Phrase) {
  const tokens = tokenize(header).filter(token => !token.punct);
  if (!tokens.length) return 0;
  const span = findPhrase(tokens, target);
  return span ? (span.end - span.start + 1) / tokens.length : 0;
}

export function classifyHeader(header: string): Column {
  const label = cleanText(header);
  const normalized = normalizeText(label);
  if (!normalized || IGNORED_HEADERS.has(normalized)) return { kind: "ignore", label };
  let best: { column: Column; score: number } = { column: { kind: "custom", label }, score: 0 };
  const consider = (column: Column, target: Phrase) => {
    const score = coverage(label, target);
    if (score > best.score || (score === best.score && score > 0 && target.words.length > 1)) best = { column, score };
  };
  for (const entry of SCHOOL_TABLE) consider({ kind: "school", key: entry.key, label }, entry.phrase);
  for (const target of MEMBER_COLUMN) consider({ kind: "member", label }, target);
  for (const entry of PROFILE_FIELD_TABLE) consider({ kind: "profile", fieldId: entry.key, label }, entry.phrase);
  return best.score >= 0.5 ? best.column : { kind: "custom", label };
}

const headerScore = (row: string[]) => row.filter(cell => cell && cell.length <= 60 && classifyHeader(cell).kind !== "custom" && classifyHeader(cell).kind !== "ignore").length;

function findHeaderRow(rows: string[][]) {
  let best = { index: 0, score: 0 };
  rows.slice(0, 10).forEach((row, index) => {
    const score = headerScore(row);
    if (score > best.score) best = { index, score };
  });
  return best;
}

const isSequential = (values: string[]) => values.length >= 2 && values.every((value, index) => Number(westernDigits(value)) === index + 1);

// ---------- Value helpers ----------
const cleanValue = normalizeFieldValue;

function sameValue(fieldId: string | null, a: string, b: string) {
  if (fieldId === "phone") return westernDigits(a).replace(/\D/g, "").replace(/^(966|0)/, "") === westernDigits(b).replace(/\D/g, "").replace(/^(966|0)/, "");
  return comparable(a) === comparable(b);
}

function parseNumber(value: string) {
  const number = Number(westernDigits(value).replace(/[٬,\s]/g, "").replace("٫", "."));
  return Number.isFinite(number) ? number : null;
}

/** Profile change for one value, or null when it is empty, unchanged, or would shorten the name. */
function profileChange(detail: MemberDetail, column: { fieldId: string | null; label: string }, raw: string, source: string): ProposalChange | null {
  const value = cleanValue(column.fieldId, raw);
  if (!value) return null;
  const field = column.fieldId
    ? profileField(detail, column.fieldId)
    : detail.workspace.profile.find(item => comparable(item.label) === comparable(column.label)) ?? null;
  if (field?.derived) return null;
  const before = field?.value ?? "";
  if (sameValue(column.fieldId, before, value)) return null;
  if (column.fieldId === "name" && before && value.split(/\s+/).length < before.split(/\s+/).length) return null;
  return { memberId: detail.id, memberName: detail.name, fieldId: field?.id ?? null, fieldLabel: field?.label ?? column.label, before, after: value, source };
}

// ---------- Analysis ----------
type FileAnalysis = {
  document: StoredDocument;
  description: string;
  changes: ProposalChange[];
  newMembers: NewMemberSuggestion[];
  unmatched: string[];
  schools: SchoolUpsert[];
  owner: { id: string; name: string } | null;
  ownerCandidates: string[]; // ambiguous owner (e.g. "فاطمة")
  needsOwner: boolean;
  notes: string[];
};

type ImportContext = { head: Account; team: TeamSnapshot; text: string; forcedMemberId?: string };

function detailCache(head: Account) {
  const cache = new Map<string, MemberDetail | null>();
  return (id: string) => {
    if (!cache.has(id)) cache.set(id, detailOf(head.id, id));
    return cache.get(id) ?? null;
  };
}

function describeDocument(document: StoredDocument) {
  if (document.status === "failed") return `لم أستطع قراءة «${document.name}»`;
  if (document.kind === "spreadsheet") {
    const rows = document.tables.reduce((sum, table) => sum + table.rows.length, 0);
    return `قرأت «${document.name}» (${document.tables.length === 1 ? "ورقة واحدة" : `${ar(document.tables.length)} أوراق`}، ${count(rows, NOUNS.row)})`;
  }
  if (document.kind === "image" || document.kind === "audio") return `استلمت «${document.name}»`;
  return `قرأت «${document.name}»${document.pages ? ` (${ar(document.pages)} صفحات)` : ""}`;
}

/** Member a document refers to: forced → Khulood's message → file name → name/email values → names in the text. */
function identifyOwner(context: ImportContext, document: StoredDocument, pairs: { label: string; value: string }[]) {
  if (context.forcedMemberId) return { id: context.forcedMemberId, candidates: [] as string[] };
  const fromText = findMentions(tokenize(context.text), context.team.index);
  const textIds = resolvedIds(fromText);
  if (textIds.length === 1) return { id: textIds[0], candidates: [] };
  const ambiguous = fromText.find(mention => mention.ambiguous)?.candidates ?? [];
  const fileIds = resolvedIds(findMentions(tokenize(document.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ")), context.team.index));
  if (fileIds.length === 1) return { id: fileIds[0], candidates: [] };
  for (const pair of pairs) {
    const column = classifyHeader(pair.label);
    if (column.kind === "profile" && column.fieldId === "email") {
      const email = pair.value.match(EMAIL_PATTERN)?.[0]?.toLowerCase();
      const member = context.team.members.find(item => item.email.toLowerCase() === email);
      if (member) return { id: member.id, candidates: [] };
    }
    if ((column.kind === "profile" && column.fieldId === "name") || column.kind === "member") {
      const match = matchFullName(pair.value, context.team.index);
      if (match.id) return { id: match.id, candidates: [] };
    }
  }
  const body = document.text.slice(0, 20000);
  const strong = findMentions(tokenize(body), context.team.index).filter(mention => !mention.ambiguous && (mention.end > mention.start || mention.text.includes("@")));
  const bodyIds = [...new Set(strong.map(mention => mention.candidates[0]))];
  if (bodyIds.length === 1) return { id: bodyIds[0], candidates: [] };
  return { id: null, candidates: ambiguous };
}

/** "label: value" lines and two/four-column tables. */
export function extractPairs(document: StoredDocument) {
  const pairs: { label: string; value: string }[] = [];
  for (const line of document.text.split(/\r?\n/)) {
    for (const piece of line.split(/\t|\s{3,}|\s\|\s/)) {
      const match = piece.match(/^\s*[-•*]?\s*([^:：]{2,40}?)\s*[:：]\s*(.{1,200})$/);
      if (match && cleanText(match[2])) pairs.push({ label: cleanText(match[1]), value: cleanText(match[2]) });
    }
  }
  for (const table of document.tables) {
    for (const row of table.rows) {
      const cells = row.map(cleanText);
      if (cells.length === 2 && cells[0] && cells[1]) pairs.push({ label: cells[0], value: cells[1] });
      if (cells.length === 4) {
        if (cells[0] && cells[1]) pairs.push({ label: cells[0], value: cells[1] });
        if (cells[2] && cells[3]) pairs.push({ label: cells[2], value: cells[3] });
      }
    }
  }
  return pairs;
}

function pairChanges(detail: MemberDetail, pairs: { label: string; value: string }[], source: string) {
  const known = pairs.map(pair => ({ pair, column: classifyHeader(pair.label) }));
  const recognized = known.filter(item => item.column.kind === "profile");
  // Unknown labels become custom fields only in documents that look like a profile form.
  const allowCustom = recognized.length >= 2;
  const changes = new Map<string, ProposalChange>();
  for (const { pair, column } of known) {
    if (pair.value.length > 150) continue;
    let change: ProposalChange | null = null;
    if (column.kind === "profile") change = profileChange(detail, { fieldId: column.fieldId, label: column.label }, pair.value, source);
    else if (column.kind === "custom" && allowCustom && pair.label.length <= 30) change = profileChange(detail, { fieldId: null, label: pair.label }, pair.value, source);
    if (change) changes.set(change.fieldId ?? comparable(change.fieldLabel), change);
  }
  return [...changes.values()];
}

function analyzeTable(context: ImportContext, document: StoredDocument, table: DocumentTable, analysis: FileAnalysis, detail: (id: string) => MemberDetail | null): "roster" | "schools" | "generic" {
  const { index: headerIndex } = findHeaderRow(table.rows);
  const header = table.rows[headerIndex] ?? [];
  const body = table.rows.slice(headerIndex + 1).filter(row => row.some(Boolean));
  const columns = header.map(cell => classifyHeader(cell));
  columns.forEach((column, index) => {
    if (column.kind === "custom" && (!column.label || isSequential(body.map(row => row[index] ?? "")))) columns[index] = { kind: "ignore", label: column.label };
  });

  const emailColumn = columns.findIndex(column => column.kind === "profile" && column.fieldId === "email");
  let nameColumn = columns.findIndex(column => column.kind === "member");
  if (nameColumn < 0) nameColumn = columns.findIndex(column => column.kind === "profile" && column.fieldId === "name");
  if (nameColumn < 0 && emailColumn < 0) {
    // No recognizable key header: pick the column whose values match the most members.
    let best = { index: -1, hits: 0 };
    header.forEach((_, index) => {
      const hits = body.filter(row => matchFullName(row[index] ?? "", context.team.index).id).length;
      if (hits > best.hits) best = { index, hits };
    });
    if (best.index >= 0 && best.hits >= Math.max(1, body.length / 2)) nameColumn = best.index;
  }
  const isSchoolTable = columns.some(column => column.kind === "school" && column.key === "name") && columns.filter(column => column.kind === "school").length >= 2;
  const source = (rowNumber: number) => `${document.name}${document.tables.length > 1 ? ` · ${table.sheet}` : ""} · الصف ${ar(rowNumber)}`;

  const rowMember = (row: string[]) => {
    const email = emailColumn >= 0 ? normalizeEmail(row[emailColumn]) : "";
    if (email) {
      const member = context.team.members.find(item => item.email.toLowerCase() === email);
      if (member) return member.id;
    }
    return nameColumn >= 0 ? matchFullName(row[nameColumn] ?? "", context.team.index).id : null;
  };

  if (isSchoolTable) {
    const fallbackOwner = context.forcedMemberId ?? (() => {
      const ids = resolvedIds(findMentions(tokenize(`${context.text} ${table.sheet} ${document.name.replace(/\.[a-z0-9]+$/i, "")}`), context.team.index));
      return ids.length === 1 ? ids[0] : null;
    })();
    const grouped = new Map<string, Partial<School>[]>();
    const orphans: string[] = [];
    body.forEach(row => {
      const memberId = (nameColumn >= 0 || emailColumn >= 0 ? rowMember(row) : null) ?? fallbackOwner;
      const school: Partial<School> = {};
      const custom: { id: string; label: string; value: string }[] = [];
      columns.forEach((column, index) => {
        const value = cleanText(row[index]);
        if (!value) return;
        if (column.kind === "school") {
          if (SCHOOL_NUMBERS.has(column.key)) {
            const number = parseNumber(value);
            if (number !== null) (school as Record<string, unknown>)[column.key] = number;
          } else (school as Record<string, unknown>)[column.key] = value;
        } else if (column.kind === "custom") custom.push({ id: "", label: column.label, value });
      });
      if (!school.name) return;
      if (custom.length) school.customFields = custom;
      if (!memberId) { orphans.push(`مدرسة ${school.name}`); return; }
      grouped.set(memberId, [...(grouped.get(memberId) ?? []), school]);
    });
    for (const [memberId, schools] of grouped) {
      const member = detail(memberId);
      if (member) analysis.schools.push({ memberId, memberName: member.name, schools, source: document.name });
    }
    // No row says whose schools these are: ask once for the whole file instead of listing every school as unmatched.
    if (!grouped.size && orphans.length) analysis.needsOwner = true;
    else analysis.unmatched.push(...orphans);
    return "schools";
  }
  if (nameColumn < 0 && emailColumn < 0) return "generic";

  // Roster-like table: one row per member.
  const changes = new Map<string, ProposalChange>();
  body.forEach((row, rowIndex) => {
    const rowNumber = headerIndex + rowIndex + 2;
    const memberId = rowMember(row);
    if (!memberId) {
      const name = nameColumn >= 0 ? cleanText(row[nameColumn]) : "";
      const email = emailColumn >= 0 ? normalizeEmail(row[emailColumn]) : "";
      const label = name || email || row.find(Boolean) || "";
      if (!label) return;
      analysis.unmatched.push(label);
      if (name && email && EMAIL_PATTERN.test(email)) analysis.newMembers.push(newMemberFrom(columns, row, name, email, source(rowNumber)));
      return;
    }
    const member = detail(memberId);
    if (!member) return;
    columns.forEach((column, index) => {
      if (column.kind !== "profile" && column.kind !== "custom") return;
      const fieldId = column.kind === "profile" ? column.fieldId : null;
      const change = profileChange(member, { fieldId, label: column.label }, row[index] ?? "", source(rowNumber));
      if (change) changes.set(`${memberId}:${change.fieldId ?? comparable(change.fieldLabel)}`, change);
    });
  });
  analysis.changes.push(...changes.values());
  return "roster";
}

function newMemberFrom(columns: Column[], row: string[], name: string, email: string, source: string): NewMemberSuggestion {
  const suggestion: NewMemberSuggestion = { name, email, fields: [], source };
  columns.forEach((column, index) => {
    const value = cleanText(row[index]);
    if (!value) return;
    if (column.kind === "profile") {
      if (column.fieldId === "title") suggestion.title = value;
      else if (column.fieldId === "phone") suggestion.phone = cleanValue("phone", value);
      else if (column.fieldId === "cluster") suggestion.clusterLabel = value;
      else if (!["name", "email"].includes(column.fieldId)) suggestion.fields!.push({ fieldId: column.fieldId, fieldLabel: column.label, value: cleanValue(column.fieldId, value) });
    } else if (column.kind === "custom") suggestion.fields!.push({ fieldId: null, fieldLabel: column.label, value });
  });
  return suggestion;
}

/** A two-column sheet whose first column holds profile labels is a single member's form, not a roster. */
function looksLikeForm(table: DocumentTable) {
  const twoColumn = table.rows.filter(row => row.filter(Boolean).length === 2);
  return twoColumn.length >= 2 && twoColumn.filter(row => classifyHeader(row[0]).kind === "profile").length >= 2 && headerScore(table.rows[0] ?? []) < 2;
}

export function analyzeDocument(context: ImportContext, document: StoredDocument, detail = detailCache(context.head)): FileAnalysis {
  const analysis: FileAnalysis = { document, description: describeDocument(document), changes: [], newMembers: [], unmatched: [], schools: [], owner: null, ownerCandidates: [], needsOwner: false, notes: [] };
  if (document.status === "failed") return analysis;

  if (document.kind === "spreadsheet") {
    // Rosters and school lists are handled row by row; any other sheet is treated as one member's document.
    const structured = document.tables.filter(table => !looksLikeForm(table) && analyzeTable(context, document, table, analysis, detail) !== "generic");
    if (structured.length) return analysis;
  }

  // Documents (Word/PDF/text/images, or a single-member form sheet): find the owner, read label/value pairs.
  const pairs = document.kind === "image" || document.kind === "audio" ? [] : extractPairs(document);
  const owner = identifyOwner(context, document, pairs);
  if (!owner.id) {
    analysis.needsOwner = !document.ownerId;
    analysis.ownerCandidates = owner.candidates;
    return analysis;
  }
  const member = detail(owner.id);
  if (!member) return analysis;
  analysis.owner = { id: member.id, name: member.name };
  analysis.changes.push(...pairChanges(member, pairs, document.name));
  if (document.kind === "image" || document.kind === "audio") analysis.notes.push("قراءة النص من الصور والتسجيلات تحتاج تفعيل Claude (مفتاح ANTHROPIC_API_KEY)، لذلك حفظت الملف في ملفها فقط");
  return analysis;
}

// ---------- Reply ----------
function ownerQuestion(context: ImportContext, document: StoredDocument, candidates: string[]): ChatBlock {
  const ids = candidates.length ? candidates : context.team.members.map(member => member.id);
  const options = ids.map(id => context.team.index.byId.get(id)!).filter(Boolean).map(member => ({
    label: candidates.length ? member.name : shortName(member.name),
    message: `الملف «${document.name}» يخص ${member.name}`,
  }));
  return choices(options, `${OWNER_PROMPT} «${document.name}»`);
}

/** Handles the files attached to Khulood's message (both brains use this). */
export function importAttachments(context: ImportContext & { conversationId: string; documents: StoredDocument[] }): AgentReply {
  const detail = detailCache(context.head);
  const analyses = context.documents.map(document => analyzeDocument(context, document, detail));
  const lines: string[] = analyses.map(analysis => `- ${analysis.description}`);
  const blocks: ChatBlock[] = [];

  const payload: ProposalPayload = { title: "", summary: "", changes: [], newMembers: [], unmatched: [], schools: [], assignments: [] };
  const immediate: DocumentAssignment[] = [];
  for (const analysis of analyses) {
    payload.changes!.push(...analysis.changes);
    payload.newMembers!.push(...analysis.newMembers);
    payload.unmatched!.push(...analysis.unmatched);
    payload.schools!.push(...analysis.schools);
    const owner = analysis.owner;
    if (owner && analysis.document.ownerId !== owner.id) {
      const assignment = { documentId: analysis.document.id, documentName: analysis.document.name, memberId: owner.id, memberName: owner.name };
      // A file that only needs filing is filed right away; one that also fills data waits for approval with its changes.
      if (analysis.changes.length) payload.assignments!.push(assignment);
      else immediate.push(assignment);
    }
  }

  // Rows that become new accounts are not "unmatched" — only the ones nothing can be done with.
  const suggested = new Set(payload.newMembers!.map(member => comparable(member.name)));
  payload.unmatched = payload.unmatched!.filter(label => !suggested.has(comparable(label)));

  const members = new Map([...payload.changes!, ...payload.schools!].map(item => [item.memberId, item.memberName]));
  const schoolCount = payload.schools!.reduce((sum, item) => sum + item.schools.length, 0);
  const parts: string[] = [];
  if (payload.changes!.length) parts.push(countAcc(payload.changes!.length, NEW_VALUE));
  if (schoolCount) parts.push(`بيانات ${countGen(schoolCount, NOUNS.school)}`);
  const forWhom = members.size === 1 ? shortName([...members.values()][0]) : countGen(members.size, NOUNS.member);
  const fresh = payload.newMembers!;
  const summaryParts = [
    parts.length ? `وجدت ${parts.join(" و")} لـ ${forWhom}` : "",
    fresh.length === 1 ? `«${fresh[0].name}» ليست في الفريق بعد — تُضاف عضوةً جديدة عند الاعتماد` : "",
    fresh.length > 1 ? `${count(fresh.length, { one: "اسم واحد", two: "اسمان", few: "أسماء", many: "اسماً" })} ليست في الفريق بعد — تُضاف عضوات جديدات عند الاعتماد` : "",
  ].filter(Boolean);

  if (payload.changes!.length || payload.newMembers!.length || schoolCount || payload.assignments!.length) {
    const fileNames = context.documents.map(document => `«${document.name}»`).join("، ");
    payload.title = `تحديث البيانات من ${fileNames}`;
    payload.summary = summaryParts.join("، و") || "ربط الملف بملف المشرفة";
    const kind = schoolCount && !payload.changes!.length ? "school_updates" : payload.newMembers!.length && !payload.changes!.length ? "new_members" : "import";
    blocks.push(proposeChanges(context.head, context.conversationId, kind, payload));
    lines.push("", `${payload.summary}. راجعي التغييرات واعتمديها بضغطة واحدة، أو ألغيها إن لم تناسبك.`);
  } else if (analyses.some(analysis => analysis.document.kind === "spreadsheet" && !analysis.needsOwner && analysis.document.status === "ready")) {
    lines.push("", "قارنت الملف ببيانات المنصة — كل القيم فيه مطابقة لما هو مسجّل، فلا يوجد شيء جديد لإضافته.");
  }
  if (payload.unmatched.length) {
    const shown = payload.unmatched.slice(0, 8).join("، ");
    const more = payload.unmatched.length > 8 ? ` و${ar(payload.unmatched.length - 8)} غيرها` : "";
    lines.push(`لم أطابق مع أحد في الفريق: ${shown}${more}. إن كانت إحداهن عضوة جديدة فأضيفيها مع بريدها، مثلاً: «أضيفي عضوة اسمها … وبريدها …».`);
  }

  if (immediate.length) {
    const filed = executePayload(context.head, context.conversationId, { title: "", summary: "", assignments: immediate });
    lines.push("", immediate.map(item => `حفظت «${item.documentName}» في ملف ${shortName(item.memberName)} — صار يظهر في ملفاتها ويمكن البحث فيه.`).join("\n"));
    blocks.push(...filed.blocks.filter(block => block.type === "applied"));
  }

  for (const analysis of analyses) for (const note of analysis.notes) lines.push(`ملاحظة: ${note}.`);
  const failed = analyses.filter(analysis => analysis.document.status === "failed");
  if (failed.length) lines.push("تأكدي أن الملف غير محمي بكلمة مرور، أو احفظيه بصيغة أخرى (xlsx أو docx أو pdf) وأعيدي رفعه.");

  const unknown = analyses.find(analysis => analysis.needsOwner);
  if (unknown) {
    lines.push("", unknown.ownerCandidates.length
      ? `«${unknown.document.name}» يخص أي واحدة منهن؟`
      : `لم أعرف لمن «${unknown.document.name}». اختاري المشرفة وأنا أحفظه في ملفها وأعبّي بياناته.`);
    blocks.push(ownerQuestion(context, unknown.document, unknown.ownerCandidates));
  } else if (!blocks.some(block => block.type === "proposal") && !immediate.length && !failed.length) {
    blocks.push(choices([{ label: "أرقام الفريق" }, { label: "نواقص الفريق" }]));
  }
  return { text: lines.join("\n").trim(), blocks };
}

/** The attachment Khulood was asked about ("هذا الملف يخص من؟"), when her new message answers that question. */
export function pendingOwnerQuestion(history: { role: string; blocks: ChatBlock[]; attachments: { id: string; name: string }[] }[]) {
  const last = history[history.length - 1];
  if (!last || last.role !== "assistant") return null;
  const question = last.blocks.find((block): block is Extract<ChatBlock, { type: "choices" }> => block.type === "choices" && Boolean(block.prompt?.startsWith(OWNER_PROMPT)));
  if (!question) return null;
  const name = question.prompt!.match(/«(.+)»/)?.[1] ?? "";
  for (let i = history.length - 2; i >= 0; i--) {
    const message = history[i];
    if (message.role !== "user" || !message.attachments.length) continue;
    return message.attachments.find(attachment => attachment.name === name) ?? message.attachments[0];
  }
  return null;
}
