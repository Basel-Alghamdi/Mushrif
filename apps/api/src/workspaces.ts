import type { CustomSection, ProfileField, Program, School, Visit, VisitInput, Workspace, WorkspaceSaveInput } from "@rasd/schemas";
import { cleanText, db, newId, now, parseJson, today } from "./db.js";

type FieldSeed = Omit<ProfileField, "value"> & { value?: string };

/**
 * Built-in profile fields. Ids are stable so the agent and imports can target them.
 * The first group is essential (counted in completion); `optional` fields sit under "بيانات إضافية".
 */
export const DEFAULT_PROFILE: FieldSeed[] = [
  { id: "name", label: "الاسم الرباعي", kind: "text", hint: "كما في الهوية" },
  { id: "title", label: "الصفة", kind: "text", hint: "مثال: عضو فريق تنفيذي", options: ["عضو فريق تنفيذي", "عضو نواتج تعلم", "أخصائية نشاط طلابي", "أخصائية توجيه طلابي"] },
  { id: "phone", label: "رقم الجوال", kind: "phone", hint: "مثال: 0551234567" },
  { id: "national_id", label: "السجل المدني", kind: "number", hint: "١٠ أرقام" },
  { id: "employee_no", label: "الرقم الوظيفي", kind: "number", hint: "كما في نور أو فارس" },
  { id: "cluster", label: "العنقود", kind: "text", hint: "مثال: عنقود ٤" },
  { id: "qualification", label: "المؤهل", kind: "text", options: ["دبلوم", "بكالوريوس", "ماجستير", "دكتوراه"] },
  { id: "hire_date", label: "تاريخ التعيين", kind: "date", hint: "مثال: ١٤٣٠/٠٥/١٢" },
  { id: "experience_years", label: "عدد سنوات الخبرة", kind: "number", derived: true, hint: "تُحسب من تاريخ التعيين" },
  { id: "email", label: "البريد الإلكتروني", kind: "email", hint: "مثال: name@gmail.com", optional: true },
  { id: "moe_email", label: "البريد الوزاري", kind: "email", hint: "مثال: name@moe.gov.sa", optional: true },
  { id: "rank", label: "الرتبة", kind: "text", options: ["معلم", "ممارس", "متقدم", "خبير"], optional: true },
  { id: "major", label: "التخصص", kind: "text", hint: "مثال: رياضيات", optional: true },
  { id: "supervision_major", label: "التخصص الإشرافي", kind: "text", hint: "مثال: إشراف رياضيات", optional: true },
  { id: "assignment_date", label: "تاريخ التكليف بالإشراف", kind: "date", hint: "مثال: ١٤٤٠/٠١/١٥", optional: true },
];
const BUILT_IN = new Map(DEFAULT_PROFILE.map(field => [field.id, field]));

export function defaultProfile(account: { name: string; email: string; phone?: string; title?: string; clusterLabel?: string }): ProfileField[] {
  const initial: Record<string, string> = { name: account.name, email: account.email, phone: account.phone ?? "", title: account.title ?? "", cluster: account.clusterLabel ?? "" };
  return DEFAULT_PROFILE.map(field => ({ ...field, value: initial[field.id] ?? field.value ?? "" }));
}

/** Years since a date string (ISO yyyy-mm-dd or dd/mm/yyyy, any digits). */
export function yearsSince(value: string) {
  const western = value.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
  let date = new Date(western);
  const dmy = western.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  if (Number.isNaN(date.getTime())) return "";
  let year = date.getFullYear();
  // Hijri years (e.g. 1430) — convert roughly to Gregorian.
  if (year > 1300 && year < 1500) { year = Math.round(year * 0.970229 + 621.5643); date = new Date(year, date.getMonth(), date.getDate()); }
  const years = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return years >= 0 && years < 70 ? String(years) : "";
}

/**
 * Refreshes built-in field metadata (hint, kind, options, optional) from DEFAULT_PROFILE — so workspaces saved
 * earlier pick up current wording — and recomputes derived fields. Labels and values are never touched.
 */
