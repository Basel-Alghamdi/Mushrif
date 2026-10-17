// مؤشرات الأداء: reading the district register (school_kpis) for the head and for each member. Levels are derived from
// the scores here (never stored), and a row's owners from the members' schools by ministry number, else from the member
// it is assigned to — computed in SQL with the rows, never with a query per row.
import type postgres from "postgres";
import {
  KPI_LEVELS, isUnclassified, kpiLevel, ministryKey, toWesternDigits,
  type KpiLevel, type KpiScope, type SchoolKpi,
} from "@rasd/schemas";
import { normalizeArabic } from "./agent/normalize.js";
import type { Row, Sql } from "./db.js";

/**
 * Arabic text as the register compares it (sheet headers, names, search): unified letters (أإآ→ا ة→ه ى/ئ→ي), no «ال» at
 * the start of a word, «عبد الله» joined, punctuation dropped. «فايزة البخاري» and «فائزه بخاري» give the same words.
 */
export function arabicWords(text: unknown): string[] {
  return normalizeArabic(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/(^|\s)عبد\s+ال/g, "$1عبدال")
    .split(/\s+/).filter(Boolean).map(word => (word.length > 3 && word.startsWith("ال") ? word.slice(2) : word));
}
export const arabicKey = (text: unknown) => arabicWords(text).join(" ");

/** A score as typed or read from a sheet: 84.75, "84.75", "٨٤٫٧٥" or "84,75" → 84.75 (2 decimals); undefined when blank or not a number. */
export function readScore(value: unknown): number | undefined {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? toWesternDigits(value).replace(/[٫,]/g, ".").replace(/[\s%]/g, "") : "";
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return Math.round(Number(text) * 100) / 100;
}
export const inScoreRange = (score: number) => score >= 0 && score <= 100;

/** Standards under 50: «دعم ومساندة شديدة». */
export const severeStandards = (row: Pick<SchoolKpi, "standards">) =>
  Object.values(row.standards).filter(score => typeof score === "number" && score < 50).length;

// Who sees a row as hers: members whose live school has its ministry number; when no member's school does, the member
// it is assigned to. A removed member is never an owner (her rows count as unassigned).
const withOwners = (db: Sql) => db`
  left join profiles assigned on assigned.id = k.assigned_member_id and assigned.deleted_at is null
  left join lateral (
    select jsonb_agg(jsonb_build_object('memberId', p.id, 'name', p.name, 'schoolId', s.id) order by p.name, s.created_at) as list
    from schools s join clusters c on c.id = s.cluster_id join profiles p on p.id = c.member_id
    where k.ministry_key <> '' and s.ministry_no <> '' and s.deleted_at is null and app.ministry_key(s.ministry_no) = k.ministry_key
      and c.district_id = k.district_id and p.deleted_at is null
  ) by_school on true`;
const ownersColumn = (db: Sql) => db`
  coalesce(by_school.list, case when assigned.id is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('memberId', assigned.id, 'name', assigned.name, 'schoolId', null)) end) as owners`;
/** The row is hers (`member` is an SQL expression for her profile id). */
const ownedBy = (db: Sql, member: postgres.Fragment) => db`
  (case when by_school.list is null then k.assigned_member_id = ${member}
    else by_school.list @> jsonb_build_array(jsonb_build_object('memberId', ${member})) end)`;

/** The latest year with live rows in the district ('' when none): the default year of every view. */
const latestYear = (db: Sql, district: postgres.Fragment | string) =>
  db`(select coalesce(max(y.year), '') from school_kpis y where y.district_id = ${district} and y.deleted_at is null and y.year <> '')`;

/** Live register rows with their owners (`where` filters school_kpis k). */
export const selectKpis = (db: Sql, where: postgres.Fragment) => db`
  select k.*, ${ownersColumn(db)} from school_kpis k ${withOwners(db)}
  where k.deleted_at is null and ${where}
  order by k.sort_order, k.created_at`;

/** Every year with live rows, latest first ('' last). */
export const kpiYears = async (db: Sql, districtId: string) =>
  (await db`select year from school_kpis where district_id = ${districtId} and deleted_at is null group by year order by year desc`).map(row => String(row.year));

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));

