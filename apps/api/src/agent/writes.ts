// The agent's writes on a member's file, in main's tables. Each unit runs in its own transaction with the audit row
// (actor = the head, source "agent", the member's cluster) and returns the steps that undo it.
import {
  DEFAULT_LEADERSHIP_ROLE, DEFAULT_PROFILE_FIELDS, DEFAULT_STAFF_TILES, MADRASATI_METRICS, TIERS, toWesternDigits, validators, type MemberCreateInput,
} from "@rasd/schemas";
import { createMemberAccount } from "../accounts.js";
import { auditWith, type AuditEntry } from "../audit.js";
import { supabaseAdmin } from "../auth.js";
import { atomically, type Row, type Sql } from "../db.js";
import { assignDocument, findDocument } from "../documents.js";
import { cleanText, isUuid, normalizeEmail } from "../parse.js";
import { lastSignIns } from "../workspace.js";
import { builtInByKey, builtInField, type School, type Session } from "./model.js";
import { comparable, normalizeArabic } from "./normalize.js";
import { PRINCIPAL_ROLE, TILE_PATTERNS } from "./snapshot.js";

/** A team member the head may change: in her district, with her cluster. */
export type MemberRef = { id: string; name: string; email: string; clusterId: string; activated: boolean };

export async function findMember(db: Sql, session: Session, memberId: string): Promise<MemberRef | null> {
  if (!isUuid(memberId)) return null;
  const [row] = await db`
    select p.id, p.name, p.email, p.activated_at, c.id as cluster_id from profiles p join clusters c on c.member_id = p.id
    where p.id = ${memberId} and p.role = 'member' and p.district_id = ${session.head.districtId}`;
  return row ? { id: String(row.id), name: String(row.name), email: String(row.email), clusterId: String(row.clusterId), activated: Boolean(row.activatedAt) } : null;
}

// ---------- Undo steps (stored in the undo proposal's payload) ----------
const ROW_TABLES = {
  schools: "school", school_staff_tiles: "staff_tile", leadership_roles: "leadership_role", leadership_fields: "leadership_field",
  school_custom_fields: "school_custom_field",
} as const;
const INDICATOR_TABLES = ["evaluation_indicators", "madrasati_indicators", "discipline_indicators"] as const;
type RowTable = keyof typeof ROW_TABLES;
type IndicatorTable = (typeof INDICATOR_TABLES)[number];
type Owner = { memberId: string; memberName: string; clusterId: string };

export type UndoStep =
  /** A profile value (before = null: the field was created by the change, so it is removed). */
  | (Owner & { kind: "field"; rowId: string; label: string; before: string | null })
  | (Owner & { kind: "cluster"; before: string })
  | (Owner & { kind: "login"; before: string })
  /** A school row or one of its parts (before = null: created by the change). */
  | (Owner & { kind: "row"; table: RowTable; id: string; before: Record<string, unknown> | null })
  | (Owner & { kind: "indicator"; table: IndicatorTable; schoolId: string; before: Record<string, unknown> | null })
  | { kind: "file"; documentId: string; documentName: string; ownerId: string | null }
  /** A new account: `auditMark` (the last audit row id) and `seeded` (her non-empty profile values) as they were right after creating it. */
  | { kind: "member"; memberId: string; name: string; auditMark?: string; seeded?: Record<string, string> };

export type UndoPlan = { steps: UndoStep[] };

const owner = (member: MemberRef): Owner => ({ memberId: member.id, memberName: member.name, clusterId: member.clusterId });
const auditFor = (tx: Sql, session: Session, clusterId: string | null) => (entry: AuditEntry) => auditWith(tx, session.audit, { clusterId, ...entry });
const nextSort = async (tx: Sql, table: string, column: string, parentId: string) =>
  Number((await tx`select coalesce(max(sort_order) + 1, 0)::int as next from ${tx(table)} where ${tx(column)} = ${parentId}`)[0].next);

/** The longest value the agent writes into a file (main's limit for a profile value); longer text is cut. */
export const MAX_VALUE_CHARS = 500;
const capped = (value: unknown) => cleanText(value).slice(0, MAX_VALUE_CHARS);

// ---------- Profile ----------
export type FieldWrite = { fieldId: string | null; fieldLabel: string; value: string };
export type FieldResult = { fieldId: string; fieldLabel: string; before: string; after: string; created: boolean; error?: string };

