import {
  DEFAULT_FOLDERS, MADRASATI_METRICS, completionPct, riyadhDate, yearsSinceHijri,
  type EvaluationDomain, type EvaluationDomainKey, type FolderDef, type FolderKind, type FolderLayout, type FolderScope,
} from "@rasd/schemas";
import { PASSIVE_ACTIONS } from "./audit.js";
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

let signInsUnreadable = false;

const reportUnreadable = (error: unknown) => {
  if (signInsUnreadable) return;
  signInsUnreadable = true;
  console.error(`cannot read auth.users (${(error as { code?: string }).code ?? (error as Error).message}): last sign-in times stay empty`);
};

/**
 * When each user last signed in (Supabase's auth.users.last_sign_in_at). A database role without access to the auth
 * schema (42501) gets null — logged once, and not asked again — instead of failing every workspace endpoint with it.
 */
export async function lastSignIns(db: Sql, userIds: string[]): Promise<Map<string, Date | null> | null> {
  if (!userIds.length) return new Map();
  if (signInsUnreadable) return null;
  const read = (q: Sql) => q`select id, last_sign_in_at from auth.users where id = any(${q.array(userIds)}::uuid[])`;
  try {
    // Inside a transaction the read gets its own savepoint, so a refusal never aborts the caller's work.
    const rows = await ("savepoint" in db ? db.savepoint(tx => read(tx)) : read(db));
    return new Map(rows.map(row => [String(row.id), (row.lastSignInAt as Date | null) ?? null]));
  } catch (error) {
    reportUnreadable(error);
    return null;
  }
}

/** The same, keyed by cluster, so it goes out with the other workspace queries (outside a transaction only). */
async function lastSignInsOfClusters(db: Sql, clusterIds: string[]): Promise<Map<string, Date | null> | null> {
  if (signInsUnreadable) return null;
  try {
    const rows = await db`
      select c.member_id as id, u.last_sign_in_at from clusters c join auth.users u on u.id = c.member_id
      where c.id = any(${db.array(clusterIds)}::uuid[])`;
    return new Map(rows.map(row => [String(row.id), (row.lastSignInAt as Date | null) ?? null]));
  } catch (error) {
    reportUnreadable(error);
    return null;
  }
}

/** Her folders and her schools' folders (live, and removed ones), or the defaults while she has no folder rows at all. */
export function folderLayout(rows: Row[]): FolderLayout {
  if (!rows.length) return DEFAULT_FOLDERS;
  const def = (row: Row): FolderDef => ({
    id: String(row.id), key: String(row.key), label: String(row.label), parent: (row.parentKey as string | null) ?? null, kind: row.kind as FolderKind,
  });
  const live = rows.filter(row => !row.deletedAt);
  const of = (scope: FolderScope) => live.filter(row => row.scope === scope).map(def);
  const removed = rows.filter(row => row.deletedAt).map(row => ({ ...def(row), scope: row.scope as FolderScope }));
  return { member: of("member"), school: of("school"), removed };
}

/**
 * Loads complete cluster files for the given clusters. Every query is keyed on the cluster ids, so they all go out
 * together: the API and the database are far apart, and each sequential step costs a full round trip.
 */
