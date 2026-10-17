// Every head action the agent may take through the API (internal-api.ts runs them in-process as رئيسة النطاق).
// The model never sends a path: it names a route id with its params, and the path is built here from the template —
// every param an id (uuid), or "$N.id" for what an earlier action of the same card creates — URL-encoded.
// Each change is described on the approval card from the database (describe), never from the model's own words.
import {
  EDUCATION_TYPES, EVALUATION_DOMAINS, KPI_EVALUATION_TYPES, KPI_FOLLOW_UP_LEVELS, KPI_STANDARDS, LEADERSHIP_STATES, MADRASATI_METRICS,
  NAFES_GRADES, PD_KINDS, SCHOOL_BASE_FIELDS, STAGES, TIERS, folderPath, type FolderLayout, type ProposalChange,
} from "@rasd/schemas";
import type { Row } from "../db.js";
import type { DocumentRow } from "../documents.js";
import { isUuid } from "../parse.js";
import { ar, count, countGen, NOUNS, shortName } from "./render.js";

export type Risk = "read" | "write" | "destructive";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Counted on the card's summary line («حذف ١ · تعديل ٣ · إضافة ٢»), in this order. */
export const KINDS = ["حذف", "تعديل", "إضافة", "استعادة", "ترتيب"] as const;
export type Kind = (typeof KINDS)[number];

/** One request as the model asks for it: a route id, its path params, and a query (reads) or a body (changes). */
export type ApiAction = { route: string; params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown> };

/** Rows the actions refer to, read in one batch per table (api-actions.ts). */
export type EntityTable =
  | "profile_fields" | "schools" | "school_custom_fields" | "school_staff_tiles" | "leadership_roles" | "leadership_fields" | "pd_programs"
  | "custom_sections" | "custom_section_fields" | "evaluation_indicators" | "madrasati_indicators" | "discipline_indicators"
  | "school_kpis" | "kpi_imports" | "clusters";
export type Ref = [table: EntityTable, id: string];

/** One change as the approval card shows it. `label` names what it creates, for a later "$N.id". */
export type Described = {
  title: string;
  kind: Kind;
  rows: ProposalChange[];
  label?: string;
  /** PATCH: when the row was read; the change is refused (409) if someone edits it before she approves. */
  expectedUpdatedAt?: string;
};

/** A member as the card names her (empty ids for one the same card creates). */
export type TeamMember = { id: string; name: string; clusterId: string; email: string; phone: string; title: string; clusterLabel: string };
export type DescribeContext = {
  entry: CatalogEntry;
  /** A member of her team (null: not hers). */
  member: (id: string) => TeamMember | null;
  /** A referenced row in her district (cluster rows carry `ownerCluster`), in any state; null when it is not there. */
  row: (table: EntityTable, id: string) => Row | null;
  layout: (clusterId: string) => FolderLayout;
  document: (id: string) => DocumentRow | null;
  schoolName: (id: string) => string;
  /** What an earlier action of this card creates ("$2.id"). */
  earlier: (ref: string) => Described | null;
  /** This action's dry run (folders): what the API says it would do. */
  dryRun: unknown;
};

export type CatalogEntry = {
  id: string;
  method: Method;
  /** The registered route path (internal-api.ts matches it exactly). */
  path: string;
  /** Arabic purpose (the API reference in the system prompt). */
  label: string;
  risk: Risk | ((action: ApiAction) => Risk);
  /** The answer carries text read out of uploaded files: it reaches the model as <untrusted_document> and stops immediate writes. */
  documentText?: boolean;
  /** Query keys a read takes, with their values for the reference ("" = free text). */
  query?: Record<string, string>;
  /** Body fields for the reference. */
  body?: string;
  /** Resource routes share one reference line. */
  resource?: string;
  /** Run only by a tool of its own (import_kpis): never offered to the model as a route. */
  hidden?: boolean;
  refs?: (action: ApiAction) => Ref[];
  /** describe needs the API's dry run of the action (folders bulk/sync). */
  dryRun?: boolean;
  describe?: (ctx: DescribeContext, action: ApiAction) => Described;
};

/** A request the catalog refuses (unknown route, a param that is not an id, a row that is not hers…). Nothing is stored. */
export class ActionError extends Error {}

// ---------- Values as the card shows them ----------
const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(SCHOOL_BASE_FIELDS.map(field => [field.key, field.label])),
  name: "الاسم", label: "الاسم", value: "القيمة", span: "عرض الحقل", role: "الدور", state: "الحالة", tier: "التصنيف", kind: "النوع",
  count: "العدد", reportsUrl: "رابط التقارير", status: "الحالة", email: "بريد الدخول", phone: "الجوال", title: "الصفة", clusterLabel: "العنقود",
  nafesCardFolderUrl: "مجلد بطاقات نافس", externalReportUrl: "رابط تقرير التقويم الخارجي", externalReportStatus: "تقرير التقويم الخارجي",
  selfReportUrl: "رابط تقرير التقويم الذاتي", supportType: "نوع الدعم", qudrat: "القدرات", tahsili: "التحصيلي", nafesValue: "نافس",
  nafesDirection: "اتجاه نافس", nafesDelta: "تغيّر نافس", level: "المستوى", percent: "النسبة",
  ...Object.fromEntries(EVALUATION_DOMAINS.map(domain => [domain.key, domain.label])),
  ...Object.fromEntries(NAFES_GRADES.map(grade => [grade.key, `نافس ${grade.label}`])),
  daily: "الانضباط اليومي", weekly: "الانضباط الأسبوعي", monthly: "الانضباط الشهري", planStatus: "خطة الانضباط", planUrl: "رابط خطة الانضباط",
  ...Object.fromEntries(MADRASATI_METRICS.map(metric => [metric.key, metric.label])),
  year: "العام", ministryNo: "الرقم الوزاري", schoolName: "اسم المدرسة", authority: "السلطة", region: "المنطقة/المحافظة", sector: "القطاع",
  evaluationType: "نوع التقويم", overallScore: "المستوى العام", outcomesScore: "درجة النواتج", followUpLevel: "مستوى المتابعة",
  note: "ملاحظة", assignedMemberId: "المشرفة المتابعة", memberName: "اسم المتابعة في الملف", scope: "مؤشرات الأداء التي تراها", date: "التاريخ", format: "الصيغة",
  ...Object.fromEntries(KPI_STANDARDS.map(standard => [standard.key, standard.label])),
};
const VALUE_LABELS: Record<string, Record<string, string>> = {
  kind: PD_KINDS,
  status: { uploaded: "مرفوعة", missing: "غير مرفوعة" },
  externalReportStatus: { uploaded: "مرفوع", missing: "غير مرفوع" },
  planStatus: { approved: "معتمدة", missing: "غير مرفوعة" },
  nafesDirection: { up: "ارتفاع", down: "انخفاض" },
  scope: { own: "مدارسها فقط", district: "كل مدارس النطاق" },
  format: { text: "نص", excel: "Excel" },
};
const YES_NO = Object.fromEntries(SCHOOL_BASE_FIELDS.filter(field => field.kind === "boolean").map(field => [field.key, [field.yes!, field.no!]]));
const NOT_SENT = new Set(["id", "expectedUpdatedAt", "schoolId", "dryRun"]);

