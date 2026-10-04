// Arabic formatting helpers and chat block builders shared by both brains.
import { riyadhDate, type ChatBlock, type ChatTone, type DocumentInfo } from "@rasd/schemas";
import { env } from "../env.js";
import type { MemberDetail, MemberSummary, TeamStats } from "./model.js";

const arabicNumber = new Intl.NumberFormat("ar-SA", { useGrouping: true, maximumFractionDigits: 1 });

/** Arabic-Indic digits (١٢٣). */
export const ar = (value: number) => arabicNumber.format(value);
export const pct = (value: number) => `${ar(Math.round(value))}٪`;

type Noun = { one: string; two: string; few: string; many: string; twoGen?: string; oneAcc?: string };
export const NOUNS = {
  member: { one: "مشرفة واحدة", two: "مشرفتان", twoGen: "مشرفتين", few: "مشرفات", many: "مشرفة" },
  school: { one: "مدرسة واحدة", two: "مدرستان", twoGen: "مدرستين", few: "مدارس", many: "مدرسة" },
  student: { one: "طالبة واحدة", two: "طالبتان", twoGen: "طالبتين", few: "طالبات", many: "طالبة" },
  teacher: { one: "معلمة واحدة", two: "معلمتان", twoGen: "معلمتين", few: "معلمات", many: "معلمة" },
  visit: { one: "زيارة واحدة", two: "زيارتان", twoGen: "زيارتين", few: "زيارات", many: "زيارة" },
  file: { one: "ملف واحد", oneAcc: "ملفاً واحداً", two: "ملفان", twoGen: "ملفين", few: "ملفات", many: "ملفاً" },
  value: { one: "قيمة واحدة", two: "قيمتان", twoGen: "قيمتين", few: "قيم", many: "قيمة" },
  field: { one: "حقل واحد", oneAcc: "حقلاً واحداً", two: "حقلان", twoGen: "حقلين", few: "حقول", many: "حقلاً" },
  program: { one: "برنامج واحد", oneAcc: "برنامجاً واحداً", two: "برنامجان", twoGen: "برنامجين", few: "برامج", many: "برنامجاً" },
  row: { one: "صف واحد", oneAcc: "صفاً واحداً", two: "صفان", twoGen: "صفين", few: "صفوف", many: "صفاً" },
  page: { one: "صفحة واحدة", two: "صفحتان", twoGen: "صفحتين", few: "صفحات", many: "صفحة" },
  completeFile: { one: "ملف واحد مكتمل", two: "ملفان مكتملان", few: "ملفات مكتملة", many: "ملفاً مكتملاً" },
} satisfies Record<string, Noun>;

/** Arabic counted noun: "مشرفة واحدة"، "مشرفتان"، "٣ مشرفات"، "١٥ مشرفة". */
export function count(value: number, noun: Noun) {
  if (value === 1) return noun.one;
  if (value === 2) return noun.two;
  return countRest(value, noun);
}

/** Same, after a preposition ("عند مشرفتين"، "في مدرستين"). */
export function countGen(value: number, noun: Noun) {
  return value === 2 ? noun.twoGen ?? noun.two : count(value, noun);
}

/** Same, as the object of a verb ("حفظت ملفاً واحداً"، "حدّثت قيمتين"). */
export function countAcc(value: number, noun: Noun) {
  return value === 1 ? noun.oneAcc ?? noun.one : countGen(value, noun);
}

function countRest(value: number, noun: Noun) {
  const rest = value % 100;
  return `${ar(value)} ${rest >= 3 && rest <= 10 ? noun.few : noun.many}`;
}

/** "فعّلت واحدة منهن حسابها"، "فعّلت اثنتان منهن حسابيهما"، "فعّلت ٥ منهن حساباتهن". */
export function activatedText(activated: number) {
  if (!activated) return "لم تفعّل أي واحدة منهن حسابها بعد";
  if (activated === 1) return "فعّلت واحدة منهن حسابها";
  if (activated === 2) return "فعّلت اثنتان منهن حسابيهما";
  return `فعّلت ${ar(activated)} منهن حساباتهن`;
}