/** profiles mirrors these built-in fields (main keeps الصفة in sync; the agent also keeps the name and phone in step). */
const ACCOUNT_COLUMNS: Record<string, "name" | "title" | "phone"> = { fullName: "name", title: "title", phone: "phone" };

async function syncAccount(tx: Sql, memberId: string, fieldKey: unknown, value: string) {
  const column = typeof fieldKey === "string" ? ACCOUNT_COLUMNS[fieldKey] : undefined;
  if (!column || (column === "name" && !value)) return;
  await tx`update profiles set ${tx({ [column]: value.slice(0, 200) })} where id = ${memberId}`;
}

function findRow(rows: Row[], write: FieldWrite) {
  const builtIn = write.fieldId ? builtInField(write.fieldId) : null;
  if (builtIn?.key) {
    const byKey = rows.find(row => row.fieldKey === builtIn.key);
    if (byKey) return byKey;
  } else if (write.fieldId) {
    const byId = rows.find(row => row.id === write.fieldId);
    if (byId) return byId;
  }
  const label = comparable(write.fieldLabel);
  return label ? rows.find(row => comparable(row.label) === label) ?? null : null;
}

const engineId = (row: Row) => (row.fieldKey ? builtInByKey(String(row.fieldKey))?.id ?? String(row.id) : String(row.id));

/**
 * Sets profile values of one member: built-in fields by id, others by label (unknown labels become custom fields).
 * The cluster label and the login email are written where main keeps them (clusters.label, profiles.email + Supabase).
 */
export async function writeProfileFields(session: Session, member: MemberRef, writes: FieldWrite[]) {
  const results: FieldResult[] = [];
  const undo: UndoStep[] = [];
  let login: { value: string; result: FieldResult } | null = null;
  await atomically(session.db, async tx => {
    const audit = auditFor(tx, session, member.clusterId);
    const rows = [...await tx`select * from profile_fields where cluster_id = ${member.clusterId} and deleted_at is null order by sort_order, created_at`];
    for (const write of writes) {
      const value = String(write.value ?? "").trim().slice(0, MAX_VALUE_CHARS);
      const builtIn = write.fieldId ? builtInField(write.fieldId) : null;
      if (builtIn?.source === "login") {
        const result: FieldResult = { fieldId: "email", fieldLabel: builtIn.label, before: member.email, after: value, created: false };
        results.push(result);
        login = { value, result };
        continue;
      }
      if (builtIn?.source === "cluster") {
        const [cluster] = await tx`select label from clusters where id = ${member.clusterId}`;
        await tx`update clusters set label = ${value.slice(0, 200)} where id = ${member.clusterId}`;
        await audit({ action: "update", entity: "member_contact", entityId: member.id, before: { clusterLabel: cluster.label }, after: { clusterLabel: value } });
        undo.push({ kind: "cluster", ...owner(member), before: String(cluster.label) });
        results.push({ fieldId: "cluster", fieldLabel: builtIn.label, before: String(cluster.label), after: value, created: false });
        continue;
      }
      const row = findRow(rows, write);
      if (row) {
        if (row.fieldType === "derived") {
          results.push({ fieldId: engineId(row), fieldLabel: row.label, before: row.value, after: row.value, created: false, error: "هذا الحقل يُحسب تلقائياً" });
          continue;
        }
        await tx`update profile_fields set value = ${value} where id = ${row.id}`;
        await audit({ action: "update", entity: "profile_field", entityId: String(row.id), field: "value", before: row.value, after: value });
        await syncAccount(tx, member.id, row.fieldKey, value);
        undo.push({ kind: "field", ...owner(member), rowId: String(row.id), label: String(row.label), before: String(row.value) });
        results.push({ fieldId: engineId(row), fieldLabel: row.label, before: String(row.value), after: value, created: false });
        row.value = value;
        continue;
      }
      if (builtIn?.derived) {
        results.push({ fieldId: builtIn.id, fieldLabel: builtIn.label, before: "", after: "", created: false, error: "هذا الحقل يُحسب تلقائياً" });
        continue;
      }
      // A built-in field she deleted comes back with its key; anything else is a new custom field.
      const seed = builtIn?.key ? DEFAULT_PROFILE_FIELDS.find(field => field.key === builtIn.key) ?? null : null;
      const label = seed?.label ?? (cleanText(write.fieldLabel) || builtIn?.label || "حقل").slice(0, 200);
      const [created] = await tx`insert into profile_fields ${tx({
        clusterId: member.clusterId, fieldKey: seed?.key ?? null, label, value, span: seed?.span ?? 1, fieldType: seed?.type ?? "text",
        options: seed?.options ?? [], sortOrder: await nextSort(tx, "profile_fields", "cluster_id", member.clusterId),
      })} returning *`;
      await audit({ action: "create", entity: "profile_field", entityId: String(created.id), after: { label, value } });
      if (seed) await syncAccount(tx, member.id, seed.key, value);
      undo.push({ kind: "field", ...owner(member), rowId: String(created.id), label, before: null });
      results.push({ fieldId: builtIn?.id ?? String(created.id), fieldLabel: label, before: "", after: value, created: true });
      rows.push(created);
    }
  });
  const pending = login as { value: string; result: FieldResult } | null;
  if (pending) {
    const error = await changeLoginEmail(session, member, pending.value);
    if (error) Object.assign(pending.result, { after: pending.result.before, error });
    else if (normalizeEmail(pending.value) !== member.email) {
      pending.result.after = normalizeEmail(pending.value);
      undo.push({ kind: "login", ...owner(member), before: member.email });
    }
  }
  return { results, undo };
}

