// Domain rules shared by the API (authoritative) and the web client (instant feedback).

/** Arabic-Indic and Persian digits → Western digits. Values are stored with Western digits (SPEC §0.4 rule 8). */
export const toWesternDigits = (value: string) =>
  value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));

/** Today's date (YYYY-MM-DD) in Riyadh, where the district's working day happens. */
export const riyadhDate = (at: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

// ───────────── validation (SPEC §6.5) — each returns an Arabic message or null ─────────────
// The team asked for no blocking formats: emails, IDs, phones, ministry numbers, dates and links accept any text
// (digits are still normalized where they are stored). Only numbers keep their ranges, and a login email needs an "@".
export const messages = {
  email: "اكتبي البريد الإلكتروني كاملاً، مثال: name@gmail.com",
  ministryNoTaken: "الرقم الوزاري مستخدم لمدرسة أخرى",
  percent: "النسبة بين ٠ و١٠٠",
  count: "القيمة يجب أن تكون رقماً",
  label: "الاسم مطلوب (حتى ٢٠٠ حرف)",
} as const;

const anything = (_value: string): string | null => null;

export const validators = {
  /** A free-text email field (البريد الوزاري, school email): any value. */
  email: anything,
  /** The address someone signs in with: anything that looks like an address. */
  loginEmail: (value: string) => (/^\S+@\S+$/.test(toWesternDigits(value.trim())) ? null : messages.email),
  nationalId: anything,
  phone: anything,
  ministryNo: anything,
  hijriDate: anything,
  url: anything,
  label: (value: string) => { const length = value.trim().length; return length >= 1 && length <= 200 ? null : messages.label; },
  percent: (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100 ? null : messages.percent,
  count: (value: unknown) => Number.isInteger(value) && (value as number) >= 0 ? null : messages.count,
};

// ───────────── cluster-file structure ─────────────
export type ProfileFieldType = "text" | "select" | "derived" | "hijri_date";
export type ProfileFieldSeed = { key: string; label: string; span: 1 | 2; type: ProfileFieldType; options?: string[]; value?: string };

export const RANKS = ["خبير", "متقدم", "ممارس متقدم", "ممارس"];

/** The 13 built-in profile fields (SPEC §3.3 Section 1). Members may rename, reorder or delete them. */
export const DEFAULT_PROFILE_FIELDS: ProfileFieldSeed[] = [
  { key: "fullName", label: "الاسم الرباعي", span: 2, type: "text" },
  // Kept in sync with profiles.title (الصفة) by the API.
  { key: "title", label: "الصفة", span: 1, type: "text" },
  { key: "nationalId", label: "السجل المدني", span: 1, type: "text" },
  { key: "employeeNo", label: "الرقم الوظيفي", span: 1, type: "text" },
  { key: "email", label: "البريد الوزاري", span: 2, type: "text" },
  { key: "phone", label: "رقم الجوال", span: 1, type: "text" },
  { key: "rank", label: "الرتبة", span: 1, type: "select", options: RANKS, value: "ممارس" },
  { key: "qualification", label: "المؤهل", span: 1, type: "text" },
  { key: "major", label: "التخصص", span: 1, type: "text" },
  { key: "supervisoryMajor", label: "التخصص الإشرافي", span: 1, type: "text" },
  { key: "hireDate", label: "تاريخ التعيين", span: 1, type: "hijri_date" },
  { key: "supervisionStart", label: "تاريخ التكليف بالإشراف", span: 1, type: "hijri_date" },
  { key: "yearsOfExperience", label: "عدد سنوات الخبرة", span: 1, type: "derived" },
];

/** Validation for a profile field value, chosen by its built-in key (labels are renamable, keys are not). Never blocks today. */
export function validateProfileValue(key: string | null, type: ProfileFieldType, value: string) {
  if (key === "nationalId") return validators.nationalId(value);
  if (key === "phone") return validators.phone(value);
  if (key === "email") return validators.email(value);
  if (type === "hijri_date") return validators.hijriDate(value);
  return null;
}

export const DEFAULT_PLANS = [
  { kind: "realityAnalysis", label: "تقرير تحليل الواقع" },
  { kind: "improvement", label: "خطة التحسين" },
  { kind: "execution1", label: "استمارة تنفيذ الخطة ١" },
  { kind: "execution2", label: "استمارة تنفيذ الخطة ٢" },
  { kind: "execution3", label: "استمارة تنفيذ الخطة ٣" },
];

export const PD_KINDS = { plc: "مجتمع تعلم", workshop: "ورشة عمل", appliedLesson: "درس تطبيقي", other: "برنامج آخر" } as const;
export type PdKind = keyof typeof PD_KINDS;

export const TIERS = ["تميز", "تقدم", "انطلاق", "تهيئة"] as const;
export const STAGES = ["ابتدائية", "متوسطة", "ثانوية"];
export const EDUCATION_TYPES = ["حضوري", "مدمج", "عن بعد"];
export const LEADERSHIP_STATES = ["مفرغة", "مكلفة", "لا يوجد"];

export type SchoolFieldKind = "text" | "email" | "count" | "select" | "boolean" | "ministryNo";
/** Base school info fields; each can be hidden cluster-wide (EDITABILITY S-6). `yes`/`no` label booleans. */
export const SCHOOL_BASE_FIELDS: { key: string; label: string; kind: SchoolFieldKind; options?: string[]; yes?: string; no?: string }[] = [
  { key: "stage", label: "المرحلة", kind: "select", options: STAGES },
  { key: "area", label: "الحي", kind: "text" },
  { key: "ministryNo", label: "الرقم الوزاري", kind: "ministryNo" },
  { key: "ministryEmail", label: "البريد الوزاري", kind: "email" },
  { key: "educationType", label: "نوع التعليم", kind: "select", options: EDUCATION_TYPES },
  { key: "specialEdProgram", label: "برامج التربية الخاصة", kind: "text" },
  { key: "hasGuard", label: "الحارس", kind: "boolean", yes: "يوجد", no: "لا يوجد" },
  { key: "classes", label: "عدد الفصول", kind: "count" },
  { key: "students", label: "عدد الطالبات", kind: "count" },
  { key: "giftedClasses", label: "عدد فصول الموهبة", kind: "count" },
  { key: "giftedStudents", label: "طالبات الموهبة", kind: "count" },
  { key: "teachesChinese", label: "تطبيق اللغة الصينية", kind: "boolean", yes: "نعم", no: "لا" },
];

export const DEFAULT_STAFF_TILES = ["الهيئة التعليمية", "الهيئة الإدارية"];
export const DEFAULT_LEADERSHIP_ROLE = { role: "مديرة المدرسة", state: "مكلفة", fields: ["الاسم", "الجوال"] };
export const NEW_LEADERSHIP_ROLE = { role: "دور جديد", state: "مكلفة", fields: ["الاسم", "الجوال"] };

export const MADRASATI_METRICS = [
  { key: "scheduleAssignment", label: "المعلمات المسندات للجداول" },
  { key: "courseAssignment", label: "المعلمات المسندات للمقررات" },
  { key: "studentAssignment", label: "الطالبات المسندات للفصول" },
  { key: "teacherLogin", label: "دخول المعلمات" },
  { key: "studentLogin", label: "دخول الطالبات" },
  { key: "completion", label: "نسبة الإنجاز" },
] as const;

export const VISIT_TYPES = ["زيارة صفية", "زيارة إشرافية", "متابعة خطة", "ورشة عمل"];

// ───────────── derived values (EDITABILITY Part 4) ─────────────
const hijriParts = (at: Date) => {
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { timeZone: "Asia/Riyadh", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(at);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
};

const gregorianParts = (at: Date) => {
  const [year, month, day] = riyadhDate(at).split("-").map(Number);
  return { year, month, day };
};

/**
 * Whole years since a hire date, or "" when it cannot be read. Accepts `YYYY/MM/DD`, `YYYY-MM-DD`, `DD/MM/YYYY`
 * (any separator among / - . and Arabic-Indic digits) or a bare year. Years 1300–1499 are Hijri, 1900–2100 Gregorian.
 */
export function yearsSinceHijri(hireDate: string, at: Date = new Date()) {
  const parts = toWesternDigits(hireDate.trim()).split(/\s*[/.\-]\s*/).filter(Boolean);
  if (!parts.length || parts.length === 2 || parts.length > 3 || !parts.every(part => /^\d{1,4}$/.test(part))) return "";
  const numbers = parts.map(Number);
  const [year, month, day] = parts.length === 1 ? [numbers[0], 1, 1]
    : parts[0].length === 4 ? numbers
    : parts[2].length === 4 ? [numbers[2], numbers[1], numbers[0]]
    : [NaN, NaN, NaN];
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return "";
  const now = year >= 1300 && year <= 1499 ? hijriParts(at) : year >= 1900 && year <= 2100 ? gregorianParts(at) : null;
  if (!now) return "";
  const years = now.year - year - (now.month < month || (now.month === month && now.day < day) ? 1 : 0);
  return years >= 0 ? String(years) : "";
}

/**
 * Cluster-file completion %: filled items ÷ required items (EDITABILITY Part 4).
 * Required: every non-derived profile field, the core info of each school, each plan's upload, and today's absence per school.
 * A cluster with no schools counts one missing item for "add a school".
 */
export function completionPct(input: {
  profile: { type: string; value: string }[];
  schools: { name: string; stage: string; area: string; ministryNo: string; classes: number; students: number; absenceToday: boolean }[];
  plans: { status: string }[];
}) {
  let filled = 0;
  let total = 0;
  const count = (ok: boolean) => { total += 1; if (ok) filled += 1; };
  for (const field of input.profile) if (field.type !== "derived") count(field.value.trim() !== "");
  if (input.schools.length === 0) count(false);
  for (const school of input.schools) {
    for (const value of [school.name, school.stage, school.area, school.ministryNo]) count(value.trim() !== "");
    count(school.classes > 0);
    count(school.students > 0);
    count(school.absenceToday);
  }
  for (const plan of input.plans) count(plan.status === "uploaded");
  return total ? Math.round((filled / total) * 100) : 0;
}

// API contracts for the agent chat, documents and accounts (type-only).
export type * from "./contracts";