export async function loadWorkspaces(db: Sql, clusterIds: string[], today = riyadhDate()) {
  const result = new Map<string, ReturnType<typeof buildWorkspace>>();
  if (!clusterIds.length) return result;
  const ids = db.array(clusterIds);
  // Inside a transaction a refused auth.users read would abort the queries beside it, so there it runs afterwards in
  // its own savepoint (lastSignIns); outside one it goes out in the same batch.
  const inTransaction = "savepoint" in db;

  const [
    clusters, profileRows, schoolRows, overrideRows, planRows, programRows, sectionRows, supportRows, submissionRows, activityRows, documentRows,
    customRows, tileRows, roleRows, roleFieldRows, evaluationRows, madrasatiRows, disciplineRows, absenceRows, visitRows, sectionFieldRows, folderRows,
    batchedSignIns,
  ] = await Promise.all([
    db`select c.*, p.name as member_name, p.email as member_email, p.phone as member_phone, p.title as member_title, p.activated_at
      from clusters c join profiles p on p.id = c.member_id where c.id = any(${ids}::uuid[])`,
    db`select * from profile_fields where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from schools where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from school_field_overrides where cluster_id = any(${ids}::uuid[]) and hidden`,
    db`select * from plans where cluster_id = any(${ids}::uuid[]) order by sort_order, kind`,
    db`select * from pd_programs where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from custom_sections where cluster_id = any(${ids}::uuid[]) and deleted_at is null order by sort_order, created_at`,
    db`select * from discipline_support_plans where cluster_id = any(${ids}::uuid[])`,
    db`select cluster_id, submitted_at from daily_submissions where cluster_id = any(${ids}::uuid[]) and date = ${today}::date`,
    // Her own work only (decision 6): what the head or the agent changed in her file does not count as her activity.
    // One index probe per member (audit_log_activity_idx) instead of aggregating her whole history.
    db`select c.id as cluster_id, latest.at as last_activity_at from clusters c
      cross join lateral (
        select a.at from audit_log a
        where a.cluster_id = c.id and a.actor_id = c.member_id and a.action <> all(${db.array(PASSIVE_ACTIONS)}::text[])
        order by a.at desc limit 1
      ) latest
      where c.id = any(${ids}::uuid[])`,
    db`select cluster_id, count(*)::int as count from attachments where cluster_id = any(${ids}::uuid[]) and deleted_at is null group by cluster_id`,
    db`select f.* from school_custom_fields f join schools s on s.id = f.school_id
      where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null and f.deleted_at is null order by f.sort_order, f.created_at`,
    db`select t.* from school_staff_tiles t join schools s on s.id = t.school_id
      where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null and t.deleted_at is null order by t.sort_order, t.created_at`,
    db`select r.* from leadership_roles r join schools s on s.id = r.school_id
      where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null and r.deleted_at is null order by r.sort_order, r.created_at`,
    db`select f.* from leadership_fields f join leadership_roles r on r.id = f.role_id join schools s on s.id = r.school_id
      where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null and r.deleted_at is null and f.deleted_at is null
      order by f.sort_order, f.created_at`,
    db`select e.* from evaluation_indicators e join schools s on s.id = e.school_id where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null`,
    db`select m.* from madrasati_indicators m join schools s on s.id = m.school_id where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null`,
    db`select d.* from discipline_indicators d join schools s on s.id = d.school_id where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null`,
    db`select a.school_id, a.done, a.full_attendance from absence_confirmations a join schools s on s.id = a.school_id
      where s.cluster_id = any(${ids}::uuid[]) and s.deleted_at is null and a.date = ${today}::date`,
    db`select school_id, count(*)::int as count from visit_reports where cluster_id = any(${ids}::uuid[]) group by school_id`,
    db`select f.* from custom_section_fields f join custom_sections cs on cs.id = f.section_id
      where cs.cluster_id = any(${ids}::uuid[]) and cs.deleted_at is null and f.deleted_at is null order by f.sort_order, f.created_at`,
    // Removed folders too: a member whose folders were all removed is told apart from one who never had folder rows.
    db`select * from folders where cluster_id = any(${ids}::uuid[]) order by sort_order, created_at`,
    inTransaction ? Promise.resolve(null) : lastSignInsOfClusters(db, clusterIds),
  ]);
  const signIns = inTransaction ? await lastSignIns(db, clusters.map(row => String(row.memberId))) : batchedSignIns;

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
    documents: new Map(documentRows.map(row => [String(row.clusterId), Number(row.count)])),
    signIns: signIns ?? new Map<string, Date | null>(),
    custom: groupBy(customRows, "schoolId"),
    tiles: groupBy(tileRows, "schoolId"),
    roles: groupBy(roleRows, "schoolId"),
    roleFields: groupBy(roleFieldRows, "roleId"),
    evaluation: new Map(evaluationRows.map(row => [String(row.schoolId), row])),
    madrasati: new Map(madrasatiRows.map(row => [String(row.schoolId), row])),
    discipline: new Map(disciplineRows.map(row => [String(row.schoolId), row])),
    absence: new Map(absenceRows.map(row => [String(row.schoolId), Boolean(row.done)])),
    attendance: new Map(absenceRows.map(row => [String(row.schoolId), (row.fullAttendance as boolean | null) ?? null])),
    visits: new Map(visitRows.map(row => [String(row.schoolId), Number(row.count)])),
    folders: groupBy(folderRows, "clusterId"),
  };

  for (const cluster of clusters) result.set(String(cluster.id), buildWorkspace(cluster, lookup, today));
  return result;
}