function hydrateProfile(profile: ProfileField[]): ProfileField[] {
  const hire = profile.find(field => field.id === "hire_date")?.value ?? "";
  return profile.map(field => {
    const builtIn = BUILT_IN.get(field.id);
    const next: ProfileField = builtIn ? { ...field, hint: builtIn.hint, kind: builtIn.kind, options: builtIn.options, optional: builtIn.optional, derived: builtIn.derived } : field;
    return field.id === "experience_years" ? { ...next, derived: true, value: hire ? yearsSince(hire) : "" } : next;
  });
}

/** Completion counts the essential built-in fields only — optional, custom and derived fields never hold it back. */
export function completionFor(profile: ProfileField[], schoolCount: number, documentCount: number) {
  const editable = profile.filter(field => !field.derived && !field.optional && !field.custom);
  const empty = editable.filter(field => !String(field.value ?? "").trim());
  const ratio = editable.length ? (editable.length - empty.length) / editable.length : 1;
  const completion = Math.round(ratio * 60 + (schoolCount > 0 ? 25 : 0) + (documentCount > 0 ? 15 : 0));
  const missing = [
    ...empty.map(field => field.label),
    ...(schoolCount > 0 ? [] : ["مدارس العنقود"]),
    ...(documentCount > 0 ? [] : ["الملفات والتقارير"]),
  ];
  return { completion: Math.min(100, completion), missing };
}

export function documentCountFor(userId: string) {
  return Number(db.prepare("SELECT count(*) AS n FROM documents WHERE owner_id = ?").get(userId)?.n ?? 0);
}

type AccountLike = { id: string; name: string; email: string; phone: string; title: string; clusterLabel: string };

export function getWorkspace(account: AccountLike): Workspace {
  let row = db.prepare("SELECT * FROM workspaces WHERE user_id = ?").get(account.id);
  if (!row) {
    const createdAt = now();
    db.prepare(`INSERT INTO workspaces (user_id,profile_json,schools_json,programs_json,sections_json,submitted_at,updated_at,version)
      VALUES (?,?,'[]','[]','[]',NULL,?,1)`).run(account.id, JSON.stringify(defaultProfile(account)), createdAt);
    row = db.prepare("SELECT * FROM workspaces WHERE user_id = ?").get(account.id)!;
  }
  const profile = hydrateProfile(parseJson<ProfileField[]>(row.profile_json, []));
  const schools = parseJson<School[]>(row.schools_json, []);
  const { completion, missing } = completionFor(profile, schools.length, documentCountFor(account.id));
  return {
    userId: account.id,
    version: Number(row.version ?? 1),
    profile,
    schools,
    programs: parseJson<Program[]>(row.programs_json, []),
    sections: parseJson<CustomSection[]>(row.sections_json, []),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    updatedAt: String(row.updated_at),
    completion,
    missing,
  };
}

export class StaleWorkspaceError extends Error {
  constructor(public current: Workspace) { super("STALE_WORKSPACE"); }
}

/**
 * Saves part of a workspace. When `input.version` is given and does not match, throws StaleWorkspaceError
 * (the caller returns 409 with the current workspace). Omit version for server-side writes (agent, imports).
 */
export function saveWorkspace(account: AccountLike, input: Partial<WorkspaceSaveInput>): Workspace {
  const current = getWorkspace(account);
  if (typeof input.version === "number" && input.version !== current.version) throw new StaleWorkspaceError(current);
  const profile = input.profile ? hydrateProfile(input.profile.map(field => ({ ...field, label: cleanText(field.label) || "حقل", value: String(field.value ?? "") }))) : current.profile;
  const schools = input.schools ?? current.schools;
  const programs = input.programs ?? current.programs;
  const sections = input.sections ?? current.sections;
  const updatedAt = now();
  db.prepare(`UPDATE workspaces SET profile_json=?, schools_json=?, programs_json=?, sections_json=?, updated_at=?, version=version+1 WHERE user_id=?`)
    .run(JSON.stringify(profile), JSON.stringify(schools), JSON.stringify(programs), JSON.stringify(sections), updatedAt, account.id);
  syncAccountFromProfile(account, profile);
  return getWorkspace(account);
}