/** A row as the API returns it; `viewerId` = the member whose school id goes in `schoolId`. */
export function toSchoolKpi(row: Row, viewerId: string | null = null): SchoolKpi {
  const owners = (row.owners ?? []) as SchoolKpi["owners"];
  // «غير مصنفة»: the school has no classification, so its numbers carry no level.
  const level = (score: number | null) => (isUnclassified(String(row.evaluationType)) ? null : kpiLevel(score));
  return {
    id: String(row.id), year: String(row.year), ministryNo: String(row.ministryNo), schoolName: String(row.schoolName),
    stage: String(row.stage), authority: String(row.authority), region: String(row.region), sector: String(row.sector),
    evaluationType: String(row.evaluationType),
    overallScore: row.overallScore ?? null, outcomesScore: row.outcomesScore ?? null,
    overallLevel: level(row.overallScore ?? null), outcomesLevel: level(row.outcomesScore ?? null),
    followUpLevel: String(row.followUpLevel), standards: (row.standards ?? {}) as SchoolKpi["standards"], extra: (row.extra ?? []) as SchoolKpi["extra"],
    note: String(row.note), assignedMemberId: row.assignedMemberId ? String(row.assignedMemberId) : null, memberName: String(row.memberName),
    owners, schoolId: viewerId ? owners.find(owner => owner.memberId === viewerId)?.schoolId ?? null : null,
    source: row.source === "manual" ? "manual" : "import", sheet: String(row.sheet), updatedAt: iso(row.updatedAt),
  };
}

/**
 * A member's rows of a year (default: the latest): the ones that are hers, or — with `byScope` and her scope 'district' —
 * every row of the district. Two queries, sent together.
 */
export async function kpisForMember(db: Sql, clusterId: string, options: { year?: string | null; byScope?: boolean } = {})
  : Promise<{ kpiScope: KpiScope; year: string; rows: SchoolKpi[] }> {
  const [[cluster], rows] = await Promise.all([
    db`select c.kpi_scope, c.member_id, ${latestYear(db, db`c.district_id`)} as latest from clusters c where c.id = ${clusterId}`,
    db`
      with me as (select id, member_id, district_id, kpi_scope from clusters where id = ${clusterId})
      select k.*, ${ownersColumn(db)} from me join school_kpis k on k.district_id = me.district_id ${withOwners(db)}
      where k.deleted_at is null and k.year = ${options.year ?? latestYear(db, db`me.district_id`)}
        and (${options.byScope ? db`me.kpi_scope = 'district'` : db`false`} or (
          (k.assigned_member_id = me.member_id or k.ministry_key in (
            select app.ministry_key(s.ministry_no) from schools s where s.cluster_id = me.id and s.deleted_at is null and s.ministry_no <> ''))
          and ${ownedBy(db, db`me.member_id`)}))
      order by k.sort_order, k.created_at`,
  ]);
  const memberId = cluster ? String(cluster.memberId) : null;
  return {
    kpiScope: cluster?.kpiScope === "district" ? "district" : "own",
    year: options.year ?? String(cluster?.latest ?? ""),
    rows: rows.map(row => toSchoolKpi(row, memberId)),
  };
}

/** A row a member may open (hers, or any row of the district when she sees them all), or none. */
export async function memberKpi(db: Sql, member: { id: string; clusterId: string; districtId: string }, id: string) {
  const [row] = await selectKpis(db, db`k.id = ${id} and k.district_id = ${member.districtId} and (
    (select kpi_scope from clusters where id = ${member.clusterId}) = 'district' or ${ownedBy(db, db`${member.id}::uuid`)})`);
  return row ? toSchoolKpi(row, member.id) : null;
}

export type KpiFilters = {
  memberId?: string; unassigned?: boolean; level?: KpiLevel | "none"; q?: string; stage?: string; evaluationType?: string; severe?: boolean;
};

/** A level as she may write it: with or without «ال», any spelling of ة/ه («التهيئة», «تهيئه»). */
export const findLevel = (value: string): KpiLevel | "none" | undefined =>
  value === "none" ? "none" : KPI_LEVELS.find(level => arabicKey(level) === arabicKey(value));