/** Moves her sign-in to another address (Supabase first, like PATCH /district/members/:id/contact). Returns an error text or null. */
async function changeLoginEmail(session: Session, member: MemberRef, value: string): Promise<string | null> {
  const email = normalizeEmail(value);
  if (validators.loginEmail(email)) return "بريد الدخول يحتاج عنواناً كاملاً فيه @";
  if (email === member.email) return null;
  const [taken] = await session.db`select id from profiles where email = ${email} and id <> ${member.id}`;
  if (taken) return "هذا البريد مستخدم لحساب آخر";
  const { error } = await supabaseAdmin.auth.admin.updateUserById(member.id, { email, email_confirm: true });
  if (error) return "تعذّر تحديث البريد في نظام الدخول";
  await atomically(session.db, async tx => {
    await tx`update profiles set email = ${email} where id = ${member.id}`;
    await auditWith(tx, session.audit, { action: "update", entity: "member_contact", entityId: member.id, clusterId: member.clusterId, before: { email: member.email }, after: { email } });
  });
  return null;
}

// ---------- Schools ----------
const count = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(toWesternDigits(String(value ?? "")).replace(/[٬,\s]/g, ""));
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};
const percent = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(toWesternDigits(String(value)).replace(/[%٪\s]/g, "").replace("٫", "."));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : null;
};
const YES = new Set(["نعم", "يوجد", "موجود", "true", "yes", "1"]);
const NO = new Set(["لا", "لا يوجد", "لايوجد", "غير موجود", "false", "no", "0"]);
function yesNo(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = normalizeArabic(cleanText(value));
  if ([...YES].some(item => normalizeArabic(item) === text)) return true;
  if ([...NO].some(item => normalizeArabic(item) === text)) return false;
  return null;
}
const tierOf = (value: string) => TIERS.find(tier => normalizeArabic(tier) === normalizeArabic(value)) ?? null;

/** The school's own columns from an incoming partial school; values main cannot hold there go to `extra` custom fields. */
function schoolColumns(item: Partial<School>, extra: { label: string; value: string }[]) {
  const columns: Record<string, unknown> = {};
  const text = (key: keyof School, column: string, max: number) => {
    const value = cleanText(item[key]);
    if (value) columns[column] = value.slice(0, max);
  };
  text("stage", "stage", 120);
  text("area", "area", 200);
  text("educationType", "educationType", 120);
  text("specialEducation", "specialEdProgram", 200);
  text("email", "ministryEmail", 200);
  const ministryNo = toWesternDigits(cleanText(item.ministryNo));
  if (ministryNo) columns.ministryNo = ministryNo.slice(0, 60);
  for (const key of ["classes", "students", "giftedClasses", "giftedStudents"] as const) {
    if (item[key] === undefined || item[key] === null || (item[key] as unknown) === "") continue;
    const value = count(item[key]);
    if (value !== null) columns[key] = value;
  }
  for (const key of ["hasGuard", "teachesChinese"] as const) {
    if (!cleanText(item[key])) continue;
    const value = yesNo(item[key]);
    if (value !== null) columns[key] = value;
    else extra.push({ label: key === "hasGuard" ? "الحارس" : "تطبيق اللغة الصينية", value: capped(item[key]) });
  }
  const tier = cleanText(item.tier);
  if (tier) {
    const known = tierOf(tier);
    if (known) columns.tier = known;
    else extra.push({ label: "التصنيف", value: tier.slice(0, MAX_VALUE_CHARS) });
  }
  return columns;
}

