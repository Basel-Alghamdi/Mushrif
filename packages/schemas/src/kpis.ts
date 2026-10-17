// مؤشرات الأداء: the school-evaluation indicators رئيسة النطاق enters for every school in the district (her Excel
// «مؤشرات التقويم المدرسي»). Each member sees the rows of her schools. Levels are never stored: they follow from the
// numbers with the same bands as the sheet's formulas.

/** The ten standards (المعايير) of the four evaluation domains, with the column header each has in the sheet. */
export const KPI_DOMAINS = [
  {
    key: "management", label: "الإدارة المدرسية",
    standards: [
      { key: "planning", label: "التخطيط" },
      { key: "leadership", label: "قيادة العملية التعليمية" },
      { key: "community", label: "المجتمع المدرسي" },
      { key: "institutional", label: "التطوير المؤسسي" },
    ],
  },
  {
    key: "teaching", label: "التعليم والتعلم",
    standards: [
      { key: "learningExperiences", label: "بناء خبرات التعلم" },
      { key: "learningAssessment", label: "تقويم التعلم" },
    ],
  },
  {
    key: "outcomes", label: "نواتج التعلم",
    standards: [
      { key: "achievement", label: "التحصيل التعليمي" },
      { key: "personalDevelopment", label: "التطور الشخصي والصحي والاجتماعي" },
    ],
  },
  {
    key: "environment", label: "البيئة المدرسية",
    standards: [
      { key: "building", label: "المبنى المدرسي" },
      { key: "safety", label: "الأمن والسلامة" },
    ],
  },
] as const;

export type KpiStandardKey = (typeof KPI_DOMAINS)[number]["standards"][number]["key"];
export const KPI_STANDARDS: readonly { key: KpiStandardKey; label: string; domain: string }[] =
  KPI_DOMAINS.flatMap(domain => domain.standards.map(standard => ({ key: standard.key, label: standard.label, domain: domain.label })));

/** نوع التقويم, مستوى المتابعة, المرحلة: the choices of her sheet (free text is still accepted). */
export const KPI_EVALUATION_TYPES = ["خارجي", "ذاتي", "غير مصنفة"];
export const KPI_FOLLOW_UP_LEVELS = ["متابعة شديدة", "متابعة عالية", "متابعة متوسطة"];
export const KPI_STAGES = ["الابتدائية", "المتوسطة", "الثانوية"];

/**
 * المستوى العام and نواتج التعلم: ≥90 تميز · ≥75 تقدم · ≥50 انطلاق · otherwise تهيئة. Spelled like TIERS (her sheet writes
 * «التقدم»): one scale with the school tier members choose, so both read the same.
 */
export const KPI_LEVELS = ["تميز", "تقدم", "انطلاق", "تهيئة"] as const;
export type KpiLevel = (typeof KPI_LEVELS)[number];
/** A standard's score as the support the school needs: ≥90 منخفض · ≥75 متوسط · ≥50 عالي · otherwise شديدة. */
export const KPI_SUPPORT = ["دعم منخفض", "دعم متوسط", "دعم عالي", "دعم ومساندة شديدة"] as const;
export type KpiSupport = (typeof KPI_SUPPORT)[number];

const band = (score: number) => (score >= 90 ? 0 : score >= 75 ? 1 : score >= 50 ? 2 : 3);

/** The level of a score, or null when there is no score (an empty cell is not «التهيئة»). */
export const kpiLevel = (score: number | null | undefined): KpiLevel | null =>
  score === null || score === undefined || Number.isNaN(score) ? null : KPI_LEVELS[band(score)];

export const kpiSupport = (score: number | null | undefined): KpiSupport | null =>
  score === null || score === undefined || Number.isNaN(score) ? null : KPI_SUPPORT[band(score)];

/** 0 = best … 3 = most support needed: the tone a level or support label is shown with. */
export const kpiTone = (score: number | null | undefined) => (score === null || score === undefined || Number.isNaN(score) ? null : band(score));

/** Strips «ال» so «التقدم» (her sheet) and «تقدم» (TIERS) compare equal. */
export const levelKey = (value: string) => value.trim().replace(/^ال/, "");

