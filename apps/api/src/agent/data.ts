// Data tools over the database, shared by the local engine, the importer and the Claude brain.
import type { MemberCreateInput, MemberDetail, MemberSummary, ProfileField, School, TeamResponse, Visit } from "@rasd/schemas";
import { type Account, createMember, deleteMember, findAccountById, updateMember } from "../accounts.js";
import { cleanText, newId, now, riyadhDay, today } from "../db.js";
import { assignDocument, documentsForHead, type StoredDocument } from "../documents.js";
import { memberDetail, teamForHead } from "../team.js";
import { DEFAULT_PROFILE, getWorkspace, saveWorkspace } from "../workspaces.js";
import type { MetricId } from "./lexicon.js";
import { buildNameIndex, type NameIndex } from "./names.js";
import { comparable, normalizeText, variantsOf, westernDigits } from "./normalize.js";

// ---------- Reading ----------
export type TeamSnapshot = TeamResponse & { index: NameIndex };

export function teamSnapshot(headId: string): TeamSnapshot {
  const team = teamForHead(headId);
  return { ...team, index: buildNameIndex(team.members) };
}

/** The member account when it belongs to this head's team. */
export function memberAccount(headId: string, memberId: string): Account | null {
  const account = findAccountById(memberId);
  return account && account.role === "member" && account.headId === headId ? account : null;
}

export const detailOf = (headId: string, memberId: string): MemberDetail | null => memberDetail(headId, memberId);

export function allDetails(headId: string, team: TeamResponse): MemberDetail[] {
  return team.members.map(member => memberDetail(headId, member.id)).filter((detail): detail is MemberDetail => Boolean(detail));
}

export const builtInField = (fieldId: string) => DEFAULT_PROFILE.find(field => field.id === fieldId) ?? null;

/** Light tidy-up before a value is stored (western digits, 05… phones, lowercase emails). Never rejects anything. */
export function normalizeFieldValue(fieldId: string | null, value: string) {
  let clean = cleanText(value);
  if (fieldId === "phone") {
    const digits = westernDigits(clean).replace(/[^\d+]/g, "");
    if (/^5\d{8}$/.test(digits)) clean = `0${digits}`;
    else if (digits.length >= 9) clean = digits;
  }
  if (fieldId === "email" || fieldId === "moe_email") clean = clean.toLowerCase();
  if (fieldId === "national_id" || fieldId === "employee_no") clean = westernDigits(clean).replace(/\.0+$/, "");
  if (fieldId === "hire_date" || fieldId === "assignment_date") clean = westernDigits(clean);
  return clean;
}

export function profileField(detail: MemberDetail, fieldId: string): ProfileField | null {
  return detail.workspace.profile.find(field => field.id === fieldId) ?? null;
}

/** A custom (or built-in) profile field of this member whose label appears in the text. */
export function profileFieldByLabel(detail: MemberDetail, text: string): ProfileField | null {
  const haystack = ` ${normalizeText(text)} `;
  const candidates = detail.workspace.profile
    .filter(field => normalizeText(field.label).length >= 3 && haystack.includes(` ${normalizeText(field.label)} `))
    .sort((a, b) => b.label.length - a.label.length);
  return candidates[0] ?? null;
}

export function metricValue(member: MemberSummary, metric: MetricId): number {
  switch (metric) {
    case "schools": return member.schoolCount;
    case "students": return member.studentCount;
    case "teachers": return member.teacherCount;
    case "visits": return member.visitCount;
    case "documents": return member.documentCount;
    case "programs": return member.programCount;
    case "absence": return member.absenceDoneToday;
    case "missing": return member.missing.length;
    case "activated": return member.activated ? 1 : 0;
    case "submitted": return member.submittedToday ? 1 : 0;
    default: return member.completion;
  }
}

export type MemberFilter =
  | "not_activated" | "activated" | "complete" | "incomplete" | "submitted_today" | "not_submitted_today"
  | "no_schools" | "no_documents" | "no_visits";

export const FILTER_LABELS: Record<MemberFilter, string> = {
  not_activated: "لم يفعّلن حساباتهن بعد",
  activated: "فعّلن حساباتهن",
  complete: "ملفاتهن مكتملة (٨٥٪ فأكثر)",
  incomplete: "ملفاتهن غير مكتملة",
  submitted_today: "حدّثن اليوم",
  not_submitted_today: "لم يحدّثن شيئاً اليوم",
  no_schools: "لم يضفن مدارس بعد",
  no_documents: "لم يرفعن أي ملف",
  no_visits: "لم يسجّلن زيارات",
};

export function filterMembers(members: MemberSummary[], filter: MemberFilter) {
  const test: Record<MemberFilter, (member: MemberSummary) => boolean> = {
    not_activated: member => !member.activated,
    activated: member => member.activated,
    complete: member => member.completion >= 85,
    incomplete: member => member.completion < 85,
    submitted_today: member => member.submittedToday,
    not_submitted_today: member => !member.submittedToday,
    no_schools: member => member.schoolCount === 0,
    no_documents: member => member.documentCount === 0,
    no_visits: member => member.visitCount === 0,
  };
  return members.filter(test[filter]);
}