const fieldName = (key: string) => FIELD_LABELS[key] ?? key;

function shown(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return (YES_NO[key] ?? ["نعم", "لا"])[value ? 0 : 1];
  if (typeof value === "string") return VALUE_LABELS[key]?.[value] ?? value;
  if (Array.isArray(value)) return value.map(item => shown(key, item)).join("، ");
  if (typeof value === "object") return Object.entries(value).map(([inner, item]) => `${fieldName(inner)}: ${shown(inner, item)}`).join(" · ");
  return String(value);
}

type Base = Pick<ProposalChange, "memberId" | "memberName" | "fieldId">;
const baseOf = (ctx: DescribeContext, member: { id: string; name: string }): Base => ({ memberId: member.id, memberName: member.name, fieldId: ctx.entry.id });
const REGISTER = { id: "", name: "سجل مؤشرات الأداء" };
const DISTRICT = { id: "", name: "النطاق" };

/** One row per field that changes (objects such as مجالات التقويم or المعايير: one row per key sent). */
function fieldRows(base: Base, subject: string, before: Row | null, body: Record<string, unknown>, show = shown): ProposalChange[] {
  return Object.entries(body).filter(([key]) => !NOT_SENT.has(key)).flatMap(([key, value]) => {
    const nested = value && typeof value === "object" && !Array.isArray(value);
    const pairs: [string, unknown, unknown][] = nested
      ? Object.entries(value as Row).map(([inner, item]) => [inner, (before?.[key] as Row | undefined)?.[inner], item])
      : [[key, before?.[key], value]];
    return pairs.flatMap(([name, previous, next]) => {
      const from = show(name, previous);
      const to = show(name, next);
      return from === to ? [] : [{ ...base, fieldLabel: `${subject}: ${fieldName(name)}`, before: from, after: to }];
    });
  });
}

// ---------- Params, placeholders, paths ----------
const PLACEHOLDER = /^\$(\d+)\.id$/;
/** "$3.id" → 2 (the index of the action whose created id it stands for); null for anything else. */
export const placeholderIndex = (value: unknown) => {
  const match = typeof value === "string" ? PLACEHOLDER.exec(value) : null;
  return match ? Number(match[1]) - 1 : null;
};
export const paramNames = (path: string) => [...path.matchAll(/:(\w+)/g)].map(match => match[1]);
const memberParam = (path: string) => /^\/district\/members\/:(\w+)/.exec(path)?.[1] ?? null;

/** The path with each param URL-encoded (params are ids by then; see checkAction). */
export function pathOf(entry: CatalogEntry, params: Record<string, string>, query?: Record<string, string>) {
  const path = entry.path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
  const search = new URLSearchParams(query ?? {}).toString();
  return search ? `${path}?${search}` : path;
}

export const riskOf = (entry: CatalogEntry, action: ApiAction) => (typeof entry.risk === "function" ? entry.risk(action) : entry.risk);

function checkPlaceholders(value: unknown, index: number, where: string): void {
  if (typeof value === "string") {
    const ref = placeholderIndex(value);
    if (ref !== null && (ref < 0 || ref >= index)) throw new ActionError(`${where}: "${value}" must point at an EARLIER action of this request.`);
  } else if (Array.isArray(value)) value.forEach(item => checkPlaceholders(item, index, where));
  else if (value && typeof value === "object") Object.values(value).forEach(item => checkPlaceholders(item, index, where));
}

/**
 * Checks one action against the catalog: a known route of the right kind (reads with api_get, changes with
 * propose_actions), exactly its params — each a uuid, or "$N.id" of an earlier action — and only its query keys.
 */
export function checkAction(action: ApiAction, index: number, use: "read" | "change"): CatalogEntry {
  const entry = BY_ID.get(action.route);
  if (!entry || entry.hidden) throw new ActionError(`Unknown route "${action.route}". Use a route id from the API reference.`);
  if ((riskOf(entry, action) === "read") !== (use === "read")) {
    throw new ActionError(use === "read" ? `"${entry.id}" changes data: put it in propose_actions.` : `"${entry.id}" only reads: use api_get.`);
  }
  const names = paramNames(entry.path);
  const params = action.params ?? {};
  for (const key of Object.keys(params)) if (!names.includes(key)) throw new ActionError(`"${entry.id}" has no param "${key}" (params: ${names.join(", ") || "none"}).`);
  for (const name of names) {
    const value = params[name];
    const ref = placeholderIndex(value);
    if (ref === null ? !isUuid(value) : ref < 0 || ref >= index) {
      throw new ActionError(`Param "${name}" of "${entry.id}" must be an id (uuid)${use === "change" ? ', or "$N.id" of an earlier action' : ""}.`);
    }
  }
  for (const key of Object.keys(action.query ?? {})) if (!entry.query || !(key in entry.query)) throw new ActionError(`"${entry.id}" takes no query "${key}".`);
  if (action.body !== undefined && (use === "read" || typeof action.body !== "object" || Array.isArray(action.body))) {
    throw new ActionError(`"${entry.id}" takes ${use === "read" ? "no body" : "a JSON object body"}.`);
  }
  checkPlaceholders(action.body, index, `"${entry.id}" body`);
  return entry;
}