/**
 * A ministry number as compared everywhere (KPI rows, members' schools, imports): western digits; no spaces, commas,
 * dashes, dots or bidi marks; upper-case letters; a trailing ".0" from a spreadsheet number dropped; leading zeros of an
 * all-digit number dropped. «096175», « 96,175 » and 96175 all give "96175"; «m 399-5842» gives "M3995842".
 */
export function ministryKey(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value)
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\.0+$/, "")
    .replace(/[\s,٬،.\-_‎‏‪-‮⁦-⁩]/g, "")
    .toUpperCase();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text;
}

/** A value an import accepts as a ministry number: an optional letter, then 4–10 digits. */
export const looksLikeMinistryNo = (key: string) => /^[A-Z]?\d{4,10}$/.test(key);

/** نوع التقويم «غير مصنفة» (any spelling): the school has no classification, so no level is shown. */
export const isUnclassified = (evaluationType: string) => /غير\s*مصن/.test(evaluationType);

/** A member's view of the register: her own schools' rows, or every school in the district (the specialists). */
export type KpiScope = "own" | "district";

/** One school's row in the district register (GET /district/kpis, GET /cluster/me/kpis, the member bootstrap). */
export type SchoolKpi = {
  id: string;
  /** The year of the evaluation, e.g. "1447" ("" when the sheet did not say). */
  year: string;
  /** As written; compare with ministryKey(). */
  ministryNo: string;
  schoolName: string;
  stage: string;
  authority: string;
  region: string;
  sector: string;
  evaluationType: string;
  /** المستوى العام للمدرسة (0–100), or null when not available. */
  overallScore: number | null;
  /** درجة النواتج (0–100), or null. */
  outcomesScore: number | null;
  /** Derived from the scores (null without a score, or for «غير مصنفة»). */
  overallLevel: KpiLevel | null;
  outcomesLevel: KpiLevel | null;
  /** مستوى المتابعة في مؤشرات الالتزام في الانضباط التعليمي. */
  followUpLevel: string;
  /** The ten standards (KPI_STANDARDS keys): score 0–100 or null. */
  standards: Partial<Record<KpiStandardKey, number | null>>;
  /** Columns of her sheet the platform does not know, kept as they were. */
  extra: { label: string; value: string }[];
  note: string;
  /** The member the head (or the sheet's «عضو الفريق التنفيذي المتابع») assigned, and that name as written in the sheet. */
  assignedMemberId: string | null;
  memberName: string;
  /** Who sees the row as hers: members with a school of this ministry number, else the assigned member. */
  owners: { memberId: string; name: string; schoolId: string | null }[];
  /** For a member's own view: her school with this ministry number, when she has one. */
  schoolId: string | null;
  source: "import" | "manual";
  sheet: string;
  updatedAt: string;
};

/** POST /district/kpis/import: what an import found (dryRun) or did. */
export type KpiImportResult = {
  applied: boolean;
  /** Set when applied: «تراجع عن هذا الاستيراد» (POST /district/kpis/imports/:id/undo) within 24 hours. */
  importId: string | null;
  mode: "merge" | "replace";
  year: string;
  /** Every sheet that looked like a register, with its usable rows; `included` = imported this time. */
  sheets: { name: string; rows: number; included: boolean }[];
  rows: number;
  added: number;
  updated: number;
  unchanged: number;
  /** replace mode: imported rows of this year that the file no longer has (they are removed). */
  removed: number;
  removedNames: string[];
  /** Rows with data that could not be used (no school name, or the same ministry number twice in the file). */
  skipped: { sheet: string; row: number; reason: string }[];
  /** Each distinct name of «عضو الفريق التنفيذي المتابع»: how many schools, and the member it goes to (null = none). */
  names: { name: string; count: number; memberId: string | null; memberName: string | null; status: "matched" | "alias" | "chosen" | "ambiguous" | "unknown" }[];
  /** A few parsed rows per sheet, so she can see the columns were read right. */
  sample: { sheet: string; schoolName: string; ministryNo: string; overallScore: number | null; memberName: string }[];
};