type Lookup = {
  profile: Map<string, Row[]>; schools: Map<string, Row[]>; overrides: Map<string, Row[]>; plans: Map<string, Row[]>;
  programs: Map<string, Row[]>; sections: Map<string, Row[]>; sectionFields: Map<string, Row[]>; support: Map<string, Row>;
  submissions: Map<string, Date>; activity: Map<string, Date>; documents: Map<string, number>; signIns: Map<string, Date | null>;
  custom: Map<string, Row[]>; tiles: Map<string, Row[]>;
  roles: Map<string, Row[]>; roleFields: Map<string, Row[]>; evaluation: Map<string, Row>; madrasati: Map<string, Row>;
  discipline: Map<string, Row>; absence: Map<string, boolean>; attendance: Map<string, boolean | null>; visits: Map<string, number>;
  folders: Map<string, Row[]>;
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
        nafesGrade3: evaluation.nafesGrade3 as number | null, nafesGrade6: evaluation.nafesGrade6 as number | null, nafesGrade9: evaluation.nafesGrade9 as number | null,
        domains: (evaluation.domains ?? {}) as Partial<Record<EvaluationDomainKey, EvaluationDomain>>,
        externalReportUrl: evaluation.externalReportUrl as string, externalReportStatus: evaluation.externalReportStatus as string,
        selfReportUrl: evaluation.selfReportUrl as string,
        importedAt: evaluation.importedAt as Date | null,
      } : null,
      madrasati: madrasatiValues(lookup.madrasati.get(schoolId)),
      discipline: {
        daily: Number(discipline?.daily ?? 0), weekly: Number(discipline?.weekly ?? 0), monthly: Number(discipline?.monthly ?? 0),
        planStatus: (discipline?.planStatus as string | undefined) ?? "missing", planUrl: (discipline?.planUrl as string | undefined) ?? "",
      },
      absenceToday: lookup.absence.get(schoolId) ?? false,
      /** رصد حضور ١٠٠٪ today: yes, no, or null while unanswered. */
      fullAttendanceToday: lookup.attendance.get(schoolId) ?? null,
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
      memberTitle: cluster.memberTitle as string, activated: Boolean(cluster.activatedAt), lastSignInAt: lookup.signIns.get(String(cluster.memberId)) ?? null,
      nafesCardFolderUrl: cluster.nafesCardFolderUrl as string, today, submittedToday: submittedAt,
      lastActivityAt: lookup.activity.get(clusterId) ?? null, documentCount: lookup.documents.get(clusterId) ?? 0,
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
    /** ملف الإنجاز: her folders and the folders of each of her schools. */
    folders: folderLayout(lookup.folders.get(clusterId) ?? []),
    disciplineSupportPlan: { text: (lookup.support.get(clusterId)?.text as string | undefined) ?? "", updatedAt: (lookup.support.get(clusterId)?.updatedAt as Date | undefined) ?? null },
    completion: completionPct({ profile, schools }),
  };
}

/** Per-member summary for the head's dashboard, without PII (national IDs and phones are only in the audited detail view). */
export function memberSummary(workspace: Workspace, deadline: string | null) {
  const { cluster, schools } = workspace;
  const disciplineValues = schools.map(school => school.discipline.daily).filter(value => value > 0);
  return {
    id: cluster.memberId, clusterId: cluster.id, name: cluster.memberName, email: cluster.memberEmail, clusterLabel: cluster.label,
    title: cluster.memberTitle, activated: cluster.activated, lastSignInAt: cluster.lastSignInAt, documentCount: cluster.documentCount,
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
