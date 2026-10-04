import { completionPct, yearsSinceHijri } from "@rasd/schemas";
import type { LeadershipRole, MemberSummary, ProfileField, School, StaffTile, Workspace } from "../../lib/types";
import { relativeTime } from "../../lib/format";

// Helpers for the head's view of a member's file (main's normalized workspace from GET /district/members/:id).

/** A fresh uuid for client-generated ids (crypto.randomUUID is missing on plain-http LAN addresses). */
export function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The built-in fields she is asked for first, in this order; everything else sits under «بيانات إضافية». */
export const ESSENTIAL_KEYS = ["fullName", "title", "phone", "nationalId", "employeeNo", "qualification", "hireDate"];
export const isDerived = (field: ProfileField) => field.type === "derived";
export const isEssential = (field: ProfileField) => Boolean(field.key && ESSENTIAL_KEYS.includes(field.key));

export const TITLE_SUGGESTIONS = ["عضو فريق تنفيذي", "عضو نواتج تعلم", "أخصائية نشاط طلابي", "أخصائية توجيه طلابي"];
const QUALIFICATIONS = ["بكالوريوس", "ماجستير", "دكتوراه", "دبلوم"];

/** Input details per built-in key (free text always; these only pick the keyboard and the example). */
export function fieldInput(field: ProfileField) {
  switch (field.key) {
    case "phone": return { type: "tel", inputMode: "tel" as const, dir: "ltr", placeholder: "مثال: 0551234567" };
    case "email": return { type: "text", inputMode: "email" as const, dir: "ltr", placeholder: "مثال: name@moe.gov.sa" };
    case "nationalId": case "employeeNo": return { type: "text", inputMode: "numeric" as const, dir: "ltr" };
    case "title": return { type: "text", options: TITLE_SUGGESTIONS };
    case "qualification": return { type: "text", options: QUALIFICATIONS };
    default:
      if (field.type === "hijri_date") return { type: "text", placeholder: "مثال: ١٤٤٠/٠٧/١٥ أو 2019-03-20" };
      return { type: "text", options: field.options?.length ? field.options : undefined };
  }
}

/** Value of a built-in profile field. */
export const fieldValue = (workspace: Workspace, key: string) => workspace.profile.find(field => field.key === key)?.value.trim() ?? "";

/** Derived values follow what is typed (years of experience from the hire date), like the server computes them. */
export function withDerived(workspace: Workspace): Workspace {
  const hireDate = fieldValue(workspace, "hireDate");
  const profile = workspace.profile.map(field => field.key === "yearsOfExperience" && isDerived(field) ? { ...field, value: yearsSinceHijri(hireDate) } : field);
  return { ...workspace, profile, completion: completionPct({ profile, schools: workspace.schools, plans: workspace.plans }) };
}

/** Where a missing item is filled on the head's side: a profile field, the schools tab, or only by the member herself. */
export type MissingItem = { label: string; tab: "profile" | "schools" | null; fieldId?: string };

const SCHOOL_CORE: (keyof School)[] = ["name", "stage", "area", "ministryNo"];
export const schoolIncomplete = (school: School) =>
  SCHOOL_CORE.some(key => !String(school[key] ?? "").trim()) || school.classes <= 0 || school.students <= 0;

/** What keeps her file below 100% — the same items main's completion counts. */
export function missingItems(workspace: Workspace): MissingItem[] {
  const items: MissingItem[] = workspace.profile
    .filter(field => !isDerived(field) && !field.value.trim())
    .map(field => ({ label: field.label, tab: "profile", fieldId: field.id }));
  if (!workspace.schools.length) items.push({ label: "مدارس العنقود", tab: "schools" });
  for (const school of workspace.schools) if (schoolIncomplete(school)) items.push({ label: `بيانات ${school.name || "مدرسة بدون اسم"}`, tab: "schools" });
  const absent = workspace.schools.filter(school => !school.absenceToday).length;
  if (absent) items.push({ label: workspace.schools.length > 1 ? `تثبيت غياب اليوم (${absent} من ${workspace.schools.length})` : "تثبيت غياب اليوم", tab: null });
  const plans = workspace.plans.filter(plan => plan.status !== "uploaded");
  if (plans.length) items.push({ label: `رفع الخطط: ${plans.map(plan => plan.label).join("، ")}`, tab: null });
  return items;
}

/** One line under her name: account first, then today's activity. */
export function statusLine(member: Pick<MemberSummary, "activated" | "submission" | "lastActivityAt" | "lastSignInAt">) {
  if (!member.activated) return { text: "لم تفعّل حسابها بعد", tone: "warn" };
  if (member.submission !== "missing") return { text: "حدّثت اليوم", tone: "ok" };
  if (member.lastActivityAt) return { text: `آخر تحديث ${relativeTime(member.lastActivityAt)}`, tone: "" };
  if (member.lastSignInAt) return { text: `آخر دخول ${relativeTime(member.lastSignInAt)}`, tone: "" };
  return { text: "فعّلت حسابها", tone: "" };
}

/** The principal: the «مديرة المدرسة» leadership role (main's default; «قائدة المدرسة» also counts) and its «الاسم» field. */
export const PRINCIPAL_ROLE = "مديرة المدرسة";
const PRINCIPAL_ROLES = [PRINCIPAL_ROLE, "قائدة المدرسة"];
export const isPrincipalRole = (role: LeadershipRole) => PRINCIPAL_ROLES.includes(role.role.trim());
export const principalRole = (school: School) => school.leadership.find(isPrincipalRole);
export const NAME_LABEL = "الاسم";
export const principalName = (school: School) => principalRole(school)?.fields.find(field => field.label.trim() === NAME_LABEL)?.value ?? "";

/** «الهيئة التعليمية» staff tile = the number of teachers. */
export const TEACHERS_TILE = "الهيئة التعليمية";
export const teachersTile = (school: School): StaffTile | undefined => school.staffTiles.find(tile => tile.label.trim() === TEACHERS_TILE);

/** Raw rows the head mirror routes answer with (camelCase columns). */
export type Row = { id: string; updatedAt: string; [key: string]: unknown };