export function filterKpis(rows: SchoolKpi[], filters: KpiFilters) {
  const q = filters.q ? arabicKey(filters.q) : "";
  const qKey = filters.q && /\d/.test(filters.q) ? ministryKey(filters.q) : "";
  const stage = filters.stage ? arabicKey(filters.stage) : "";
  const evaluationType = filters.evaluationType ? arabicKey(filters.evaluationType) : "";
  return rows.filter(row =>
    (!filters.memberId || row.owners.some(owner => owner.memberId === filters.memberId))
    && (!filters.unassigned || !row.owners.length)
    && (!filters.level || (row.overallLevel ?? "none") === filters.level)
    && (!filters.severe || severeStandards(row) > 0)
    && (!stage || arabicKey(row.stage) === stage)
    && (!evaluationType || arabicKey(row.evaluationType) === evaluationType)
    && (!filters.q || (qKey !== "" && ministryKey(row.ministryNo).includes(qKey))
      || [row.schoolName, row.memberName, ...row.owners.map(owner => owner.name)].some(text => arabicKey(text).includes(q))));
}

const LEVEL_COUNTS = [...KPI_LEVELS, "none"] as const;

const yearSql = (db: Sql, districtId: string, year: string | null) => (year === null ? latestYear(db, districtId) : db`${year}`);

/** The district's rows of a year (null: the latest), and every year there is. */
export async function kpiYear(db: Sql, districtId: string, year: string | null) {
  const [years, rows] = await Promise.all([
    kpiYears(db, districtId),
    selectKpis(db, db`k.district_id = ${districtId} and k.year = ${yearSql(db, districtId, year)}`),
  ]);
  return { year: year ?? years.find(Boolean) ?? "", years, rows };
}

/**
 * GET /district/kpis: the rows of a year (default: the latest) that match the filters, and the year's summary — counts per
 * level, unassigned and severe rows, members' schools missing from the register, and each member's share — which always
 * covers the whole year, so the tiles do not change while she filters. Four queries, sent together.
 */
export async function districtKpis(db: Sql, districtId: string, options: { year?: string | null; filters?: KpiFilters } = {}) {
  const year = options.year ?? null;
  const [{ year: shown, years, rows }, members, missing] = await Promise.all([
    kpiYear(db, districtId, year),
    db`select p.id, p.name from profiles p join clusters c on c.member_id = p.id
      where p.district_id = ${districtId} and p.role = 'member' and p.deleted_at is null order by p.name`,
    // A school with no row this year: usually a missing or mistyped ministry number.
    db`select p.id as member_id, p.name, s.id as school_id, s.name as school_name, s.ministry_no
      from schools s join clusters c on c.id = s.cluster_id join profiles p on p.id = c.member_id
      where c.district_id = ${districtId} and p.role = 'member' and p.deleted_at is null and s.deleted_at is null
        and not exists (
          select 1 from school_kpis k where k.district_id = ${districtId} and k.deleted_at is null and k.year = ${yearSql(db, districtId, year)}
            and k.ministry_key <> '' and s.ministry_no <> '' and k.ministry_key = app.ministry_key(s.ministry_no))
      order by p.name, s.sort_order, s.created_at`,
  ]);
  const all = rows.map(row => toSchoolKpi(row, options.filters?.memberId ?? null));
  const byLevel = Object.fromEntries(LEVEL_COUNTS.map(level => [level, 0])) as Record<(typeof LEVEL_COUNTS)[number], number>;
  for (const row of all) byLevel[row.overallLevel ?? "none"] += 1;
  return {
    year: shown,
    years,
    rows: options.filters ? filterKpis(all, options.filters) : all,
    summary: {
      total: all.length,
      byLevel,
      unassigned: all.filter(row => !row.owners.length).length,
      severe: all.filter(row => severeStandards(row) > 0).length,
      memberSchoolsMissing: missing.map(row => ({
        memberId: String(row.memberId), name: String(row.name), schoolId: String(row.schoolId), schoolName: String(row.schoolName), ministryNo: String(row.ministryNo),
      })),
      perMember: members.map(member => {
        const hers = all.filter(row => row.owners.some(owner => owner.memberId === String(member.id)));
        return {
          memberId: String(member.id), name: String(member.name), rows: hers.length,
          tahyia: hers.filter(row => row.overallLevel === "تهيئة").length,
          intilaq: hers.filter(row => row.overallLevel === "انطلاق").length,
          severeStandards: hers.reduce((sum, row) => sum + severeStandards(row), 0),
        };
      }),
    },
  };
}