// ---------- Describing ----------
/** The member a /district/members/:x/… action works on (a member created earlier in the card counts too). */
function memberOf(ctx: DescribeContext, id: string | undefined): TeamMember {
  if (placeholderIndex(id) !== null) {
    return { id: "", name: ctx.earlier(id!)?.label ?? "العضوة الجديدة", clusterId: "", email: "", phone: "", title: "", clusterLabel: "" };
  }
  const member = id ? ctx.member(id) : null;
  if (!member) throw new ActionError(`No member with id "${id}" in her team (use find_member).`);
  return member;
}
const pathMember = (ctx: DescribeContext, action: ApiAction) => memberOf(ctx, action.params?.[memberParam(ctx.entry.path) ?? ""]);

const NOUN_OF: Partial<Record<EntityTable, string>> = { school_kpis: "مدرسة السجل", kpi_imports: "الاستيراد" };

/** A row of her file (or her district) by id, in the state the action needs. */
function entity(ctx: DescribeContext, table: EntityTable, id: string | undefined, owner: TeamMember | null, state: "live" | "deleted" = "live") {
  const row = id ? ctx.row(table, id) : null;
  const what = NOUN_OF[table] ?? table;
  // A member created by this same card has no rows yet: an id from elsewhere is never hers.
  if (!row || (owner && row.ownerCluster !== owner.clusterId)) {
    throw new ActionError(`${what} "${id}" was not found${owner ? ` in ${owner.name}'s file` : ""} — read the ids again (api_get / get_member / query_kpis).`);
  }
  if (state === "live" && row.deletedAt) throw new ActionError(`${what} "${id}" is deleted (restore it first).`);
  if (state === "deleted" && !row.deletedAt) throw new ActionError(`${what} "${id}" is not deleted.`);
  return row;
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === "string" ? value : undefined);
const quoted = (text: unknown) => `«${String(text ?? "")}»`;
const nonEmpty = (rows: ProposalChange[], what: string) => {
  if (!rows.length) throw new ActionError(`${what}: nothing would change (the values already match). Leave it out.`);
  return rows;
};

// ---------- her file: one set of routes per resource ----------
type Resource = {
  key: string; path: string; noun: string; plural: string; table: EntityTable; parent?: EntityTable;
  labelKey: "label" | "name" | "role"; fresh: string; body: string;
};
const list = (values: readonly string[]) => values.join("|");
const RESOURCES: Resource[] = [
  { key: "profile_field", path: "/profile-fields", noun: "حقل", plural: "حقول البيانات الأولية", table: "profile_fields", labelKey: "label", fresh: "حقل جديد", body: "label, value, span(1|2)" },
  {
    key: "school", path: "/schools", noun: "مدرسة", plural: "المدارس", table: "schools", labelKey: "name", fresh: "مدرسة جديدة",
    body: `name, stage(${list(STAGES)}), area, ministryNo, ministryEmail, educationType(${list(EDUCATION_TYPES)}), specialEdProgram, hasGuard(bool), classes, students, giftedClasses, giftedStudents, teachesChinese(bool), tier(${list(TIERS)}|null)`,
  },
  { key: "school_field", path: "/schools/:parentId/custom-fields", noun: "حقل", plural: "حقول المدرسة", table: "school_custom_fields", parent: "schools", labelKey: "label", fresh: "حقل جديد", body: "label, value" },
  { key: "staff_tile", path: "/schools/:parentId/staff-tiles", noun: "مؤشر", plural: "الهيئة التعليمية والإدارية", table: "school_staff_tiles", parent: "schools", labelKey: "label", fresh: "مؤشر جديد", body: "label, value(عدد)" },
  { key: "leadership_role", path: "/schools/:parentId/leadership", noun: "دور", plural: "القيادة المدرسية", table: "leadership_roles", parent: "schools", labelKey: "role", fresh: "دور جديد", body: `role, state(${list(LEADERSHIP_STATES)})` },
  { key: "leadership_field", path: "/leadership/:parentId/fields", noun: "حقل", plural: "حقول الدور القيادي", table: "leadership_fields", parent: "leadership_roles", labelKey: "label", fresh: "حقل جديد", body: "label, value" },
  {
    key: "pd", path: "/pd", noun: "برنامج", plural: "التطوير المهني", table: "pd_programs", labelKey: "label", fresh: "برنامج جديد",
    body: `kind(${Object.entries(PD_KINDS).map(([key, label]) => `${key}=${label}`).join("|")}), label, count, reportsUrl, status(uploaded=مرفوعة|missing=غير مرفوعة)`,
  },
  { key: "section", path: "/sections", noun: "قسم", plural: "الأقسام المخصصة", table: "custom_sections", labelKey: "label", fresh: "قسم جديد", body: "label" },
  { key: "section_field", path: "/sections/:parentId/fields", noun: "حقل", plural: "حقول القسم", table: "custom_section_fields", parent: "custom_sections", labelKey: "label", fresh: "حقل جديد", body: "label, value" },
];
const HEAD = "/district/members/:memberId";

function resourceEntries(resource: Resource): CatalogEntry[] {
  const listPath = `${HEAD}${resource.path}`;
  const itemPath = `${listPath}/:id`;
  const parentRef = (action: ApiAction): Ref[] =>
    resource.parent && placeholderIndex(action.params?.parentId) === null ? [[resource.parent, action.params?.parentId ?? ""]] : [];
  /** « في «الابتدائية ١٢٠»» for a part of a school, role or section. */
  const where = (ctx: DescribeContext, action: ApiAction, member: TeamMember, row?: Row) => {
    if (!resource.parent) return "";
    if (row) return ` في ${quoted(row.parentLabel)}`;
    const parentId = action.params?.parentId;
    if (placeholderIndex(parentId) !== null) return ` في ${quoted(ctx.earlier(parentId!)?.label)}`;
    const parent = entity(ctx, resource.parent, parentId, member);
    return ` في ${quoted(parent[resource.parent === "leadership_roles" ? "role" : resource.parent === "schools" ? "name" : "label"])}`;
  };
  const item = (ctx: DescribeContext, action: ApiAction, state: "live" | "deleted" = "live") => {
    const member = pathMember(ctx, action);
    const row = entity(ctx, resource.table, action.params?.id, member, state);
    return { member, row, name: `${resource.noun} ${quoted(row[resource.labelKey])}${where(ctx, action, member, row)}` };
  };
  const shared = { resource: resource.key, body: resource.body };
  return [
    { id: `${resource.key}_list`, method: "GET", path: listPath, label: resource.plural, risk: "read", ...shared },
    {
      id: `${resource.key}_create`, method: "POST", path: listPath, label: `إضافة ${resource.noun}`, risk: "write", ...shared, refs: parentRef,
      describe: (ctx, action) => {
        const member = pathMember(ctx, action);
        const body = action.body ?? {};
        const label = String(body[resource.labelKey] ?? resource.fresh);
        const details = Object.entries(body).filter(([key]) => key !== resource.labelKey && !NOT_SENT.has(key)).map(([key, value]) => `${fieldName(key)}: ${shown(key, value)}`);
        const title = `إضافة ${resource.noun} ${quoted(label)}${where(ctx, action, member)}`;
        return { title, kind: "إضافة", label, rows: [{ ...baseOf(ctx, member), fieldLabel: title, before: "", after: [label, ...details].join(" · ") }] };
      },
    },
    {
      id: `${resource.key}_update`, method: "PATCH", path: itemPath, label: `تعديل ${resource.noun}`, risk: "write", ...shared,
      refs: action => [[resource.table, action.params?.id ?? ""]],
      describe: (ctx, action) => {
        const { member, row, name } = item(ctx, action);
        const rows = nonEmpty(fieldRows(baseOf(ctx, member), name, row, action.body ?? {}), ctx.entry.id);
        return { title: `تعديل ${name}`, kind: "تعديل", rows, expectedUpdatedAt: iso(row.updatedAt) };
      },
    },
    {
      id: `${resource.key}_delete`, method: "DELETE", path: itemPath, label: `حذف ${resource.noun}`, risk: "write", ...shared,
      refs: action => [[resource.table, action.params?.id ?? ""]],
      describe: (ctx, action) => {
        const { member, row, name } = item(ctx, action);
        return { title: `حذف ${name}`, kind: "حذف", rows: [{ ...baseOf(ctx, member), fieldLabel: `حذف ${name}`, before: String(row[resource.labelKey]), after: "(يُحذف)" }] };
      },
    },
    {
      id: `${resource.key}_restore`, method: "POST", path: `${itemPath}/restore`, label: `استعادة ${resource.noun} محذوف`, risk: "write", ...shared,
      refs: action => [[resource.table, action.params?.id ?? ""]],
      describe: (ctx, action) => {
        const { member, row, name } = item(ctx, action, "deleted");
        return { title: `استعادة ${name}`, kind: "استعادة", rows: [{ ...baseOf(ctx, member), fieldLabel: `استعادة ${name}`, before: "(محذوف)", after: String(row[resource.labelKey]) }] };
      },
    },
    {
      id: `${resource.key}_order`, method: "PUT", path: `${listPath}/order`, label: `ترتيب ${resource.plural}`, risk: "write", ...shared,
      refs: action => [...parentRef(action), ...(Array.isArray(action.body?.ids) ? action.body.ids : []).map((id): Ref => [resource.table, String(id)])],
      describe: (ctx, action) => {
        const member = pathMember(ctx, action);
        const ids = Array.isArray(action.body?.ids) ? action.body.ids.map(String) : [];
        const rows = ids.map(id => entity(ctx, resource.table, id, member));
        const labels = (items: Row[]) => items.map(row => String(row[resource.labelKey])).join("، ");
        const title = `ترتيب ${resource.plural}${where(ctx, action, member)}`;
        const before = [...rows].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
        return { title, kind: "ترتيب", rows: [{ ...baseOf(ctx, member), fieldLabel: title, before: labels(before), after: labels(rows) }] };
      },
    },
  ];
}

// ---------- التقويم المدرسي (the head's mirrors of the member's indicator editors) ----------
function indicatorEntry(id: string, table: EntityTable, name: string, label: string, body: string): CatalogEntry {
  return {
    id, method: "PUT", path: `${HEAD}/indicators/${name}`, label, risk: "write", body,
    refs: action => {
      const schoolId = action.body?.schoolId;
      return isUuid(schoolId) ? [["schools", schoolId], [table, schoolId]] : [];
    },
    describe: (ctx, action) => {
      const member = pathMember(ctx, action);
      const body = action.body ?? {};
      const school = body.schoolId === undefined ? null : entity(ctx, "schools", String(body.schoolId), member);
      const subject = school ? `${label} ${quoted(school.name)}` : label;
      const before = school ? ctx.row(table, String(school.id)) : null;
      const values = name === "madrasati" && Array.isArray(body.metrics)
        ? Object.fromEntries(MADRASATI_METRICS.map((metric, index) => [metric.key, (body.metrics as unknown[])[index]]))
        : body;
      const rows = nonEmpty(fieldRows(baseOf(ctx, member), subject, before, values), id);
      return { title: `تعديل ${subject}`, kind: "تعديل", rows };
    },
  };
}

// ---------- folders ----------
type FolderOp = { type?: string; key?: string; label?: string; parentKey?: string | null; keys?: string[] };
type BulkResult = { memberId: string; name: string; status: "done" | "skipped"; note?: string; filesToUnsorted?: number };
type SyncResult = { memberId: string; name: string; added: string[]; renamed: string[]; removed: string[]; restored: string[]; filesToUnsorted: number };
const FOLDER_KINDS: Record<string, Kind> = {
  add: "إضافة", rename: "تعديل", move: "تعديل", delete: "حذف", hide_schools: "حذف", restore: "استعادة", show_schools: "استعادة", order: "ترتيب",
};
const opOf = (action: ApiAction) => (action.body?.op ?? {}) as FolderOp;
const toUnsorted = (files: number | undefined) => (files ? `${count(files, NOUNS.file)} ${files === 1 ? "ينتقل" : "تنتقل"} إلى «غير مصنّفة»` : undefined);

function describeFolderOp(ctx: DescribeContext, action: ApiAction): Described {
  const op = opOf(action);
  const scope = action.body?.scope === "school" ? "school" : "member";
  const results = (ctx.dryRun as { results?: BulkResult[] } | null)?.results ?? [];
  if (!results.length) throw new ActionError("folders_bulk: the dry run found no member to change.");
  const labelIn = (layout: FolderLayout, key: string | null | undefined) =>
    !key ? "المستوى الأول" : [...layout[scope], ...(layout.removed ?? []).filter(item => item.scope === scope)].find(item => item.key === key)?.label ?? key;
  const rows = results.map((result): ProposalChange => {
    const member = ctx.member(result.memberId);
    const layout = ctx.layout(member?.clusterId ?? "");
    const name = quoted(labelIn(layout, op.key));
    const [fieldLabel, before, after] =
      op.type === "add" ? [`إضافة مجلد ${quoted(op.label)}${op.parentKey ? ` داخل ${quoted(labelIn(layout, op.parentKey))}` : ""}`, "", String(op.label ?? "")]
      : op.type === "rename" ? [`إعادة تسمية مجلد ${name}`, labelIn(layout, op.key), String(op.label ?? "")]
      : op.type === "delete" ? [`حذف مجلد ${name} ومجلداته الفرعية`, labelIn(layout, op.key), "(يُحذف)"]
      : op.type === "restore" ? [`استعادة مجلد ${name}`, "(محذوف)", labelIn(layout, op.key)]
      : op.type === "move" ? [`نقل مجلد ${name}`, labelIn(layout, layout[scope].find(item => item.key === op.key)?.parent), labelIn(layout, op.parentKey)]
      : op.type === "order" ? ["ترتيب المجلدات", "", (op.keys ?? []).map(key => labelIn(layout, key)).join("، ")]
      : op.type === "hide_schools" ? ["إخفاء «مدارس المشرفة» ومجلدات مدارسها", "ظاهرة", "مخفية"]
      : ["إظهار «مدارس المشرفة» ومجلدات مدارسها", "مخفية", "ظاهرة"];
    const source = result.status === "skipped" ? `لن يُطبَّق عندها: ${result.note ?? ""}` : toUnsorted(result.filesToUnsorted);
    return { memberId: result.memberId, memberName: result.name, fieldId: ctx.entry.id, fieldLabel: `${scope === "school" ? "مجلدات كل مدرسة — " : ""}${fieldLabel}`, before, after, ...(source ? { source } : {}) };
  });
  const done = results.filter(result => result.status === "done");
  const who = done.length === 1 ? shortName(done[0].name) : countGen(done.length, NOUNS.member);
  return { title: `${rows[0].fieldLabel.replace(/^مجلدات كل مدرسة — /, "")} — ${who}`, kind: FOLDER_KINDS[op.type ?? ""] ?? "تعديل", rows };
}

function describeSync(ctx: DescribeContext, action: ApiAction): Described {
  const source = memberOf(ctx, String(action.body?.fromMemberId ?? ""));
  const results = (ctx.dryRun as { results?: SyncResult[] } | null)?.results ?? [];
  if (!results.length) throw new ActionError("folders_sync: the dry run found no member to change.");
  const rows = results.map((result): ProposalChange => {
    const parts = [["يُضاف", result.added], ["تُعاد تسمية", result.renamed], ["يُحذف", result.removed], ["يُستعاد", result.restored]] as const;
    const after = parts.filter(([, labels]) => labels.length).map(([verb, labels]) => `${verb}: ${labels.join("، ")}`).join(" · ") || "مطابقة أصلاً";
    const files = toUnsorted(result.filesToUnsorted);
    return { memberId: result.memberId, memberName: result.name, fieldId: ctx.entry.id, fieldLabel: `توحيد المجلدات مع مجلدات ${shortName(source.name)}`, before: "", after, ...(files ? { source: files } : {}) };
  });
  return { title: `توحيد مجلدات ${countGen(results.length, NOUNS.member)} مع مجلدات ${shortName(source.name)}`, kind: "تعديل", rows };
}

// ---------- documents ----------
function documentOf(ctx: DescribeContext, id: string | undefined) {
  const document = id ? ctx.document(id) : null;
  if (!document) throw new ActionError(`Document "${id}" was not found in her district (use list_documents).`);
  return document;
}
const ownerOf = (ctx: DescribeContext, document: DocumentRow) =>
  (document.ownerId ? ctx.member(document.ownerId) : null) ?? { id: "", name: "ملفات المحادثة", clusterId: "" };
const placedIn = (ctx: DescribeContext, clusterId: string, body: Record<string, unknown>) => {
  const schoolId = typeof body.schoolId === "string" && body.schoolId ? body.schoolId : null;
  return folderPath({ folder: typeof body.folder === "string" ? body.folder : null, schoolId, schoolName: schoolId ? ctx.schoolName(schoolId) : null }, ctx.layout(clusterId));
};

// ---------- the register (مؤشرات الأداء) ----------
const kpiRow = (ctx: DescribeContext, id: string | undefined, state: "live" | "deleted" = "live") => entity(ctx, "school_kpis", id, null, state);
const memberName = (ctx: DescribeContext, id: unknown) => (typeof id === "string" && id ? ctx.member(id)?.name ?? "مشرفة غير معروفة" : "بلا مشرفة");

// ---------- the catalog ----------
const read = (id: string, path: string, label: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, method: "GET", path, label, risk: "read", ...extra });

