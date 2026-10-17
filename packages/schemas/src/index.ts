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

/** Seeded for every new member. No longer shown or counted: these files now live in each school's «النموذج الإشرافي». */
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
  { key: "giftedClasses", label: "عدد فصول موهبة", kind: "count" },
  { key: "giftedStudents", label: "عدد طالبات موهبة", kind: "count" },
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

// ───────────── مؤشرات التقويم المدرسي ─────────────
export const SUPPORT_TYPES = ["وفق الاحتياج", "عند الطلب", "الأولى بالتحسين"];

/** The four domains of التقويم المدرسي; each gets a level (TIERS) and its percentage. Keys are stored in evaluation_indicators.domains. */
export const EVALUATION_DOMAINS = [
  { key: "management", label: "الإدارة المدرسية" },
  { key: "teaching", label: "التعليم والتعلم" },
  { key: "outcomes", label: "نواتج التعلم" },
  { key: "environment", label: "البيئة المدرسية" },
] as const;
export type EvaluationDomainKey = (typeof EVALUATION_DOMAINS)[number]["key"];
export type EvaluationDomain = { level: string; percent: number | null };

/** نافس per tested grade: the evaluation column and its label. */
export const NAFES_GRADES = [
  { key: "nafesGrade3", label: "الثالث الابتدائي" },
  { key: "nafesGrade6", label: "السادس الابتدائي" },
  { key: "nafesGrade9", label: "الثالث المتوسط" },
] as const;
export type NafesGradeKey = (typeof NAFES_GRADES)[number]["key"];

/** The visit types offered as chips; «أخرى» on the visit sheet lets her type any other. */
export const VISIT_TYPES = ["زيارة صفية", "زيارة إشرافية", "متابعة خطة", "ورشة عمل", "تحقق"];

// ───────────── ملف الإنجاز: each member's folders, and the folders inside each of her schools ─────────────
// رئيسة النطاق can rename, add, remove and reorder them per member (table `folders`; workspace.folders). Keys are stored
// with each file (attachments.folder) and never reused: a removed folder's files show in «غير مصنّفة» until it is
// restored or they are moved. A folder with a `parent` is a sub-folder: it opens from its parent, which may still hold
// files of its own. The lists below are what every member starts with.
export type FolderKind = "files" | "schools";
export type FolderDef = { key: string; label: string; parent?: string | null; kind?: FolderKind; id?: string };
export type FolderScope = "member" | "school";
/**
 * `member`: her own folders · `school`: the folders each of her schools opens (live ones, in order).
 * `removed`: folders رئيسة النطاق removed (their files wait in «غير مصنّفة», shown with where they were).
 */
export type FolderLayout = { member: readonly FolderDef[]; school: readonly FolderDef[]; removed?: readonly (FolderDef & { scope: FolderScope })[] };

/** Her own folders. «مدارس المشرفة» (kind "schools") holds no files itself: it opens her schools, each with SCHOOL_FOLDERS. */
export const MEMBER_FOLDERS: readonly FolderDef[] = [
  { key: "professional_development", label: "التطوير المهني" },
  { key: "pd_presenter", label: "منفذ", parent: "professional_development" },
  { key: "pd_attendee", label: "مستفيد", parent: "professional_development" },
  { key: "schools_analysis", label: "تحليل وتصنيف مدارس المشرفة" },
  { key: "initiatives", label: "مبادرات المشرفة" },
  { key: "schools", label: "مدارس المشرفة", kind: "schools" },
  { key: "performance_charter", label: "ميثاق الأداء الوظيفي" },
  { key: "visit_plan", label: "خطة الزيارات" },
];
/** The key «مدارس المشرفة» starts with (a member's layout may name it differently: look for kind "schools"). */
export const SCHOOLS_FOLDER = "schools";

export const SCHOOL_FOLDERS: readonly FolderDef[] = [
  { key: "discipline", label: "الانضباط التعليمي" },
  { key: "discipline_accountability", label: "المساءلة", parent: "discipline" },
  { key: "discipline_thanks", label: "الشكر", parent: "discipline" },
  { key: "discipline_plan", label: "خطة الانضباط", parent: "discipline" },
  { key: "discipline_reports", label: "تقارير الانضباط", parent: "discipline" },
  { key: "supervisory_model", label: "النموذج الإشرافي" },
  { key: "supervisory_reality_analysis", label: "تقرير تحليل الواقع", parent: "supervisory_model" },
  { key: "supervisory_improvement_plan", label: "خطة التحسين", parent: "supervisory_model" },
  { key: "supervisory_execution_1", label: "استمارة تنفيذ الخطة ١", parent: "supervisory_model" },
  { key: "supervisory_execution_2", label: "استمارة تنفيذ الخطة ٢", parent: "supervisory_model" },
  { key: "supervisory_execution_3", label: "استمارة تنفيذ الخطة ٣", parent: "supervisory_model" },
  { key: "supervisory_nafes_card", label: "استمارة بطاقة نافس", parent: "supervisory_model" },
  { key: "visit_reports", label: "تقارير الزيارات" },
  { key: "support_plan", label: "خطة دعم المدرسة" },
  { key: "database", label: "قاعدة بيانات المدرسة" },
  { key: "initiatives", label: "مبادرات المدرسة" },
  { key: "commitment_project", label: "مشروع الالتزام التعليمي" },
  { key: "forms", label: "الاستمارات" },
];