/** Same defaults as a school created in main's editor (EDITABILITY S-1): two staff tiles and the principal's role. */
async function seedSchool(tx: Sql, schoolId: string) {
  for (const [index, label] of DEFAULT_STAFF_TILES.entries()) await tx`insert into school_staff_tiles ${tx({ schoolId, label, sortOrder: index })}`;
  const [role] = await tx`insert into leadership_roles ${tx({ schoolId, role: DEFAULT_LEADERSHIP_ROLE.role, state: DEFAULT_LEADERSHIP_ROLE.state })} returning id`;
  for (const [index, label] of DEFAULT_LEADERSHIP_ROLE.fields.entries()) await tx`insert into leadership_fields ${tx({ roleId: role.id, label, sortOrder: index })}`;
}

/**
 * Adds schools to a member's file, or fills non-empty values into her schools with the same name: the school row,
 * its staff tiles (teachers/admin/deputies), the principal's name, notes and custom fields, and the evaluation,
 * مدرستي and discipline indicators. Parts of an existing school are undone one by one; a new school is removed whole.
 */
export async function upsertSchools(session: Session, member: MemberRef, incoming: Partial<School>[]) {
  const undo: UndoStep[] = [];
  const notes: string[] = [];
  await atomically(session.db, async tx => {
    const audit = auditFor(tx, session, member.clusterId);
    const schools = [...await tx`select * from schools where cluster_id = ${member.clusterId} and deleted_at is null order by sort_order, created_at`];
    for (const item of incoming) {
      const name = cleanText(item.name).slice(0, 200);
      if (!name) continue;
      const found = schools.find(row => comparable(row.name) === comparable(name));
      const created = !found;
      let school: Row;
      if (found) school = found;
      else {
        [school] = await tx`insert into schools ${tx({ clusterId: member.clusterId, name, sortOrder: await nextSort(tx, "schools", "cluster_id", member.clusterId) })} returning *`;
        await seedSchool(tx, String(school.id));
        await audit({ action: "create", entity: "school", entityId: String(school.id), after: { name } });
        undo.push({ kind: "row", ...owner(member), table: "schools", id: String(school.id), before: null });
        schools.push(school);
      }
      const schoolId = String(school.id);
      const remember = (step: UndoStep) => { if (!created) undo.push(step); };

      const extra: { label: string; value: string }[] = [];
      const columns = schoolColumns(item, extra);
      if (typeof columns.ministryNo === "string") {
        const [taken] = await tx`select id from schools where ministry_no = ${columns.ministryNo} and deleted_at is null and id <> ${schoolId}`;
        if (taken) { notes.push(`الرقم الوزاري ${columns.ministryNo} مسجّل لمدرسة أخرى، فلم أضعه لـ«${name}»`); delete columns.ministryNo; }
      }
      const changed = Object.fromEntries(Object.entries(columns).filter(([key, value]) => school[key] !== value));
      if (Object.keys(changed).length) {
        const before = Object.fromEntries(Object.keys(changed).map(key => [key, school[key]]));
        const [next] = await tx`update schools set ${tx(changed)} where id = ${schoolId} returning *`;
        for (const key of Object.keys(changed)) await audit({ action: "update", entity: "school", entityId: schoolId, field: key, before: before[key], after: changed[key] });
        remember({ kind: "row", ...owner(member), table: "schools", id: schoolId, before });
        Object.assign(school, next);
      }

      const tiles: [keyof typeof TILE_PATTERNS, string][] = [["teachers", DEFAULT_STAFF_TILES[0]], ["admin", DEFAULT_STAFF_TILES[1]], ["deputies", "الوكيلات"]];
      for (const [key, label] of tiles) {
        if (item[key] === undefined || item[key] === null || (item[key] as unknown) === "") continue;
        const value = count(item[key]);
        if (value === null) continue;
        const [tile] = (await tx`select * from school_staff_tiles where school_id = ${schoolId} and deleted_at is null order by sort_order, created_at`)
          .filter(row => TILE_PATTERNS[key].test(normalizeArabic(row.label)));
        if (tile) {
          if (Number(tile.value) === value) continue;
          await tx`update school_staff_tiles set value = ${value} where id = ${tile.id}`;
          await audit({ action: "update", entity: "staff_tile", entityId: String(tile.id), field: "value", before: tile.value, after: value });
          remember({ kind: "row", ...owner(member), table: "school_staff_tiles", id: String(tile.id), before: { value: Number(tile.value) } });
        } else {
          const [row] = await tx`insert into school_staff_tiles ${tx({ schoolId, label, value, sortOrder: await nextSort(tx, "school_staff_tiles", "school_id", schoolId) })} returning id`;
          await audit({ action: "create", entity: "staff_tile", entityId: String(row.id), after: { label, value } });
          remember({ kind: "row", ...owner(member), table: "school_staff_tiles", id: String(row.id), before: null });
        }
      }

      const principal = capped(item.principal);
      if (principal) {
        let [role] = (await tx`select * from leadership_roles where school_id = ${schoolId} and deleted_at is null order by sort_order, created_at`)
          .filter(row => PRINCIPAL_ROLE.test(normalizeArabic(row.role)));
        if (!role) {
          [role] = await tx`insert into leadership_roles ${tx({ schoolId, role: DEFAULT_LEADERSHIP_ROLE.role, state: DEFAULT_LEADERSHIP_ROLE.state, sortOrder: await nextSort(tx, "leadership_roles", "school_id", schoolId) })} returning *`;
          await audit({ action: "create", entity: "leadership_role", entityId: String(role.id), after: { role: role.role } });
          remember({ kind: "row", ...owner(member), table: "leadership_roles", id: String(role.id), before: null });
        }
        const fields = await tx`select * from leadership_fields where role_id = ${role.id} and deleted_at is null order by sort_order, created_at`;
        const field = fields.find(row => comparable(row.label) === comparable("الاسم")) ?? fields[0];
        if (field && field.value !== principal) {
          await tx`update leadership_fields set value = ${principal} where id = ${field.id}`;
          await audit({ action: "update", entity: "leadership_field", entityId: String(field.id), field: "value", before: field.value, after: principal });
          remember({ kind: "row", ...owner(member), table: "leadership_fields", id: String(field.id), before: { value: field.value } });
        } else if (!field) {
          const [row] = await tx`insert into leadership_fields ${tx({ roleId: role.id, label: "الاسم", value: principal })} returning id`;
          await audit({ action: "create", entity: "leadership_field", entityId: String(row.id), after: { label: "الاسم", value: principal } });
          remember({ kind: "row", ...owner(member), table: "leadership_fields", id: String(row.id), before: null });
        }
      }

      // Evaluation numbers main keeps as percentages; anything else is kept as text in a custom field.
      const evaluation: Record<string, unknown> = {};
      if (cleanText(item.support)) evaluation.supportType = cleanText(item.support).slice(0, 200);
      for (const [key, column, label] of [["nafes", "nafesValue", "نافس"], ["qudrat", "qudrat", "قدرات"], ["tahsili", "tahsili", "تحصيلي"]] as const) {
        const raw = item[key];
        if (raw === undefined || raw === null || cleanText(raw) === "") continue;
        const value = percent(raw);
        if (value !== null) evaluation[column] = value;
        else extra.push({ label, value: capped(raw) });
      }
      if (Object.keys(evaluation).length) {
        await setIndicator(tx, session, member, schoolId, "evaluation_indicators", { ...evaluation, importedAt: new Date(), importedBy: session.head.id }, remember);
      }
      if (Array.isArray(item.madrasati) && item.madrasati.length === MADRASATI_METRICS.length && item.madrasati.every(value => percent(value) !== null)) {
        await setIndicator(tx, session, member, schoolId, "madrasati_indicators", Object.fromEntries(MADRASATI_METRICS.map((metric, index) => [metric.key, percent(item.madrasati![index])])), remember);
      }
      if (Array.isArray(item.discipline) && item.discipline.length === 3 && item.discipline.every(value => percent(value) !== null)) {
        const [daily, weekly, monthly] = item.discipline.map(percent);
        await setIndicator(tx, session, member, schoolId, "discipline_indicators", { daily, weekly, monthly }, remember);
      }

      const custom = [
        ...(cleanText(item.notes) ? [{ label: "ملاحظات", value: capped(item.notes) }] : []),
        ...extra,
        ...(item.customFields ?? []).map(field => ({ label: cleanText(field.label), value: capped(field.value) })),
      ].filter(field => field.label && field.value);
      if (custom.length) {
        const existing = [...await tx`select * from school_custom_fields where school_id = ${schoolId} and deleted_at is null order by sort_order, created_at`];
        for (const field of custom) {
          const row = existing.find(item => comparable(item.label) === comparable(field.label));
          if (row) {
            if (row.value === field.value) continue;
            await tx`update school_custom_fields set value = ${field.value} where id = ${row.id}`;
            await audit({ action: "update", entity: "school_custom_field", entityId: String(row.id), field: "value", before: row.value, after: field.value });
            remember({ kind: "row", ...owner(member), table: "school_custom_fields", id: String(row.id), before: { value: row.value } });
            row.value = field.value;
          } else {
            const label = field.label.slice(0, 200);
            const [created] = await tx`insert into school_custom_fields ${tx({ schoolId, label, value: field.value, sortOrder: await nextSort(tx, "school_custom_fields", "school_id", schoolId) })} returning *`;
            await audit({ action: "create", entity: "school_custom_field", entityId: String(created.id), after: { label, value: field.value } });
            remember({ kind: "row", ...owner(member), table: "school_custom_fields", id: String(created.id), before: null });
            existing.push(created);
          }
        }
      }
    }
  });
  return { undo, notes };
}