/** Members who changed something in their file today (version 1 = never saved since the account was created). */
/** Members who did something themselves today (edited their file, logged a visit, uploaded). */
export function updatedToday(details: MemberDetail[]) {
  return details.filter(detail => detail.submittedToday);
}

/** Members whose profile field (by built-in id or by label) is empty. */
export function membersMissingField(details: MemberDetail[], fieldId: string | null, label: string) {
  const wanted = comparable(label);
  return details.filter(detail => {
    const field = fieldId ? profileField(detail, fieldId) : detail.workspace.profile.find(item => comparable(item.label) === wanted);
    return !field || !String(field.value ?? "").trim();
  });
}

// ---------- Search ----------
const SEARCH_STOPWORDS = new Set(
  ["عن", "في", "من", "علي", "الي", "ان", "او", "و", "ابحثي", "ابحث", "بحث", "دوري", "فتشي", "الملفات", "ملفات", "الملف", "ملف", "كلمه", "كلمة", "اللي", "التي", "الذي", "فيها", "فيه", "كل", "وين", "اين", "يذكر", "مذكور", "مكتوب", "ذكر", "لي", "ابي", "ابغي", "ودي", "المرفقات", "المستندات", "داخل", "جميع", "تحتوي", "يحتوي", "هل", "وش", "ايش", "شو", "ماهو", "ماهي", "كيف", "ليش", "لماذا", "متى", "عندي", "عندنا", "اللي", "ممكن", "لو", "سمحت", "فضلك"]
    .map(word => normalizeText(word)),
);

/** Words worth searching for (2-letter words like "ما" would match inside almost anything; numbers always count). */
export function searchTerms(query: string) {
  return normalizeText(query).split(" ").filter(word => (word.length >= 3 || /^\d+$/.test(word)) && !SEARCH_STOPWORDS.has(word)).map(word => {
    const forms = variantsOf(word).filter(form => form.length >= 2);
    return forms.sort((a, b) => a.length - b.length)[0] ?? word;
  });
}

/** The words of a search request worth showing back ("ابحثي في الملفات عن نافس" → "نافس"). */
export function searchPhrase(query: string) {
  return query.split(/\s+/).filter(word => {
    const normalized = normalizeText(word);
    return normalized.length >= 2 && !SEARCH_STOPWORDS.has(normalized);
  }).join(" ").replace(/[؟?!.،,]+$/g, "");
}

export type DocumentHit ={ document: StoredDocument; snippets: string[]; where: string; score: number };

function snippetOf(line: string, term: string) {
  const clean = line.replace(/\s+/g, " ").trim();
  if (clean.length <= 220) return clean;
  const at = Math.max(0, normalizeText(clean).indexOf(term) - 80);
  return `${at > 0 ? "…" : ""}${clean.slice(at, at + 220).trim()}…`;
}

/** Full-text search over every document the head can see (team files + her own uploads). */
export function searchDocuments(headId: string, query: string, options: { memberId?: string; limit?: number; requireAll?: boolean } = {}): DocumentHit[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const documents = documentsForHead(headId).filter(document => !options.memberId || document.ownerId === options.memberId);
  const hits: (DocumentHit & { matched: number })[] = [];
  for (const document of documents) {
    const name = normalizeText(document.name);
    const lines = document.text.split(/\r?\n/);
    const matchedTerms = new Set<string>();
    const snippets: string[] = [];
    let sheet = "";
    let where = "";
    let occurrences = 0;
    for (const term of terms) if (name.includes(term)) matchedTerms.add(term);
    for (const line of lines) {
      if (line.startsWith("## ")) { sheet = line.slice(3).trim(); continue; }
      const normalized = normalizeText(line);
      const found = terms.filter(term => normalized.includes(term));
      if (!found.length) continue;
      found.forEach(term => matchedTerms.add(term));
      occurrences += found.length;
      if (snippets.length < 2) {
        snippets.push(snippetOf(line, found[0]));
        if (!where && sheet) where = `ورقة «${sheet}»`;
      }
    }
    if (!matchedTerms.size) continue;
    hits.push({ document, snippets, where, matched: matchedTerms.size, score: matchedTerms.size * 100 + Math.min(occurrences, 50) });
  }
  const required = options.requireAll ? terms.length : Math.max(1, Math.ceil(terms.length * (hits.some(hit => hit.matched === terms.length) ? 1 : 0.5)));
  return hits.filter(hit => hit.matched >= required).sort((a, b) => b.score - a.score).slice(0, options.limit ?? 8)
    .map(({ matched: _matched, ...hit }) => hit);
}