const ENTRIES: CatalogEntry[] = [
  // reading
  read("team", "/district/team", "كل مشرفة بأرقامها، والدعوات المعلّقة"),
  read("overview", "/district/overview", "أرقام النطاق اليوم، وتوزيع تصنيف المدارس، وتحديثات الأسبوع"),
  read("members", "/district/members", "قائمة المشرفات مع اكتمال ملفاتهن", { query: { filter: "all|complete|incomplete|submitted|lowDiscipline", q: "" } }),
  read("member", "/district/members/:id", "ملف مشرفة كاملاً بمعرّفات كل صف (id = معرّف المشرفة)"),
  read("member_timeline", "/district/members/:id/timeline", "آخر ما تغيّر في ملفها: من وماذا ومتى"),
  read("member_visits", "/district/members/:id/visits", "تقارير زياراتها بنصها"),
  read("submissions", "/district/submissions", "من حدّثت ملفها في يوم", { query: { date: "YYYY-MM-DD" } }),
  read("report", "/district/report", "التقرير الموحّد ليوم", { query: { date: "YYYY-MM-DD" } }),
  read("documents", "/district/documents", "كل ملفات النطاق مع بداية نصها", { documentText: true }),
  read("member_documents", "/district/members/:id/attachments", "ملفات مشرفة مع بداية نصها", { documentText: true }),
  read("folders", "/district/folders", "مجلدات ملف الإنجاز لكل مشرفة (المفاتيح key والأسماء وعدد الملفات)"),
  read("member_folders", "/district/members/:memberId/folders", "مجلدات مشرفة وعدد ملفات كل مجلد"),
  read("kpis", "/district/kpis", "سجل مؤشرات الأداء بفلاتره (query_kpis أخصر)", {
    query: { year: "", memberId: "", unassigned: "1", level: list(TIERS), q: "", stage: "", evaluationType: "", severe: "1" },
  }),
  read("member_kpis", "/district/members/:id/kpis", "صفوف السجل الخاصة بمشرفة ونطاق ما تراه"),
  read("kpi_imports", "/district/kpis/imports", "آخر عمليات استيراد المؤشرات"),

  // the team
  {
    id: "member_create", method: "POST", path: "/district/members", label: "إضافة عضوة (تدخل ببريدها وتختار كلمة المرور أول مرة)", risk: "write",
    body: "name*, email*, title, phone, clusterLabel",
    describe: (ctx, action) => {
      const body = action.body ?? {};
      const name = String(body.name ?? "");
      return {
        title: `إضافة ${name} للفريق`, kind: "إضافة", label: name,
        rows: [{ memberId: "", memberName: name, fieldId: ctx.entry.id, fieldLabel: "عضوة جديدة", before: "", after: [body.email, body.title].filter(Boolean).join(" · ") }],
      };
    },
  },
  {
    id: "member_contact", method: "PATCH", path: "/district/members/:id/contact", label: "تعديل اسمها أو بريد دخولها أو جوالها أو صفتها أو عنقودها",
    risk: action => ("email" in (action.body ?? {}) || "clusterLabel" in (action.body ?? {}) ? "destructive" : "write"), body: "name, email (بريد الدخول), phone, title, clusterLabel",
    describe: (ctx, action) => {
      const member = pathMember(ctx, action);
      const rows = nonEmpty(fieldRows(baseOf(ctx, member), "بيانات الحساب", member, action.body ?? {}), ctx.entry.id);
      return { title: `تعديل بيانات حساب ${shortName(member.name)}`, kind: "تعديل", rows };
    },
  },
  {
    id: "member_reset_password", method: "POST", path: "/district/members/:id/reset-password", label: "إعادة تعيين كلمة مرورها", risk: "destructive",
    describe: (ctx, action) => {
      const member = pathMember(ctx, action);
      return {
        title: `إعادة تعيين كلمة مرور ${shortName(member.name)}`, kind: "تعديل",
        rows: [{ ...baseOf(ctx, member), fieldLabel: "إعادة تعيين كلمة المرور", before: "", after: "تختار كلمة مرور جديدة عند دخولها القادم", source: "لا يمكن التراجع — تنتهي جلساتها الحالية فوراً" }],
      };
    },
  },
  {
    id: "member_delete", method: "DELETE", path: "/district/members/:id", label: "حذف حساب مشرفة من الفريق", risk: "destructive",
    describe: (ctx, action) => {
      const member = pathMember(ctx, action);
      return {
        title: `حذف ${shortName(member.name)} من الفريق`, kind: "حذف",
        rows: [{ ...baseOf(ctx, member), fieldLabel: "حذف حساب المشرفة", before: `${member.name} · ${member.email}`, after: "(تُحذف من الفريق)", source: "لا يمكن التراجع — يتوقف دخولها فوراً" }],
      };
    },
  },
  {
    id: "report_generate", method: "POST", path: "/district/report/generate", label: "حفظ التقرير الموحّد", risk: "write", body: "date(YYYY-MM-DD), format(text|excel)",
    describe: (ctx, action) => ({
      title: "حفظ التقرير الموحّد", kind: "إضافة",
      rows: [{ ...baseOf(ctx, DISTRICT), fieldLabel: "حفظ التقرير الموحّد", before: "", after: [action.body?.date ?? "اليوم", shown("format", action.body?.format ?? "text")].join(" · ") }],
    }),
  },

  // her file
  ...RESOURCES.flatMap(resourceEntries),
  indicatorEntry("evaluation_indicators", "evaluation_indicators", "evaluation", "التقويم المدرسي",
    `schoolId*, supportType, qudrat, tahsili, nafesGrade3, nafesGrade6, nafesGrade9, nafesValue (0–100 أو null), nafesDirection(""|up|down), nafesDelta, externalReportUrl, externalReportStatus(uploaded|missing), selfReportUrl, domains({${EVALUATION_DOMAINS.map(domain => domain.key).join("|")}: {level(${list(TIERS)}|""), percent}}), nafesCardFolderUrl (بلا schoolId)`),
  indicatorEntry("madrasati_indicators", "madrasati_indicators", "madrasati", "مؤشرات مدرستي",
    `schoolId*, metrics* (٦ نسب بالترتيب: ${MADRASATI_METRICS.map(metric => metric.label).join("، ")})`),
  indicatorEntry("discipline_indicators", "discipline_indicators", "discipline", "مؤشرات الانضباط", "schoolId*, daily, weekly, monthly, planStatus(approved=معتمدة|missing=غير مرفوعة), planUrl"),

  // files
  {
    id: "document_assign", method: "POST", path: "/district/documents/:id/assign", label: "حفظ ملف (مثل مرفق المحادثة) في ملف مشرفة، في مجلد إن أردتِ", risk: "write",
    body: "memberId*, folder (مفتاح المجلد), schoolId (لمجلدات المدرسة)",
    describe: (ctx, action) => {
      const document = documentOf(ctx, action.params?.id);
      const body = action.body ?? {};
      const member = memberOf(ctx, typeof body.memberId === "string" ? body.memberId : undefined);
      const where = body.folder ? ` — في ${placedIn(ctx, member.clusterId, body)}` : "";
      return {
        title: `حفظ ${quoted(document.name)} في ملف ${shortName(member.name)}`, kind: "إضافة",
        rows: [{ ...baseOf(ctx, member), fieldLabel: "إضافة ملف إلى ملفها", before: document.ownerName ?? "", after: `${document.name}${where}` }],
      };
    },
  },
  {
    id: "document_move", method: "PATCH", path: "/attachments/:id", label: "نقل ملف إلى مجلد آخر في ملف صاحبته", risk: "write", body: "folder* (مفتاح المجلد), schoolId (لمجلدات المدرسة)",
    describe: (ctx, action) => {
      const document = documentOf(ctx, action.params?.id);
      if (!document.clusterId) throw new ActionError(`"${document.name}" is not in a member's file yet: use document_assign.`);
      const owner = ownerOf(ctx, document);
      const before = folderPath(document, ctx.layout(document.clusterId));
      const after = placedIn(ctx, document.clusterId, action.body ?? {});
      return { title: `نقل ${quoted(document.name)}`, kind: "تعديل", rows: [{ ...baseOf(ctx, owner), fieldLabel: `نقل ${quoted(document.name)}`, before, after }] };
    },
  },
  {
    id: "document_delete", method: "DELETE", path: "/attachments/:id", label: "حذف ملف", risk: "destructive",
    describe: (ctx, action) => {
      const document = documentOf(ctx, action.params?.id);
      return {
        title: `حذف ${quoted(document.name)}`, kind: "حذف",
        rows: [{ ...baseOf(ctx, ownerOf(ctx, document)), fieldLabel: "حذف ملف", before: document.name, after: "(يُحذف)", source: "لا يمكن استعادته من المنصة" }],
      };
    },
  },

  // folders (ملف الإنجاز)
  {
    id: "folders_bulk", method: "POST", path: "/district/folders/bulk", label: "تعديل مجلدات مشرفة أو عدة مشرفات بخطوة واحدة (بالمفتاح key)", dryRun: true,
    risk: action => (["delete", "hide_schools"].includes(String(opOf(action).type)) ? "destructive" : "write"),
    body: "memberIds* (معرّفات أو \"all\"), scope*(member=مجلداتها|school=مجلدات كل مدرسة), op*: {type:add,label,parentKey?,afterKey?} | {type:rename,key,label} | {type:delete,key} | {type:restore,key} | {type:move,key,parentKey|null} | {type:order,parentKey|null,keys} | {type:hide_schools} | {type:show_schools}",
    describe: describeFolderOp,
  },
  {
    id: "folders_sync", method: "POST", path: "/district/folders/sync", label: "توحيد مجلدات مشرفات مع مجلدات مشرفة أخرى («مثل مجلدات فلانة»)", risk: "destructive", dryRun: true,
    body: "fromMemberId*, toMemberIds* (معرّفات أو \"all\"), scopes ([member, school] افتراضياً)",
    describe: describeSync,
  },

  // the register (مؤشرات الأداء)
  {
    id: "kpi_create", method: "POST", path: "/district/kpis", label: "إضافة مدرسة إلى سجل مؤشرات الأداء", risk: "write",
    body: `year, ministryNo, schoolName*, stage, authority, region, sector, evaluationType(${list(KPI_EVALUATION_TYPES)}), overallScore, outcomesScore (0–100 أو null), followUpLevel(${list(KPI_FOLLOW_UP_LEVELS)}), standards({${KPI_STANDARDS.map(standard => standard.key).join("|")}: 0–100|null}), note, assignedMemberId`,
    describe: (ctx, action) => {
      const body = action.body ?? {};
      const label = String(body.schoolName ?? "");
      const details = Object.entries(body).filter(([key]) => key !== "schoolName" && !NOT_SENT.has(key))
        .map(([key, value]) => `${fieldName(key)}: ${key === "assignedMemberId" ? memberName(ctx, value) : shown(key, value)}`);
      return { title: `إضافة ${quoted(label)} إلى السجل`, kind: "إضافة", label, rows: [{ ...baseOf(ctx, REGISTER), fieldLabel: "إضافة مدرسة إلى السجل", before: "", after: [label, ...details].join(" · ") }] };
    },
  },
  {
    id: "kpi_update", method: "PATCH", path: "/district/kpis/:id", label: "تعديل صف في السجل", risk: "write", body: "أي حقل من حقول kpi_create",
    refs: action => [["school_kpis", action.params?.id ?? ""]],
    describe: (ctx, action) => {
      const row = kpiRow(ctx, action.params?.id);
      const show = (key: string, value: unknown) => (key === "assignedMemberId" ? memberName(ctx, value) : shown(key, value));
      const rows = nonEmpty(fieldRows(baseOf(ctx, REGISTER), quoted(row.schoolName), row, action.body ?? {}, show), ctx.entry.id);
      return { title: `تعديل ${quoted(row.schoolName)} في السجل`, kind: "تعديل", rows, expectedUpdatedAt: iso(row.updatedAt) };
    },
  },
  {
    id: "kpi_delete", method: "DELETE", path: "/district/kpis/:id", label: "حذف صف من السجل", risk: "write", refs: action => [["school_kpis", action.params?.id ?? ""]],
    describe: (ctx, action) => {
      const row = kpiRow(ctx, action.params?.id);
      return { title: `حذف ${quoted(row.schoolName)} من السجل`, kind: "حذف", rows: [{ ...baseOf(ctx, REGISTER), fieldLabel: "حذف من السجل", before: String(row.schoolName), after: "(يُحذف)" }] };
    },
  },
  {
    id: "kpi_restore", method: "POST", path: "/district/kpis/:id/restore", label: "استعادة صف محذوف من السجل", risk: "write", refs: action => [["school_kpis", action.params?.id ?? ""]],
    describe: (ctx, action) => {
      const row = kpiRow(ctx, action.params?.id, "deleted");
      return { title: `استعادة ${quoted(row.schoolName)} إلى السجل`, kind: "استعادة", rows: [{ ...baseOf(ctx, REGISTER), fieldLabel: "استعادة إلى السجل", before: "(محذوف)", after: String(row.schoolName) }] };
    },
  },
  {
    id: "kpi_assign", method: "POST", path: "/district/kpis/assign", label: "إسناد مدارس من السجل إلى مشرفة (أو إلغاء الإسناد بـ null)", risk: "write", body: "ids* (معرّفات صفوف السجل), memberId (أو null)",
    refs: action => (Array.isArray(action.body?.ids) ? action.body.ids : []).map((id): Ref => ["school_kpis", String(id)]),
    describe: (ctx, action) => {
      const ids = Array.isArray(action.body?.ids) ? action.body.ids.map(String) : [];
      const target = action.body?.memberId ?? null;
      const name = target === null ? memberName(ctx, null) : memberOf(ctx, String(target)).name;
      const rows = ids.map(id => kpiRow(ctx, id)).filter(row => row.assignedMemberId !== target).map(row => ({
        ...baseOf(ctx, REGISTER), fieldLabel: `المشرفة المتابعة لـ${quoted(row.schoolName)}`, before: memberName(ctx, row.assignedMemberId), after: name,
      }));
      return { title: `إسناد ${count(ids.length, NOUNS.school)} إلى ${name}`, kind: "تعديل", rows: nonEmpty(rows, ctx.entry.id) };
    },
  },
  {
    id: "kpi_scope", method: "PUT", path: "/district/members/:id/kpi-scope", label: "ما تراه المشرفة من السجل: مدارسها أو كل مدارس النطاق", risk: "write", body: "scope*(own=مدارسها فقط|district=كل مدارس النطاق)",
    refs: action => [["clusters", action.params?.id ?? ""]],
    describe: (ctx, action) => {
      const member = pathMember(ctx, action);
      const rows = nonEmpty(fieldRows(baseOf(ctx, member), "مؤشرات الأداء", { scope: ctx.row("clusters", member.id)?.kpiScope }, action.body ?? {}), ctx.entry.id);
      return { title: `ما تراه ${shortName(member.name)} من سجل المؤشرات`, kind: "تعديل", rows };
    },
  },
  // A sheet is imported only through import_kpis and its card (a dry run first), never as a generic action.
  { id: "kpi_import", method: "POST", path: "/district/kpis/import", label: "استيراد ملف مؤشرات", risk: "write", hidden: true },
  {
    id: "kpi_import_undo", method: "POST", path: "/district/kpis/imports/:id/undo", label: "التراجع عن استيراد مؤشرات (خلال ٢٤ ساعة، الأحدث أولاً)", risk: "write",
    refs: action => [["kpi_imports", action.params?.id ?? ""]],
    describe: (ctx, action) => {
      const row = entity(ctx, "kpi_imports", action.params?.id, null);
      return {
        title: `التراجع عن استيراد ${quoted(row.fileName)}`, kind: "استعادة",
        rows: [{ ...baseOf(ctx, REGISTER), fieldLabel: `التراجع عن استيراد ${quoted(row.fileName)}`, before: "", after: "يعود السجل كما كان قبل الاستيراد" }],
      };
    },
  },
];