async function setIndicator(tx: Sql, session: Session, member: MemberRef, schoolId: string, table: IndicatorTable, values: Record<string, unknown>, remember: (step: UndoStep) => void) {
  const [before] = await tx`select * from ${tx(table)} where school_id = ${schoolId}`;
  await tx`insert into ${tx(table)} ${tx({ schoolId, ...values })} on conflict (school_id) do update set ${tx(values)}`;
  const { importedAt: _at, importedBy: _by, ...shown } = values;
  await auditWith(tx, session.audit, { action: "update", entity: table, entityId: schoolId, clusterId: member.clusterId, after: shown });
  remember({ kind: "indicator", ...owner(member), table, schoolId, before: before ? Object.fromEntries(Object.keys(values).map(key => [key, before[key]])) : null });
}

// ---------- Accounts & documents ----------
/** A new member account (not activated: she chooses her password at first sign-in). Throws ApiError 409/422/502. */
export async function createTeamMember(session: Session, input: MemberCreateInput): Promise<MemberRef> {
  const { userId, clusterId } = await createMemberAccount(session.db, { ...input, districtId: session.head.districtId }, session.audit);
  return { id: userId, name: cleanText(input.name), email: normalizeEmail(input.email), clusterId, activated: false };
}

/** Files a document into a member's file (null: back to the head's unfiled uploads). */
export async function fileDocument(session: Session, documentId: string, memberId: string | null) {
  const before = await findDocument(session.db, documentId);
  if (!before || before.districtId !== session.head.districtId) return null;
  const after = await assignDocument(session.db, documentId, memberId, session.audit);
  return after ? { before, after } : null;
}

