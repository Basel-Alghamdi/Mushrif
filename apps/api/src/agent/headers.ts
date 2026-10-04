// Recognizing spreadsheet headers and form labels: profile fields, school fields, the member column, or custom fields.
// Pure (no database), shared by the importer and its tests.
import { cleanText } from "../parse.js";
import { findPhrase, phrase, PROFILE_FIELD_TABLE, type Phrase } from "./lexicon.js";
import type { School } from "./model.js";
import { normalizeText, tokenize, westernDigits } from "./normalize.js";

export type SchoolKey = Exclude<keyof School, "id" | "madrasati" | "discipline" | "absence" | "absenceDate" | "customFields" | "staffTiles" | "leadership" | "updatedAt">;
export type Column =
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
  support: ["نوع الدعم", "الدعم"],
  nafes: ["نافس", "نتيجة نافس", "نسبة نافس"],
  qudrat: ["القدرات", "قدرات"],
  tahsili: ["التحصيلي", "تحصيلي"],
  principal: ["مديرة المدرسة", "المديرة", "اسم المديرة", "قائدة المدرسة", "القائدة", "اسم القائدة"],
  notes: ["ملاحظات", "الملاحظات"],
};
// Counts are read as numbers here; indicator values (نافس، القدرات، التحصيلي) stay text so writes.ts can keep a
// non-numeric value ("غير متوفر") as a custom field instead of dropping it.
export const SCHOOL_NUMBERS = new Set<SchoolKey>(["classes", "students", "teachers", "admin", "deputies", "giftedStudents", "giftedClasses"]);
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

export const headerScore = (row: string[]) => row.filter(cell => cell && cell.length <= 60 && classifyHeader(cell).kind !== "custom" && classifyHeader(cell).kind !== "ignore").length;

export function findHeaderRow(rows: string[][]) {
  let best = { index: 0, score: 0 };
  rows.slice(0, 10).forEach((row, index) => {
    const score = headerScore(row);
    if (score > best.score) best = { index, score };
  });
  return best;
}

export const isSequential = (values: string[]) => values.length >= 2 && values.every((value, index) => Number(westernDigits(value)) === index + 1);