/** "٤٥٠ طالبة و٣٣ معلمة", leaving out a count nobody entered yet (never "٠ معلمة"). */
export function peopleText(students: number, teachers: number) {
  return [students ? count(students, NOUNS.student) : "", teachers ? count(teachers, NOUNS.teacher) : ""].filter(Boolean).join(" و");
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** First + family name ("رشا القرني") — distinct for every member of the roster. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(part => !["بنت", "بن"].includes(part));
  return parts.length <= 2 ? parts.join(" ") : `${parts[0]} ${parts[parts.length - 1]}`;
}

/** The calendar day (YYYY-MM-DD) of a moment in Riyadh, and today's. */
export const riyadhDay = (iso: string) => riyadhDate(new Date(iso));
export const today = () => riyadhDate();

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "لم يحدث بعد";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "قبل لحظات";
  if (minutes < 60) return minutes === 1 ? "قبل دقيقة" : minutes === 2 ? "قبل دقيقتين" : `قبل ${ar(minutes)} ${minutes <= 10 ? "دقائق" : "دقيقة"}`;
  const hours = Math.round(minutes / 60);
  if (riyadhDay(iso) === today()) return hours <= 1 ? "قبل ساعة" : hours === 2 ? "قبل ساعتين" : `قبل ${ar(hours)} ${hours <= 10 ? "ساعات" : "ساعة"}`;
  return dayLabel(iso);
}

/** Calendar-day wording: "اليوم"، "أمس"، "قبل ٣ أيام"، "قبل ١٢ يوماً". */
export function dayLabel(iso: string) {
  const days = Math.round((Date.parse(today()) - Date.parse(riyadhDay(iso))) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  if (days === 2) return "قبل يومين";
  return `قبل ${ar(days)} ${days <= 10 ? "أيام" : "يوماً"}`;
}

export function riyadhDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
}

export const appUrl = () => env.appUrl;

export function listText(items: string[], max = 6) {
  if (!items.length) return "";
  // Hiding a single item behind «و١ غيرها» saves nothing — show it instead.
  const shown = items.length - max === 1 ? items : items.slice(0, max);
  const rest = items.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join("، ")} و${shown[shown.length - 1]}` : shown[0];
  return rest > 0 ? `${shown.join("، ")} و${ar(rest)} غيرها` : joined;
}

export const completionTone = (value: number): ChatTone => (value >= 85 ? "ok" : value >= 50 ? "warn" : "bad");

// ---------- Blocks ----------
export function statsBlock(stats: TeamStats, title = "أرقام الفريق"): ChatBlock {
  return {
    type: "stats",
    title,
    items: [
      // The first four are the headline numbers (the chat shows them first, the rest behind "كل الأرقام").
      { label: "المشرفات", value: stats.members },
      { label: "فعّلن حساباتهن", value: stats.activated, tone: stats.activated === stats.members ? "ok" : "neutral" },
      { label: "متوسط الاكتمال", value: pct(stats.averageCompletion), tone: completionTone(stats.averageCompletion) },
      { label: "حدّثن اليوم", value: stats.submittedToday },
      { label: "لم يفعّلن بعد", value: stats.notActivated, tone: stats.notActivated ? "warn" : "ok" },
      { label: "ملفات مكتملة", value: stats.completeProfiles, hint: "اكتمال ٨٥٪ فأكثر" },
      { label: "المدارس", value: stats.schools },
      { label: "الطالبات", value: stats.students },
      { label: "المعلمات", value: stats.teachers },
      { label: "الزيارات", value: stats.visits },
      { label: "الملفات المرفوعة", value: stats.documents },
    ],
  };
}

export const activationLabel = (member: MemberSummary) => (member.activated ? "مفعّل" : "لم تدخل بعد");

export function membersTable(members: MemberSummary[], title?: string): ChatBlock {
  return {
    type: "table",
    title,
    columns: ["الاسم", "الصفة", "الحساب", "الاكتمال", "المدارس"],
    rows: members.map(member => [member.name, member.title || "—", activationLabel(member), pct(member.completion), member.schoolCount]),
    memberIds: members.map(member => member.id),
  };
}

export function memberBlock(detail: MemberDetail): ChatBlock {
  const skip = new Set(["name", "title", "email", "phone"]);
  const fields = detail.workspace.profile
    .filter(field => !skip.has(field.id) && String(field.value ?? "").trim())
    .map(field => ({ label: field.label, value: String(field.value) }));
  return {
    type: "member",
    memberId: detail.id,
    name: detail.name,
    title: detail.title,
    email: detail.email,
    phone: detail.phone,
    activated: detail.activated,
    completion: detail.completion,
    missing: detail.missing,
    fields,
    schools: detail.workspace.schools.map(school => ({ name: school.name, stage: school.stage, students: Number(school.students) || 0, teachers: Number(school.teachers) || 0, tier: school.tier })),
    documents: detail.documents.map(document => ({ id: document.id, name: document.name, kind: document.kind, createdAt: document.createdAt })),
  };
}

/** A document's excerpt without the "## <sheet>" headings that spreadsheet text starts with. */
export function cleanExcerpt(document: Pick<DocumentInfo, "excerpt" | "sheets">, max = 160) {
  let text = document.excerpt;
  for (const sheet of document.sheets ?? []) text = text.split(`## ${sheet}`).join(" ");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

