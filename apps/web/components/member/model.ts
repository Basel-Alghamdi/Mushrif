import type { ProfileField, School, SchoolLeader, Workspace } from "@rasd/schemas";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const riyadhDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
/** Today's calendar date in Riyadh (YYYY-MM-DD) — the server counts absence only for this date. */
export const riyadhToday = () => riyadhDate.format(new Date());

export const absenceDoneToday = (school: School) => school.absence && school.absenceDate === riyadhToday();

export const isFilled = (value: unknown) => String(value ?? "").trim() !== "";

/** Joins short facts in one line. An Arabic comma, because a middle dot «·» beside Arabic-Indic digits reads as zero «٠». */
export const SEP = "، ";

export const SCHOOL_FORMS = { one: "مدرسة واحدة", two: "مدرستان", few: "مدارس", many: "مدرسة" };
export const FIELD_FORMS = { one: "خانة واحدة", two: "خانتان", few: "خانات", many: "خانة" };
export const YEAR_FORMS = { one: "سنة واحدة", two: "سنتان", few: "سنوات", many: "سنة" };

/** Essential fields: built-in, not optional, not derived. Only these count toward completion. */
export const isEssential = (field: ProfileField) => !field.derived && !field.optional && !field.custom;

/** Mirrors the server's completion formula so progress moves the moment she types. */
export function progressOf(workspace: Workspace, documentCount: number) {
  const essentials = workspace.profile.filter(isEssential);
  const emptyFields = essentials.filter(field => !isFilled(field.value));
  const ratio = essentials.length ? (essentials.length - emptyFields.length) / essentials.length : 1;
  const hasSchools = workspace.schools.length > 0;
  const hasDocuments = documentCount > 0;
  const completion = Math.min(100, Math.round(ratio * 60 + (hasSchools ? 25 : 0) + (hasDocuments ? 15 : 0)));
  return { completion, emptyFields, hasSchools, hasDocuments };
}

export const displayName = (workspace: Workspace | null, fallback: string) =>
  workspace?.profile.find(field => field.id === "name")?.value.trim() || fallback;

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.[0] ?? "؟";
  const family = parts[parts.length - 1].replace(/^ال(?=..)/, "");
  return `${parts[0][0]}‌${family[0]}`;
}

/** Whole years since a date typed as ISO, d/m/yyyy or Hijri (same rule as the server). "" when unreadable. */
export function yearsSince(value: string) {
  const western = value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).trim();
  if (!western) return null;
  let date = new Date(western);
  const dmy = western.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  if (Number.isNaN(date.getTime())) return null;
  let year = date.getFullYear();
  if (year > 1300 && year < 1500) {
    year = Math.round(year * 0.970229 + 621.5643);
    date = new Date(year, date.getMonth(), date.getDate());
  }
  const years = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return years >= 0 && years < 70 ? years : null;
}

export function newCustomField(label: string, value = ""): ProfileField {
  return { id: newId(), label: label.trim() || "خانة جديدة", value, kind: "text", custom: true, updatedAt: new Date().toISOString() };
}

// ---------- Schools ----------
export const STAGES = ["ابتدائية", "متوسطة", "ثانوية"];
export const TIERS = ["تميز", "تقدم", "انطلاق", "تهيئة"];
export const EDUCATION_TYPES = ["حكومي", "أهلي", "تحفيظ", "تربية خاصة"];
export const PRINCIPAL_ROLE = "قائدة المدرسة";
export const LEADER_ROLES = [PRINCIPAL_ROLE, "وكيلة الشؤون التعليمية", "وكيلة شؤون الطالبات", "وكيلة الشؤون المدرسية", "الموجهة الطلابية", "رائدة النشاط"];

export const MADRASATI_LABELS = [
  "المعلمات المسندات للجداول",
  "المعلمات المسندات للمقررات",
  "الطالبات المسندات للفصول",
  "دخول المعلمات",
  "دخول الطالبات",
  "نسبة الإنجاز",
];
export const DISCIPLINE_LABELS = ["يومي", "أسبوعي", "شهري"];

/** A school with every required field present and empty. */
export function newSchool(name: string): School {
  return {
    id: newId(),
    name: name.trim(),
    stage: "",
    area: "",
    ministryNo: "",
    email: "",
    educationType: "",
    specialEducation: "",
    hasGuard: "",
    classes: 0,
    students: 0,
    giftedClasses: 0,
    giftedStudents: 0,
    teachesChinese: "",
    teachers: 0,
    admin: 0,
    deputies: 0,
    expert: 0,
    advanced: 0,
    tier: "",
    support: "",
    nafes: "",
    qudrat: 0,
    tahsili: 0,
    madrasati: [0, 0, 0, 0, 0, 0],
    discipline: [0, 0, 0],
    absence: false,
    principal: "",
    notes: "",
    customFields: [],
    leadership: [],
    updatedAt: new Date().toISOString(),
  };
}

export function newLeader(role = ""): SchoolLeader {
  return {
    id: newId(),
    role,
    state: "",
    fields: [
      { id: "name", label: "الاسم", value: "" },
      { id: "phone", label: "الجوال", value: "" },
    ],
  };
}

export const leaderValue = (leader: SchoolLeader, id: string) => leader.fields.find(field => field.id === id)?.value ?? "";

export function setLeaderValue(leader: SchoolLeader, id: string, label: string, value: string): SchoolLeader {
  const exists = leader.fields.some(field => field.id === id);
  const fields = exists
    ? leader.fields.map(field => (field.id === id ? { ...field, value } : field))
    : [...leader.fields, { id, label, value }];
  return { ...leader, fields };
}

/** Parses digits typed in Arabic-Indic or Latin into a number (empty → 0). */
export function toNumber(value: string) {
  const western = value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[^\d.]/g, "");
  const parsed = Number(western);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const tierPill = (tier: string) =>
  tier === "تميز" || tier === "تقدم" ? "pill-ok" : tier === "انطلاق" ? "pill-brand" : tier === "تهيئة" ? "pill-warn" : "";
