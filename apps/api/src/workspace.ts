import { MADRASATI_METRICS, completionPct, riyadhDate, yearsSinceHijri } from "@rasd/schemas";
import type { Row, Sql } from "./db.js";

const groupBy = <T extends Row>(rows: T[], key: string) => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = String(row[key]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(row);
  }
  return groups;
};

const madrasatiValues = (row?: Row) => MADRASATI_METRICS.map(metric => Number(row?.[metric.key] ?? 0));

export type Workspace = Awaited<ReturnType<typeof loadWorkspaces>> extends Map<string, infer W> ? W : never;

/** Loads complete cluster files for the given clusters in a fixed number of queries. */
export async function loadWorkspaces(db: Sql, clusterIds: string[], today = riyadhDate()) {
  const result = new Map<string, ReturnType<typeof buildWorkspace>>();
  if (!clusterIds.length) return result;
  const ids = db.array(clusterIds);

  const [clusters, profileRows, schoolRows, overrideRows, planRows, programRows, sectionRows, supportRows, submissionRows, activityRows] = await Promise.all([
    db`select c.*, p.name as member_name, p.email as member_email, p.phone as member_phone from clusters c join profiles p on p.id = c.member_id where c.id = any(${ids}::uuid[])`,
    db`select * from profile_fields where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from schools where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from school_field_overrides where cluster_id = any(${ids}::uuid[]) and hidden`,
    db`select * from plans where cluster_id = any(${ids}::uuid[]) order by sort_order, kind`,
    db`select * from pd_programs where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from custom_sections where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from discipline_support_plans where cluster_id = any(${ids}::uuid[])`,
    db`select cluster_id, submitted_at from daily_submissions where cluster_id = any(${ids}::uuid[]) and date = ${today}::date`,
    db`select cluster_id, max(at) as last_activity_at from audit_log where cluster_id = any(${ids}::uuid[]) group by cluster_id`,
  ]);

  const schoolIds = db.array(schoolRows.map(row => row.id as string));
  const sectionIds = db.array(sectionRows.map(row => row.id as string));
  const [customRows, tileRows, roleRows, evaluationRows, madrasatiRows, disciplineRows, absenceRows, visitRows, sectionFieldRows] = await Promise.all([
    db`select * from school_custom_fields where school_id = any(${schoolIds}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from school_staff_tiles where school_id = any(${schoolIds}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from leadership_roles where school_id = any(${schoolIds}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from evaluation_indicators where school_id = any(${schoolIds}::uuid[])`,
    db`select * from madrasati_indicators where school_id = any(${schoolIds}::uuid[])`,
    db`select * from discipline_indicators where school_id = any(${schoolIds}::uuid[])`,
    db`select school_id, done from absence_confirmations where school_id = any(${schoolIds}::uuid[]) and date = ${today}::date`,
    db`select school_id, count(*)::int as count from visit_reports where school_id = any(${schoolIds}::uuid[]) group by school_id`,
    db`select * from custom_section_fields where section_id = any(${sectionIds}::uuid[]) and deleted_at is null order by sort_order, created_at`,
  ]);
  const roleIds = db.array(roleRows.map(row => row.id as string));
  const roleFieldRows = roleRows.length
    ? await db`select * from leadership_fields where role_id = any(${roleIds}::uuid[]) and deleted_at is null order by sort_order, created_at`
    : [];

  const lookup = {
    profile: groupBy(profileRows, "clusterId"),
    schools: groupBy(schoolRows, "clusterId"),
    overrides: groupBy(overrideRows, "clusterId"),
    plans: groupBy(planRows, "clusterId"),
    programs: groupBy(programRows, "clusterId"),
    sections: groupBy(sectionRows, "clusterId"),
    sectionFields: groupBy(sectionFieldRows, "sectionId"),
    support: new Map(supportRows.map(row => [String(row.clusterId), row])),
    submissions: new Map(submissionRows.map(row => [String(row.clusterId), row.submittedAt as Date])),
    activity: new Map(activityRows.map(row => [String(row.clusterId), row.lastActivityAt as Date])),
    custom: groupBy(customRows, "schoolId"),
    tiles: groupBy(tileRows, "schoolId"),
    roles: groupBy(roleRows, "schoolId"),
    roleFields: groupBy(roleFieldRows, "roleId"),
    evaluation: new Map(evaluationRows.map(row => [String(row.schoolId), row])),
    madrasati: new Map(madrasatiRows.map(row => [String(row.schoolId), row])),
    discipline: new Map(disciplineRows.map(row => [String(row.schoolId), row])),
    absence: new Map(absenceRows.map(row => [String(row.schoolId), Boolean(row.done)])),
    visits: new Map(visitRows.map(row => [String(row.schoolId), Number(row.count)])),
  };

  for (const cluster of clusters) result.set(String(cluster.id), buildWorkspace(cluster, lookup, today));
  return result;
}