/** A document whose name best matches the text ("ملف خطة الزيارات" → خطة الزيارات.docx). */
export function findDocumentByName(headId: string, text: string): StoredDocument | null {
  const terms = searchTerms(text.replace(/\.[a-z0-9]{2,5}\b/gi, ""));
  if (!terms.length) return null;
  let best: { document: StoredDocument; score: number } | null = null;
  for (const document of documentsForHead(headId)) {
    const name = normalizeText(document.name.replace(/\.[a-z0-9]{2,5}$/i, ""));
    const score = terms.filter(term => name.includes(term)).length / terms.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { document, score };
  }
  return best?.document ?? null;
}

export type VisitHit = Visit & { memberId: string; memberName: string };

export function searchVisits(details: MemberDetail[], query = ""): VisitHit[] {
  const terms = searchTerms(query);
  return details.flatMap(detail => detail.visits.map(visit => ({ ...visit, memberId: detail.id, memberName: detail.name })))
    .filter(visit => {
      if (!terms.length) return true;
      const haystack = normalizeText(`${visit.type} ${visit.schoolName} ${visit.text} ${visit.blockers}`);
      return terms.some(term => haystack.includes(term));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Writing ----------
export type FieldWrite = { fieldId: string | null; fieldLabel: string; value: string };
export type FieldResult = { fieldId: string; fieldLabel: string; before: string; after: string; created: boolean; error?: string };

function findFieldIndex(profile: ProfileField[], write: FieldWrite) {
  if (write.fieldId) {
    const byId = profile.findIndex(field => field.id === write.fieldId);
    if (byId >= 0) return byId;
  }
  const label = comparable(write.fieldLabel);
  return label ? profile.findIndex(field => comparable(field.label) === label) : -1;
}

/**
 * Sets profile fields of one member (creating custom fields for unknown labels) without a version check.
 * The login email goes through updateMember so the account and the profile stay in step.
 */
export function writeProfileFields(account: Account, writes: FieldWrite[]): FieldResult[] {
  const profile = [...getWorkspace(account).profile];
  const results: FieldResult[] = [];
  let emailChange: { value: string; result: FieldResult } | null = null;
  for (const write of writes) {
    const value = String(write.value ?? "").trim();
    const index = findFieldIndex(profile, write);
    if (index >= 0) {
      const field = profile[index];
      if (field.derived) {
        results.push({ fieldId: field.id, fieldLabel: field.label, before: field.value, after: field.value, created: false, error: "هذا الحقل يُحسب تلقائياً" });
        continue;
      }
      const result: FieldResult = { fieldId: field.id, fieldLabel: field.label, before: field.value, after: value, created: false };
      results.push(result);
      if (field.id === "email") { emailChange = { value, result }; continue; }
      profile[index] = { ...field, value, updatedAt: now() };
    } else {
      const label = write.fieldLabel.trim() || builtInField(write.fieldId ?? "")?.label || "حقل";
      const builtIn = write.fieldId ? builtInField(write.fieldId) : null;
      const field: ProfileField = builtIn
        ? { ...builtIn, value, updatedAt: now() }
        : { id: newId(), label, value, kind: "text", custom: true, updatedAt: now() };
      profile.push(field);
      results.push({ fieldId: field.id, fieldLabel: field.label, before: "", after: value, created: true });
    }
  }
  if (results.some(result => !result.error && result.fieldId !== "email")) saveWorkspace(account, { profile });
  if (emailChange) {
    try { updateMember(account.id, { email: emailChange.value }); }
    catch (error) {
      emailChange.result.after = emailChange.result.before;
      emailChange.result.error = (error as Error).message === "ACCOUNT_EXISTS" ? "هذا البريد مستخدم لحساب آخر" : "البريد مطلوب لتسجيل الدخول";
    }
  }
  return results;
}

export type FieldRestore = { fieldId: string; fieldLabel: string; value: string; remove?: boolean };

/** Puts earlier values back (used by undo); fields created by the change are removed again. */
export function restoreProfileFields(account: Account, values: FieldRestore[]) {
  let profile = [...getWorkspace(account).profile];
  let email: string | null = null;
  for (const item of values) {
    if (item.remove) { profile = profile.filter(field => field.id !== item.fieldId); continue; }
    if (item.fieldId === "email") { email = item.value; continue; }
    const index = findFieldIndex(profile, item);
    if (index >= 0) profile[index] = { ...profile[index], value: item.value, updatedAt: now() };
    else profile.push({ id: item.fieldId, label: item.fieldLabel, value: item.value, kind: "text", custom: true, updatedAt: now() });
  }
  saveWorkspace(account, { profile });
  if (email) {
    try { updateMember(account.id, { email }); } catch { /* the old address was taken meanwhile: keep the current one */ }
  }
}

export function createTeamMember(headId: string, input: MemberCreateInput) {
  return createMember(headId, input);
}

export function removeTeamMember(headId: string, memberId: string) {
  return memberAccount(headId, memberId) ? deleteMember(memberId) : false;
}

export function assignDocumentTo(documentId: string, ownerId: string | null) {
  return assignDocument(documentId, ownerId);
}

export function saveSchools(account: Account, schools: School[]) {
  return saveWorkspace(account, { schools });
}