// ---------- Undo ----------
/** The undo table's value for a field the change had created (so undoing removed it). */
export const REMOVED_FIELD = "(أزلت الحقل)";

export type UndoOutcome = { rows: string[][]; notes: string[]; values: number; schoolMembers: Map<string, string>; files: number; created: number; members: Map<string, string> };

async function rowInCluster(tx: Sql, table: RowTable, id: string, clusterId: string) {
  if (!isUuid(id)) return false;
  const rows = table === "schools" ? await tx`select id from schools where id = ${id} and cluster_id = ${clusterId}`
    : table === "leadership_fields" ? await tx`select f.id from leadership_fields f join leadership_roles r on r.id = f.role_id join schools s on s.id = r.school_id where f.id = ${id} and s.cluster_id = ${clusterId}`
    : await tx`select t.id from ${tx(table)} t join schools s on s.id = t.school_id where t.id = ${id} and s.cluster_id = ${clusterId}`;
  return rows.length > 0;
}

async function clusterInDistrict(db: Sql, session: Session, clusterId: string) {
  if (!isUuid(clusterId)) return false;
  return (await db`select id from clusters where id = ${clusterId} and district_id = ${session.head.districtId}`).length > 0;
}

/** Puts back what a change did, newest step first. Steps that can no longer be undone are reported as notes. */
export async function runUndo(session: Session, plan: UndoPlan, outcome: UndoOutcome) {
  for (const step of [...plan.steps].reverse()) {
    try {
      if (step.kind === "file") {
        await fileDocument(session, step.documentId, step.ownerId);
        outcome.files += 1;
        continue;
      }
      if (step.kind === "member") {
        const result = await removeCreatedMember(session, step);
        if (result === "removed") { outcome.rows.push([step.name, "حساب جديد", "(حذفته)"]); outcome.created += 1; }
        else if (result !== "gone") outcome.notes.push(`${step.name}: ${KEPT_ACCOUNT[result]} — لم أحذف حسابها ولا شيئاً من ملفها`);
        continue;
      }
      if (!(await clusterInDistrict(session.db, session, step.clusterId))) continue;
      const audit = (tx: Sql) => auditFor(tx, session, step.clusterId);
      if (step.kind === "field") {
        await atomically(session.db, async tx => {
          const [row] = await tx`select * from profile_fields where id = ${step.rowId} and cluster_id = ${step.clusterId}`;
          if (!row) return;
          if (step.before === null) {
            await tx`update profile_fields set deleted_at = now() where id = ${row.id}`;
            await audit(tx)({ action: "delete", entity: "profile_field", entityId: String(row.id), before: { label: row.label, value: row.value } });
          } else {
            await tx`update profile_fields set value = ${step.before} where id = ${row.id}`;
            await audit(tx)({ action: "update", entity: "profile_field", entityId: String(row.id), field: "value", before: row.value, after: step.before });
            await syncAccount(tx, step.memberId, row.fieldKey, step.before);
          }
        });
        outcome.rows.push([step.memberName, step.label, step.before === null ? REMOVED_FIELD : step.before]);
        outcome.values += 1;
      } else if (step.kind === "cluster") {
        await atomically(session.db, async tx => {
          const [cluster] = await tx`select label from clusters where id = ${step.clusterId}`;
          await tx`update clusters set label = ${step.before} where id = ${step.clusterId}`;
          await audit(tx)({ action: "update", entity: "member_contact", entityId: step.memberId, before: { clusterLabel: cluster?.label }, after: { clusterLabel: step.before } });
        });
        outcome.rows.push([step.memberName, "العنقود", step.before]);
        outcome.values += 1;
      } else if (step.kind === "login") {
        const member = await findMember(session.db, session, step.memberId);
        const error = member ? await changeLoginEmail(session, member, step.before) : "الحساب غير موجود";
        if (error) outcome.notes.push(`${step.memberName} — بريد الدخول: ${error}`);
        else { outcome.rows.push([step.memberName, "بريد الدخول", step.before]); outcome.values += 1; }
      } else if (step.kind === "row") {
        if (!Object.hasOwn(ROW_TABLES, step.table)) continue;
        await atomically(session.db, async tx => {
          if (!(await rowInCluster(tx, step.table, step.id, step.clusterId))) return;
          if (step.before === null) await tx`update ${tx(step.table)} set deleted_at = now() where id = ${step.id}`;
          else await tx`update ${tx(step.table)} set ${tx(step.before)} where id = ${step.id}`;
          await audit(tx)({ action: step.before === null ? "delete" : "update", entity: ROW_TABLES[step.table], entityId: step.id, after: step.before });
        });
        outcome.schoolMembers.set(step.memberId, step.memberName);
      } else if (step.kind === "indicator") {
        if (!INDICATOR_TABLES.includes(step.table)) continue;
        await atomically(session.db, async tx => {
          if (!(await rowInCluster(tx, "schools", step.schoolId, step.clusterId))) return;
          if (step.before === null) await tx`delete from ${tx(step.table)} where school_id = ${step.schoolId}`;
          else await tx`update ${tx(step.table)} set ${tx(step.before)} where school_id = ${step.schoolId}`;
          await audit(tx)({ action: "update", entity: step.table, entityId: step.schoolId, after: step.before });
        });
        outcome.schoolMembers.set(step.memberId, step.memberName);
      }
      outcome.members.set(step.memberId, step.memberName);
    } catch (error) {
      console.error("undo step failed", step.kind, error);
      outcome.notes.push("تعذّر إرجاع جزء من التغييرات");
    }
  }
}

