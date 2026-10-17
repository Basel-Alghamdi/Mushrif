import { KPI_DOMAINS, KPI_LEVELS, kpiTone, ministryKey, toWesternDigits, type KpiImportResult, type KpiLevel, type SchoolKpi } from "@rasd/schemas";
import { ar } from "../../../lib/format";

// مؤشرات الأداء on the screen: shared by the head's register page, her member profile and the member's own pages.

/** GET /district/kpis (without filters: the page filters the year's rows itself). */
export type KpiRegister = {
  year: string;
  years: string[];
  rows: SchoolKpi[];
  summary: {
    /** Rows nobody sees as hers. */
    unassigned: number;
    /** Rows with a standard below 50 («دعم ومساندة شديدة»). */
    severe: number;
    /** Members' schools that have no row this year (their ministry number is not in the register). */
    memberSchoolsMissing: { memberId: string; name: string; schoolId: string; schoolName: string; ministryNo: string }[];
    /** Every live member (also those with no row), by name. */
    perMember: KpiMember[];
  };
};
export type KpiMember = { memberId: string; name: string; rows: number; tahyia: number; intilaq: number; severeStandards: number };

/** GET /district/kpis/imports: the last imports, newest first. */
export type KpiImportEntry = {
  id: string; createdAt: string; fileName: string; year: string; mode: KpiImportResult["mode"];
  summary: Partial<Pick<KpiImportResult, "added" | "updated" | "removed">>; undoneAt: string | null; canUndo: boolean;
};

export const SCHOOLS = { one: "مدرسة واحدة", two: "مدرستان", few: "مدارس", many: "مدرسة" };
export const STANDARDS = { one: "معيار واحد", two: "معياران", few: "معايير", many: "معياراً" };

// Same colours as the school tier pills (تميز/تقدم green, انطلاق brand, تهيئة amber): one scale, read the same everywhere.
const TONE_PILLS = ["pill-ok", "pill-ok", "pill-brand", "pill-warn"];
export const levelPill = (level: KpiLevel) => TONE_PILLS[KPI_LEVELS.indexOf(level)];
export const supportPill = (score: number) => TONE_PILLS[kpiTone(score) ?? 0];

export const scoreText = (score: number | null | undefined) => (score === null || score === undefined ? "—" : ar(score));

/** A standard below 50 needs «دعم ومساندة شديدة». */
export const severeCount = (row: SchoolKpi) => Object.values(row.standards).filter(score => typeof score === "number" && score < 50).length;

/**
 * How much support a school needs, lowest first: its weakest standard in one domain, or its overall score.
 * Rows without a number sort last.
 */
export function needOf(row: SchoolKpi, domainKey?: string) {
  const domain = KPI_DOMAINS.find(item => item.key === domainKey);
  const scores = domain
    ? domain.standards.map(standard => row.standards[standard.key]).filter((score): score is number => typeof score === "number")
    : row.overallScore === null ? [] : [row.overallScore];
  return scores.length ? Math.min(...scores) : Infinity;
}

/**
 * A typed score: Arabic or Western digits, «٫» or «,» as the decimal point, 0–100, kept to 2 decimals.
 * Empty = no score (null), which is not 0.
 */
export function parseScore(text: string): { value: number | null; error?: string } {
  const western = toWesternDigits(text).replace(/[٫,]/g, ".").replace(/\s/g, "");
  if (!western) return { value: null };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(western)) return { value: null, error: "اكتبي رقماً، مثل ٨٤٫٧٥" };
  const value = Number(western);
  if (value > 100) return { value: null, error: `بين ${ar(0)} و${ar(100)}` };
  return { value: Math.round(value * 100) / 100 };
}

/** The register row of one of her schools: the one the server linked to it, else the same ministry number. */
export function kpiOfSchool(rows: SchoolKpi[], school: { id: string; ministryNo: string }) {
  const key = ministryKey(school.ministryNo);
  return rows.find(row => row.schoolId === school.id || row.owners.some(owner => owner.schoolId === school.id))
    ?? (key ? rows.find(row => ministryKey(row.ministryNo) === key) : undefined);
}

/**
 * «المستوى العام: تقدم ٨٢، النواتج: انطلاق ٦٨، متابعة عالية» — the parts that have a value. An Arabic comma, because
 * a middle dot «·» right after Arabic-Indic digits reads as another «٠».
 */
export function kpiHeadline(row: SchoolKpi) {
  const part = (label: string, level: string | null, score: number | null) =>
    score === null ? "" : `${label}: ${[level, scoreText(score)].filter(Boolean).join(" ")}`;
  const followUp = row.followUpLevel.trim();
  return [
    part("المستوى العام", row.overallLevel, row.overallScore),
    part("النواتج", row.outcomesLevel, row.outcomesScore),
    followUp && (followUp.startsWith("متابعة") ? followUp : `المتابعة: ${followUp}`),
  ].filter(Boolean).join("، ");
}

// Letters typed several ways (أ/إ/ا, ة/ه, ى/ي) compare equal, so «مدرسه» finds «مدرسة».
const searchKey = (text: string) => text.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();

/** Search by school name, ministry number (any digits, spaces or leading zeros) or مشرفة — as the server's ?q= does. */
export function matchesQuery(row: SchoolKpi, query: string) {
  const needle = searchKey(query);
  if (!needle) return true;
  const key = ministryKey(query);
  return (/\d/.test(key) && ministryKey(row.ministryNo).includes(key))
    || [row.schoolName, row.memberName, ...row.owners.map(owner => owner.name)].some(text => searchKey(text).includes(needle));
}
