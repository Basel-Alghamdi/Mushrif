// The agent's own view of the team: the shapes its Arabic engine and the Claude tools reason about.
// snapshot.ts reads main's normalized tables into these shapes once per message; writes.ts maps changes back.
import { DEFAULT_PROFILE_FIELDS, type DocumentInfo } from "@rasd/schemas";
import type { AuditContext } from "../audit.js";
import type { Actor } from "../auth.js";
import type { Sql } from "../db.js";

/** Who the agent works for and where its writes go: the head, her audit context (source "agent") and the conversation. */
export type Session = { db: Sql; head: Actor; audit: AuditContext; conversationId: string | null };

export type FieldKind = "text" | "phone" | "email" | "date" | "number";

/** A profile value. Built-in fields carry the engine's stable id (BUILT_IN_FIELDS); custom fields their row id. */
export type ProfileField = { id: string; label: string; value: string; kind: FieldKind; custom?: boolean; derived?: boolean; updatedAt?: string };

export type SchoolLeader = { id: string; role: string; state: string; fields: { id: string; label: string; value: string }[] };

export type School = {
  id: string;
  name: string;
  stage: string;
  area: string;
  ministryNo: string;
  email: string; // the school's ministry email
  educationType: string;
  specialEducation: string;
  hasGuard: string; // يوجد | لا يوجد
  classes: number;
  students: number;
  giftedClasses: number;
  giftedStudents: number;
  teachesChinese: string; // نعم | لا
  teachers: number; // staff tile «الهيئة التعليمية»
  admin: number; // staff tile «الهيئة الإدارية»
  deputies: number; // staff tile «الوكيلات»
  tier: string; // تميز | تقدم | انطلاق | تهيئة | ""
  support: string;
  nafes: string;
  qudrat: number | null;
  tahsili: number | null;
  madrasati: number[]; // the 6 مدرستي percentages
  discipline: number[]; // [daily, weekly, monthly]
  absence: boolean; // confirmed today
  absenceDate?: string;
  principal: string; // the name in the «مديرة/قائدة المدرسة» leadership role
  notes?: string; // custom field «ملاحظات»
  customFields?: { id: string; label: string; value: string }[];
  staffTiles?: { id: string; label: string; value: number }[];
  leadership?: SchoolLeader[];
  updatedAt?: string;
};

export type Program = { id: string; kind: string; label: string; count: number; reportsUrl: string; status: string };
export type CustomSection = { id: string; label: string; fields: { id: string; label: string; value: string }[] };

export type Visit = {
  id: string;
  userId: string;
  schoolId: string;
  schoolName: string;
  type: string;
  text: string;
  beneficiaries: number;
  sessions: number;
  blockers: string;
  createdAt: string;
};

export type EngineWorkspace = {
  profile: ProfileField[];
  schools: School[];
  programs: Program[];
  sections: CustomSection[];
  /** Last change to her file by anyone (null = nothing changed since the account was created). */
  updatedAt: string | null;
  completion: number; // main's completion %
  missing: string[]; // what still holds the completion back, in plain Arabic
};

export type MemberSummary = {
  id: string;
  clusterId: string;
  name: string;
  email: string; // login email
  phone: string;
  title: string; // الصفة
  clusterLabel: string;
  initials: string;
  activated: boolean; // has chosen her password
  lastLoginAt: string | null;
  completion: number;
  missing: string[];
  schoolCount: number;
  studentCount: number;
  teacherCount: number;
  absenceDoneToday: number;
  visitCount: number;
  documentCount: number;
  programCount: number;
  submittedAt: string | null;
  lastActivityAt: string | null; // her own latest work (edits, visits, uploads)
  submittedToday: boolean; // «حدّثت اليوم»
  workspaceUpdatedAt: string | null;
};

export type MemberDetail = MemberSummary & { workspace: EngineWorkspace; visits: Visit[]; documents: DocumentInfo[] };

export type TeamStats = {
  members: number;
  activated: number;
  notActivated: number;
  submittedToday: number;
  averageCompletion: number;
  completeProfiles: number; // completion >= 85
  schools: number;
  students: number;
  teachers: number;
  visits: number;
  documents: number;
};

// ---------- Built-in profile fields ----------
/**
 * The engine's field ids and where each lives in main's schema: a profile_fields row (by field_key), the login email
 * (profiles.email, which also moves the Supabase sign-in) or the cluster label (clusters.label).
 */
export type BuiltInField = { id: string; key: string | null; label: string; kind: FieldKind; derived?: boolean; source?: "login" | "cluster" };

const KEYED: [id: string, key: string, kind: FieldKind][] = [
  ["name", "fullName", "text"], ["title", "title", "text"], ["national_id", "nationalId", "number"], ["employee_no", "employeeNo", "number"],
  ["moe_email", "email", "email"], ["phone", "phone", "phone"], ["rank", "rank", "text"], ["qualification", "qualification", "text"],
  ["major", "major", "text"], ["supervision_major", "supervisoryMajor", "text"], ["hire_date", "hireDate", "date"],
  ["assignment_date", "supervisionStart", "date"], ["experience_years", "yearsOfExperience", "number"],
];

export const BUILT_IN_FIELDS: BuiltInField[] = [
  ...KEYED.map(([id, key, kind]): BuiltInField => {
    const seed = DEFAULT_PROFILE_FIELDS.find(field => field.key === key)!;
    return { id, key, label: seed.label, kind, ...(seed.type === "derived" ? { derived: true } : {}) };
  }),
  { id: "email", key: null, label: "البريد الإلكتروني", kind: "email", source: "login" },
  { id: "cluster", key: null, label: "العنقود", kind: "text", source: "cluster" },
];

export const builtInField = (id: string) => BUILT_IN_FIELDS.find(field => field.id === id) ?? null;
/** The login email and the cluster label: never changed by an immediate write that Khulood did not word herself. */
export const approvalOnly = (fieldId: string | null) => Boolean(fieldId && builtInField(fieldId)?.source);
export const builtInByKey = (key: string) => BUILT_IN_FIELDS.find(field => field.key === key) ?? null;