const BY_ID = new Map(ENTRIES.map(entry => [entry.id, entry]));
const BY_ROUTE = new Map(ENTRIES.map(entry => [`${entry.method} ${entry.path}`, entry]));

export const CATALOG: readonly CatalogEntry[] = ENTRIES;
export const catalogById = (id: string) => BY_ID.get(id) ?? null;
/** The entry for a registered route (internal-api.ts lets nothing else run). */
export const catalogEntry = (method: string, path: string) => BY_ROUTE.get(`${method} ${path}`) ?? null;

/** The routes as the system prompt lists them: generated, stable order, no dates. */
export function apiReference() {
  const lines: string[] = [];
  const params = (entry: CatalogEntry) => paramNames(entry.path).join(", ");
  for (const entry of ENTRIES) {
    const resource = entry.resource;
    if (entry.hidden) continue;
    if (resource) {
      if (!entry.id.endsWith("_list")) continue;
      const verbs = ENTRIES.filter(item => item.resource === resource)
        .map(item => `${item.id.slice(resource.length + 1)}${paramNames(item.path).includes("id") ? "(id)" : ""}`).join(" · ");
      lines.push(`- ${resource}_* (${params(entry)}): ${entry.label} — ${verbs} — body: ${entry.body}; order: {ids: كل المعرّفات بالترتيب الجديد}`);
      continue;
    }
    const query = entry.query ? ` ?${Object.entries(entry.query).map(([key, values]) => (values ? `${key}=${values}` : key)).join("&")}` : "";
    const risk = entry.risk === "read" ? "" : typeof entry.risk === "function" || entry.risk === "destructive" ? " ⚠" : "";
    lines.push(`- ${entry.id}${paramNames(entry.path).length ? ` (${params(entry)})` : ""}${query}: ${entry.label}${entry.body ? ` — body: ${entry.body}` : ""}${risk}`);
  }
  return lines.join("\n");
}

/** A short Arabic line for the counts of a card: «حذف ١ · تعديل ٣ · إضافة ٢». */
export function kindCounts(kinds: Kind[]) {
  return KINDS.filter(kind => kinds.includes(kind)).map(kind => `${kind} ${ar(kinds.filter(item => item === kind).length)}`).join(" · ");
}
