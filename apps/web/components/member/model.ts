import { completionPct, toWesternDigits } from "@rasd/schemas";
import type { LeadershipRole, ProfileField, School, StaffTile, Workspace } from "../../lib/types";

/** Joins short facts in one line. An Arabic comma, because a middle dot «·» beside Arabic-Indic digits reads as zero «٠». */
export const SEP = "، ";

export const SCHOOL_FORMS = { one: "مدرسة واحدة", two: "مدرستان", few: "مدارس", many: "مدرسة" };
export const FIELD_FORMS = { one: "خانة واحدة", two: "خانتان", few: "خانات", many: "خانة" };
export const YEAR_FORMS = { one: "سنة واحدة", two: "سنتان", few: "سنوات", many: "سنة" };
export const PLAN_FORMS = { one: "خطة واحدة", two: "خطتان", few: "خطط", many: "خطة" };

export const isFilled = (value: unknown) => String(value ?? "").trim() !== "";

// ---------- بياناتي ----------
/** The built-in fields shown first (by key; labels are renamable). The rest fold under «بيانات إضافية». */
export const ESSENTIAL_KEYS = ["fullName", "title", "phone", "nationalId", "employeeNo", "hireDate", "qualification"];

type FieldLook = { kind?: "tel" | "email" | "numeric" | "date"; placeholder?: string; options?: string[] };
/** How each built-in field is typed on a phone, and the tap choices it offers (free text is always allowed). */
const FIELD_LOOK: Record<string, FieldLook> = {
  title: { options: ["عضو فريق تنفيذي", "عضو نواتج تعلم", "أخصائية نشاط طلابي", "أخصائية توجيه طلابي"] },
  phone: { kind: "tel", placeholder: "مثال: 0551234567" },
  nationalId: { kind: "numeric", placeholder: "مثال: 1012345678" },
  employeeNo: { kind: "numeric" },
  email: { kind: "email", placeholder: "مثال: name@moe.gov.sa" },
  qualification: { options: ["دبلوم", "بكالوريوس", "ماجستير", "دكتوراه"] },
  major: { placeholder: "مثال: رياضيات" },
  supervisoryMajor: { placeholder: "مثال: إشراف رياضيات" },
  hireDate: { kind: "date", placeholder: "مثال: ١٤٣٠/٠٥/١٢" },
  supervisionStart: { kind: "date", placeholder: "مثال: ١٤٤٠/٠١/١٥" },
};
export const lookOf = (field: ProfileField): FieldLook => {
  const look = (field.key && FIELD_LOOK[field.key]) || {};
  return field.options.length ? { ...look, options: field.options } : field.type === "hijri_date" && !look.kind ? { ...look, kind: "date" } : look;
};

/** Fields that count toward completion (the server's rule: every non-derived field). */
const countsTowardCompletion = (field: ProfileField) => field.type !== "derived";
export const emptyFields = (profile: ProfileField[]) => profile.filter(field => countsTowardCompletion(field) && !isFilled(field.value));

export function splitProfile(profile: ProfileField[]) {
  const essentials = ESSENTIAL_KEYS.map(key => profile.find(field => field.key === key)).filter((field): field is ProfileField => Boolean(field));
  const extras = profile.filter(field => field.key && field.type !== "derived" && !ESSENTIAL_KEYS.includes(field.key));
  const custom = profile.filter(field => !field.key);
  return { essentials, extras, custom };
}

export const displayName = (workspace: Workspace, fallback: string) =>
  workspace.profile.find(field => field.key === "fullName")?.value.trim() || workspace.cluster.memberName || fallback;

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.[0] ?? "؟";
  const family = parts[parts.length - 1].replace(/^ال(?=..)/, "");
  return `${parts[0][0]}‌${family[0]}`;
}

// ---------- Schools ----------
export const TEACHERS_TILE = "الهيئة التعليمية";
export const ADMIN_TILE = "الهيئة الإدارية";
export const PRINCIPAL_ROLES = ["مديرة المدرسة", "قائدة المدرسة"];
export const LEADER_ROLES = ["وكيلة الشؤون التعليمية", "وكيلة شؤون الطالبات", "وكيلة الشؤون المدرسية", "الموجهة الطلابية", "رائدة النشاط"];
export const NAME_FIELD = "الاسم";
export const PHONE_FIELD = "الجوال";
export const NOTES_FIELD = "ملاحظات";

/** The values the server needs for each school (its completion rule), in the order they appear on the school page. */
export const SCHOOL_CORE = ["name", "stage", "students", "classes", "ministryNo", "area"] as const;
export type SchoolCore = (typeof SCHOOL_CORE)[number];
export const isCoreFilled = (school: School, key: SchoolCore) =>
  key === "students" || key === "classes" ? school[key] > 0 : isFilled(school[key]);
export const schoolGaps = (school: School) => SCHOOL_CORE.filter(key => !isCoreFilled(school, key));

export const tileOf = (school: School, label: string): StaffTile | undefined => school.staffTiles.find(tile => tile.label === label);
export const principalOf = (school: School): LeadershipRole | undefined =>
  school.leadership.find(role => PRINCIPAL_ROLES.includes(role.role));
export const roleValue = (role: LeadershipRole, label: string) => role.fields.find(field => field.label === label)?.value ?? "";
export const notesOf = (school: School) => school.customFields.find(field => field.label === NOTES_FIELD);

export const tierPill = (tier: string) =>
  tier === "تميز" || tier === "تقدم" ? "pill-ok" : tier === "انطلاق" ? "pill-brand" : tier === "تهيئة" ? "pill-warn" : "";

/** Parses digits typed in Arabic-Indic or Latin into a whole number (empty → 0). */
export function toNumber(value: string) {
  const parsed = Number(toWesternDigits(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

// ---------- Completion (the same function the server uses, so the number moves as she types) ----------
export function progressOf(workspace: Workspace) {
  const completion = completionPct({ profile: workspace.profile, schools: workspace.schools, plans: workspace.plans });
  const fields = emptyFields(workspace.profile);
  const gaps = workspace.schools.reduce((sum, school) => sum + schoolGaps(school).length, 0);
  const firstIncomplete = workspace.schools.find(school => schoolGaps(school).length > 0);
  const plansLeft = workspace.plans.filter(plan => plan.status !== "uploaded").length;
  return { completion, fields, gaps, firstIncomplete, plansLeft };
}