type KeptReason = "activated" | "signed_in" | "unverified" | "changed" | "has_data";

const KEPT_ACCOUNT: Record<KeptReason, string> = {
  activated: "فعّلت حسابها",
  signed_in: "سبق أن دخلت المنصة",
  unverified: "تعذّر التأكد من أنها لم تدخل المنصة",
  changed: "تغيّر ملفها بعد إنشائه",
  has_data: "في ملفها بيانات (مدارس أو زيارات أو ملفات)",
};

/** A new account as it is right after the agent created (and filled) it: the undo checks that nothing happened since. */
export async function createdMemberMark(db: Sql, member: MemberRef) {
  const [mark] = await db`select coalesce(max(id), 0)::text as id from audit_log`;
  const fields = await db`select id, value from profile_fields where cluster_id = ${member.clusterId} and deleted_at is null and btrim(value) <> ''`;
  return { auditMark: String(mark.id), seeded: Object.fromEntries(fields.map(row => [String(row.id), String(row.value)])) };
}

type CreatedMember = Extract<UndoStep, { kind: "member" }>;

/** Why a new account must be kept instead of removed (null: nothing has happened in it since it was created). */
async function keptReason(db: Sql, member: MemberRef, step: CreatedMember): Promise<KeptReason | null> {
  if (member.activated) return "activated";
  if (step.auditMark === undefined || !step.seeded) return "unverified";
  const signIns = await lastSignIns(db, [member.id]);
  if (!signIns) return "unverified";
  if (signIns.get(member.id)) return "signed_in";
  const [row] = await db`
    select
      exists (select 1 from schools where cluster_id = ${member.clusterId}) as schools,
      exists (select 1 from visit_reports where cluster_id = ${member.clusterId}) as visits,
      exists (select 1 from attachments where cluster_id = ${member.clusterId}) as files,
      exists (select 1 from pd_programs where cluster_id = ${member.clusterId}) as programs,
      exists (select 1 from custom_sections where cluster_id = ${member.clusterId}) as sections,
      exists (select 1 from daily_submissions where member_id = ${member.id}) as worked,
      exists (select 1 from audit_log where id > ${step.auditMark}::bigint and action <> 'read_pii'
        and (cluster_id = ${member.clusterId} or entity_id = ${member.id})) as changed`;
  if (row.schools || row.visits || row.files || row.programs || row.sections) return "has_data";
  const fields = await db`select id, value from profile_fields where cluster_id = ${member.clusterId} and deleted_at is null and btrim(value) <> ''`;
  if (fields.some(field => step.seeded![String(field.id)] !== String(field.value))) return "has_data";
  if (row.changed || row.worked) return "changed";
  return null;
}

/**
 * Removes an account the agent created — only while nothing has happened in it: never activated or signed in, nothing
 * changed in her file since it was created (by her, the head or the agent), no schools, visits or files, and no profile
 * values beyond the ones it was created with. Otherwise she is kept and the reason returned: refusing is always safer.
 */
async function removeCreatedMember(session: Session, step: CreatedMember): Promise<"removed" | "gone" | KeptReason> {
  const member = await findMember(session.db, session, step.memberId);
  if (!member) return "gone";
  const kept = await keptReason(session.db, member, step);
  if (kept) return kept;
  await atomically(session.db, async tx => {
    await auditWith(tx, session.audit, { action: "delete", entity: "member", entityId: member.id, clusterId: null, before: { name: member.name, email: member.email } });
    await tx`delete from profiles where id = ${member.id}`; // her (empty) cluster and file go with it (on delete cascade)
  });
  const { error } = await supabaseAdmin.auth.admin.deleteUser(member.id);
  if (error) console.error("could not delete the auth user", member.id, error.message);
  return "removed";
}