export function documentsBlock(items: (Pick<DocumentInfo, "id" | "name" | "kind" | "ownerName" | "createdAt"> & { snippet?: string })[], title?: string): ChatBlock {
  return { type: "documents", title, items: items.map(item => ({ id: item.id, name: item.name, kind: item.kind, ownerName: item.ownerName, createdAt: item.createdAt, ...(item.snippet ? { snippet: item.snippet } : {}) })) };
}

export function choices(options: { label: string; message?: string }[], prompt?: string): ChatBlock {
  return { type: "choices", ...(prompt ? { prompt } : {}), options: options.map(option => ({ label: option.label, message: option.message ?? option.label })) };
}

/** Compact text rendering of blocks — used to remind the Claude brain what an earlier reply showed. */
export function blocksAsText(blocks: ChatBlock[]) {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "stats") lines.push(`[${block.title ?? "أرقام"}] ${block.items.map(item => `${item.label}: ${item.value}`).join(" · ")}`);
    else if (block.type === "table") {
      lines.push(`[جدول${block.title ? `: ${block.title}` : ""}] ${block.columns.join(" | ")}`);
      for (const row of block.rows.slice(0, 15)) lines.push(row.join(" | "));
      if (block.rows.length > 15) lines.push(`… و${block.rows.length - 15} صفوف أخرى`);
    } else if (block.type === "member") lines.push(`[ملف ${block.name} · id=${block.memberId}] الاكتمال ${block.completion}٪ · ينقصها: ${block.missing.join("، ") || "لا شيء"}`);
    else if (block.type === "choices") lines.push(`[اقتراحات] ${block.options.map(option => option.label).join(" / ")}`);
    else if (block.type === "proposal") lines.push(`[اقتراح تعديل · ${block.status}] ${block.title} — ${block.summary}`);
    else if (block.type === "copy") lines.push(`[نص للنسخ: ${block.title}] ${block.text.slice(0, 300)}`);
    else if (block.type === "documents") lines.push(`[ملفات] ${block.items.map(item => `${item.name} (id=${item.id}${item.ownerName ? `، ${item.ownerName}` : ""})`).join("، ")}`);
    else if (block.type === "applied") lines.push(`[تم التنفيذ] ${block.text}`);
  }
  return lines.join("\n");
}