/** Keeps users.name/phone/title/cluster_label in step with the matching built-in profile fields. */
function syncAccountFromProfile(account: AccountLike, profile: ProfileField[]) {
  const value = (id: string, fallback: string) => {
    const field = profile.find(item => item.id === id);
    return field ? cleanText(field.value) : fallback;
  };
  db.prepare("UPDATE users SET name=?, phone=?, title=?, cluster_label=?, updated_at=? WHERE id=?")
    .run(value("name", account.name) || account.name, value("phone", account.phone), value("title", account.title), value("cluster", account.clusterLabel), now(), account.id);
}

/** Sets (or creates) profile fields by id or label. Used by the agent and imports. */
export function setProfileValues(account: AccountLike, changes: { fieldId: string | null; fieldLabel: string; value: string }[]) {
  const workspace = getWorkspace(account);
  const profile = [...workspace.profile];
  const applied: { fieldId: string; fieldLabel: string; before: string; after: string }[] = [];
  for (const change of changes) {
    const label = cleanText(change.fieldLabel);
    let index = change.fieldId ? profile.findIndex(field => field.id === change.fieldId) : -1;
    if (index < 0 && label) index = profile.findIndex(field => cleanText(field.label) === label);
    if (index >= 0) {
      if (profile[index].derived) continue;
      applied.push({ fieldId: profile[index].id, fieldLabel: profile[index].label, before: profile[index].value, after: change.value });
      profile[index] = { ...profile[index], value: change.value, updatedAt: now() };
    } else if (label) {
      const field: ProfileField = { id: newId(), label, value: change.value, kind: "text", custom: true, updatedAt: now() };
      profile.push(field);
      applied.push({ fieldId: field.id, fieldLabel: label, before: "", after: change.value });
    }
  }
  saveWorkspace(account, { profile });
  return applied;
}

export function submitWorkspace(userId: string) {
  const submittedAt = now();
  db.prepare("UPDATE workspaces SET submitted_at = ?, updated_at = ?, version = version + 1 WHERE user_id = ?").run(submittedAt, submittedAt, userId);
  return { submittedAt };
}

export function absenceDoneToday(schools: School[]) {
  const day = today();
  return schools.filter(school => school.absence && (!school.absenceDate || school.absenceDate === day)).length;
}

// ---------- Visits ----------
function mapVisit(row: Record<string, unknown>, schoolNames: Map<string, string>): Visit {
  const details = parseJson<Record<string, unknown>>(row.details_json, {});
  const schoolId = String(row.school_id);
  return {
    id: String(row.id), userId: String(row.user_id), schoolId,
    schoolName: String(details.schoolName ?? schoolNames.get(schoolId) ?? ""),
    type: String(row.type), text: String(row.text),
    beneficiaries: Number(details.beneficiaries ?? 0), sessions: Number(details.sessions ?? 0), blockers: String(details.blockers ?? ""),
    createdAt: String(row.created_at),
  };
}

export function visitsForUser(userId: string, schools: School[] = []): Visit[] {
  const names = new Map(schools.map(school => [school.id, school.name]));
  return db.prepare("SELECT * FROM visits WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(row => mapVisit(row, names));
}

export function visitCountFor(userId: string) {
  return Number(db.prepare("SELECT count(*) AS n FROM visits WHERE user_id = ?").get(userId)?.n ?? 0);
}

export function createVisit(userId: string, input: VisitInput, schools: School[]): Visit {
  const schoolId = input.schoolId ?? "";
  const schoolName = cleanText(input.schoolName) || schools.find(school => school.id === schoolId)?.name || "";
  const id = newId();
  const details = { schoolName, beneficiaries: Number(input.beneficiaries ?? 0) || 0, sessions: Number(input.sessions ?? 0) || 0, blockers: String(input.blockers ?? "") };
  db.prepare("INSERT INTO visits (id,user_id,school_id,type,text,attachments_json,details_json,created_at) VALUES (?,?,?,?,?,'[]',?,?)")
    .run(id, userId, schoolId, cleanText(input.type) || "زيارة", String(input.text ?? ""), JSON.stringify(details), now());
  return visitsForUser(userId, schools).find(visit => visit.id === id)!;
}

export function deleteVisit(userId: string, id: string) {
  return Number(db.prepare("DELETE FROM visits WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
}