/** What a member has before رئيسة النطاق changes anything. */
export const DEFAULT_FOLDERS: FolderLayout = { member: MEMBER_FOLDERS, school: SCHOOL_FOLDERS };

const scopeOf = (inSchool: boolean): FolderScope => (inSchool ? "school" : "member");
const listOf = (layout: FolderLayout, inSchool: boolean) => layout[scopeOf(inSchool)];
const isSchoolsEntry = (folder: FolderDef) => folder.kind === "schools";

/** Her «مدارس المشرفة» entry, or null when رئيسة النطاق removed it (her school folders are then out of reach). */
export const schoolsEntry = (layout: FolderLayout) => layout.member.find(isSchoolsEntry) ?? null;

/** The folders shown first (no parent): hers, or a school's. */
export const topFolders = (layout: FolderLayout, inSchool: boolean) => listOf(layout, inSchool).filter(item => !item.parent);

/** The sub-folders that open from this folder (none for most). */
export const subfoldersOf = (layout: FolderLayout, folder: string, inSchool: boolean) => listOf(layout, inSchool).filter(item => item.parent === folder);

/** This folder and its sub-folders: what the folder's file count covers. */
export const folderFamily = (layout: FolderLayout, folder: string, inSchool: boolean) =>
  [folder, ...subfoldersOf(layout, folder, inSchool).map(item => item.key)];

export const folderParent = (layout: FolderLayout, folder: string, inSchool: boolean) =>
  listOf(layout, inSchool).find(item => item.key === folder)?.parent ?? null;

/**
 * Where a file may be stored: one of her folders (not «مدارس المشرفة» itself), or a folder of one of her schools while
 * she still has «مدارس المشرفة». A sub-folder counts only while its parent is there.
 */
export function isFileFolder(layout: FolderLayout, folder: string, inSchool: boolean) {
  if (inSchool && !schoolsEntry(layout)) return false;
  const list = listOf(layout, inSchool);
  const item = list.find(entry => entry.key === folder);
  if (!item || isSchoolsEntry(item)) return false;
  return !item.parent || list.some(entry => entry.key === item.parent && !entry.parent);
}

export const folderLabel = (layout: FolderLayout, folder: string, inSchool: boolean) =>
  listOf(layout, inSchool).find(item => item.key === folder)?.label ?? "";

/** «الانضباط التعليمي › المساءلة» for a sub-folder, the folder's own label otherwise ("" for an unknown key). */
export function folderTitle(layout: FolderLayout, folder: string, inSchool: boolean) {
  const label = folderLabel(layout, folder, inSchool);
  const parent = folderParent(layout, folder, inSchool);
  return label && parent ? `${folderLabel(layout, parent, inSchool)} › ${label}` : label;
}

/**
 * «التطوير المهني › منفذ», «مدارس المشرفة › الثانوية التاسعة › الانضباط التعليمي», or «غير مصنّف» for a file not in one of
 * her folders (never filed, or its folder was removed). Without a layout the default folders name it.
 */
export function folderPath(file: { folder: string | null; schoolId: string | null; schoolName: string | null }, layout: FolderLayout = DEFAULT_FOLDERS) {
  const inSchool = Boolean(file.schoolId);
  if (!file.folder || !isFileFolder(layout, file.folder, inSchool)) return "غير مصنّف";
  const label = folderTitle(layout, file.folder, inSchool);
  if (!inSchool) return label;
  return [schoolsEntry(layout)!.label, file.schoolName || "مدرسة", label].join(" › ");
}

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
 * Required: every non-derived profile field, the core info of each school, and today's absence per school.
 * The five plan links no longer count: those files live in each school's «النموذج الإشرافي» now.
 * A cluster with no schools counts one missing item for "add a school".
 */
export function completionPct(input: {
  profile: { type: string; value: string }[];
  schools: { name: string; stage: string; area: string; ministryNo: string; classes: number; students: number; absenceToday: boolean }[];
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
  return total ? Math.round((filled / total) * 100) : 0;
}

// مؤشرات الأداء: the district register of school-evaluation indicators.
export * from "./kpis";

// API contracts for the agent chat, documents and accounts (type-only).
export type * from "./contracts";