type Lookup = {
  profile: Map<string, Row[]>; schools: Map<string, Row[]>; overrides: Map<string, Row[]>; plans: Map<string, Row[]>;
  programs: Map<string, Row[]>; sections: Map<string, Row[]>; sectionFields: Map<string, Row[]>; support: Map<string, Row>;
  submissions: Map<string, Date>; activity: Map<string, Date>; custom: Map<string, Row[]>; tiles: Map<string, Row[]>;
  roles: Map<string, Row[]>; roleFields: Map<string, Row[]>; evaluation: Map<string, Row>; madrasati: Map<string, Row>;
  discipline: Map<string, Row>; absence: Map<string, boolean>; visits: Map<string, number>;
};

function buildWorkspace(cluster: Row, lookup: Lookup, today: string) {
  const clusterId = String(cluster.id);
  const rawProfile = lookup.profile.get(clusterId) ?? [];
  const hireDate = rawProfile.find(field => field.fieldKey === "hireDate")?.value ?? "";
  const profile = rawProfile.map(field => ({
    id: field.id as string, key: (field.fieldKey as string | null) ?? null, label: field.label as string,
    value: field.fieldType === "derived" && field.fieldKey === "yearsOfExperience" ? yearsSinceHijri(hireDate) : (field.value as string),
    span: Number(field.span) as 1 | 2, type: field.fieldType as string, options: field.options as string[], updatedAt: field.updatedAt as Date,
  }));

  const schools = (lookup.schools.get(clusterId) ?? []).map(school => {
    const schoolId = String(school.id);
    const evaluation = lookup.evaluation.get(schoolId);
    const discipline = lookup.discipline.get(schoolId);
    return {
      id: schoolId, name: school.name as string, stage: school.stage as string, area: school.area as string,
      ministryNo: school.ministryNo as string, ministryEmail: school.ministryEmail as string,
      educationType: school.educationType as string, specialEdProgram: school.specialEdProgram as string,
      hasGuard: Boolean(school.hasGuard), classes: Number(school.classes), students: Number(school.students),
      giftedClasses: Number(school.giftedClasses), giftedStudents: Number(school.giftedStudents),
      teachesChinese: Boolean(school.teachesChinese), tier: (school.tier as string | null) ?? null, updatedAt: school.updatedAt as Date,
      evaluation: evaluation ? {
        supportType: evaluation.supportType as string, nafesValue: evaluation.nafesValue as number | null,
        nafesDirection: evaluation.nafesDirection as string, nafesDelta: evaluation.nafesDelta as string,
        qudrat: evaluation.qudrat as number | null, tahsili: evaluation.tahsili as number | null,
        externalReportUrl: evaluation.externalReportUrl as string, externalReportStatus: evaluation.externalReportStatus as string,
        importedAt: evaluation.importedAt as Date | null,
      } : null,
      madrasati: madrasatiValues(lookup.madrasati.get(schoolId)),
      discipline: {
        daily: Number(discipline?.daily ?? 0), weekly: Number(discipline?.weekly ?? 0), monthly: Number(discipline?.monthly ?? 0),
        planStatus: (discipline?.planStatus as string | undefined) ?? "missing", planUrl: (discipline?.planUrl as string | undefined) ?? "",
      },
      absenceToday: lookup.absence.get(schoolId) ?? false,
      visitCount: lookup.visits.get(schoolId) ?? 0,
      customFields: (lookup.custom.get(schoolId) ?? []).map(field => ({ id: field.id as string, label: field.label as string, value: field.value as string, updatedAt: field.updatedAt as Date })),
      staffTiles: (lookup.tiles.get(schoolId) ?? []).map(tile => ({ id: tile.id as string, label: tile.label as string, value: Number(tile.value), updatedAt: tile.updatedAt as Date })),
      leadership: (lookup.roles.get(schoolId) ?? []).map(role => ({
        id: role.id as string, role: role.role as string, state: role.state as string, updatedAt: role.updatedAt as Date,
        fields: (lookup.roleFields.get(String(role.id)) ?? []).map(field => ({ id: field.id as string, label: field.label as string, value: field.value as string, updatedAt: field.updatedAt as Date })),
      })),
    };
  });

  const plans = (lookup.plans.get(clusterId) ?? []).map(plan => ({
    id: plan.id as string, kind: plan.kind as string, label: plan.label as string, hint: plan.hint as string,
    url: plan.url as string, status: plan.status as string, updatedAt: plan.updatedAt as Date,
  }));
  const submittedAt = lookup.submissions.get(clusterId) ?? null;

  return {
    cluster: {
      id: clusterId, label: cluster.label as string, memberId: cluster.memberId as string,
      memberName: cluster.memberName as string, memberEmail: cluster.memberEmail as string, memberPhone: cluster.memberPhone as string,
      nafesCardFolderUrl: cluster.nafesCardFolderUrl as string, today, submittedToday: submittedAt,
      lastActivityAt: lookup.activity.get(clusterId) ?? (cluster.updatedAt as Date),
    },
    profile,
    schools,
    hiddenSchoolFields: (lookup.overrides.get(clusterId) ?? []).map(row => row.fieldKey as string),
    plans,
    programs: (lookup.programs.get(clusterId) ?? []).map(program => ({
      id: program.id as string, kind: program.kind as string, label: program.label as string, count: Number(program.count),
      reportsUrl: program.reportsUrl as string, status: program.status as string, updatedAt: program.updatedAt as Date,
    })),
    sections: (lookup.sections.get(clusterId) ?? []).map(section => ({
      id: section.id as string, label: section.label as string, updatedAt: section.updatedAt as Date,
      fields: (lookup.sectionFields.get(String(section.id)) ?? []).map(field => ({ id: field.id as string, label: field.label as string, value: field.value as string, updatedAt: field.updatedAt as Date })),
    })),
    disciplineSupportPlan: { text: (lookup.support.get(clusterId)?.text as string | undefined) ?? "", updatedAt: (lookup.support.get(clusterId)?.updatedAt as Date | undefined) ?? null },
    completion: completionPct({ profile, schools, plans }),
  };
}

/** Per-member summary for the head's dashboard, without PII (national IDs and phones are only in the audited detail view). */
export function memberSummary(workspace: Workspace, deadline: string | null) {
  const { cluster, schools } = workspace;
  const disciplineValues = schools.map(school => school.discipline.daily).filter(value => value > 0);
  return {
    id: cluster.memberId, clusterId: cluster.id, name: cluster.memberName, email: cluster.memberEmail, clusterLabel: cluster.label,
    initials: initials(cluster.memberName), completion: workspace.completion, schoolCount: schools.length,
    absence: schools.filter(school => school.absenceToday).length,
    discipline: disciplineValues.length ? Math.round(disciplineValues.reduce((sum, value) => sum + value, 0) / disciplineValues.length) : null,
    visits: schools.reduce((sum, school) => sum + school.visitCount, 0),
    submission: submissionStatus(cluster.submittedToday, deadline),
    submittedAt: cluster.submittedToday,
    lastActivityAt: cluster.lastActivityAt,
  };
}

export function submissionStatus(submittedAt: Date | null, deadline: string | null): "submitted" | "late" | "missing" {
  if (!submittedAt) return "missing";
  if (!deadline) return "submitted";
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(submittedAt);
  return local > deadline ? "late" : "submitted";
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2);
