// The team as the agent sees it, read once per message from main's tables (loadDistrict + visits + documents) and
// mapped onto the engine's model. Everything after this point reads the snapshot synchronously.
import { auditWith, PASSIVE_ACTIONS } from "../audit.js";
import type { Actor } from "../auth.js";
import { atomically, type Row, type Sql } from "../db.js";
import { documentContentsForDistrict, toDocumentInfo, type StoredDocument } from "../documents.js";
import { loadDistrict } from "../routes/district.js";
import type { memberSummary, Workspace } from "../workspace.js";
import { builtInByKey, builtInField, type MemberDetail, type MemberSummary, type ProfileField, type School, type Session, type TeamStats, type Visit } from "./model.js";
import { buildNameIndex, type NameIndex } from "./names.js";
import { comparable, normalizeArabic } from "./normalize.js";

export type TeamSnapshot = {
  members: MemberSummary[];
  stats: TeamStats;
  index: NameIndex;
  details: Map<string, MemberDetail>;
  /** Every file in the district: the members' files and the head's own chat uploads (with their text). */
  documents: StoredDocument[];
  /** Members whose full file (with national IDs, phones…) a reply used: audited as read_pii, like the head's detail view. */
  read: Set<string>;
};

type MainSchool = Workspace["schools"][number];

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

// Staff tiles and leadership roles are free-form in main; these patterns find the ones the engine reports on.
export const TILE_PATTERNS = { teachers: /تعليمي|معلم/, admin: /اداري/, deputies: /وكيل/ } as const;
export const PRINCIPAL_ROLE = /مدير|قايد/;

const tileValue = (school: MainSchool, pattern: RegExp) => school.staffTiles.find(tile => pattern.test(normalizeArabic(tile.label)))?.value ?? 0;

function principalOf(school: MainSchool) {
  const role = school.leadership.find(item => PRINCIPAL_ROLE.test(normalizeArabic(item.role)));
  const field = role?.fields.find(item => comparable(item.label) === comparable("الاسم")) ?? role?.fields[0];
  return field?.value ?? "";
}

function schoolOf(school: MainSchool, today: string): School {
  const notes = school.customFields.find(field => comparable(field.label) === comparable("ملاحظات"));
  const evaluation = school.evaluation;
  return {
    id: school.id, name: school.name, stage: school.stage, area: school.area, ministryNo: school.ministryNo, email: school.ministryEmail,
    educationType: school.educationType, specialEducation: school.specialEdProgram, hasGuard: school.hasGuard ? "يوجد" : "لا يوجد",
    classes: school.classes, students: school.students, giftedClasses: school.giftedClasses, giftedStudents: school.giftedStudents,
    teachesChinese: school.teachesChinese ? "نعم" : "لا",
    teachers: tileValue(school, TILE_PATTERNS.teachers), admin: tileValue(school, TILE_PATTERNS.admin), deputies: tileValue(school, TILE_PATTERNS.deputies),
    tier: school.tier ?? "", support: evaluation?.supportType ?? "", nafes: evaluation?.nafesValue == null ? "" : String(evaluation.nafesValue),
    qudrat: evaluation?.qudrat ?? null, tahsili: evaluation?.tahsili ?? null, madrasati: school.madrasati,
    discipline: [school.discipline.daily, school.discipline.weekly, school.discipline.monthly],
    absence: school.absenceToday, ...(school.absenceToday ? { absenceDate: today } : {}),
    principal: principalOf(school), ...(notes ? { notes: notes.value } : {}),
    customFields: school.customFields.map(({ id, label, value }) => ({ id, label, value })),
    staffTiles: school.staffTiles.map(({ id, label, value }) => ({ id, label, value })),
    leadership: school.leadership.map(role => ({ id: role.id, role: role.role, state: role.state, fields: role.fields.map(({ id, label, value }) => ({ id, label, value })) })),
    updatedAt: iso(school.updatedAt) ?? undefined,
  };
}

/** Main's profile rows with the engine's ids, plus the login email and the cluster label as two more fields. */
function profileOf(workspace: Workspace): ProfileField[] {
  const login: ProfileField = { id: "email", label: builtInField("email")!.label, value: workspace.cluster.memberEmail, kind: "email" };
  const cluster: ProfileField = { id: "cluster", label: builtInField("cluster")!.label, value: workspace.cluster.label, kind: "text" };
  const fields: ProfileField[] = [];
  for (const row of workspace.profile) {
    const builtIn = row.key ? builtInByKey(row.key) : null;
    fields.push({
      id: builtIn?.id ?? row.id, label: row.label, value: row.value ?? "", kind: builtIn?.kind ?? "text",
      ...(builtIn ? {} : { custom: true }), ...(row.type === "derived" ? { derived: true } : {}), updatedAt: iso(row.updatedAt) ?? undefined,
    });
    if (row.key === "title") fields.push(cluster);
    if (row.key === "phone") fields.push(login);
  }
  for (const extra of [cluster, login]) if (!fields.includes(extra)) fields.push(extra);
  return fields;
}

/** What still holds main's completion % back (the same items completionPct counts), in plain Arabic. */
export function missingOf(workspace: Workspace) {
  const items: string[] = [];
  for (const field of workspace.profile) if (field.type !== "derived" && !String(field.value ?? "").trim()) items.push(field.label);
  if (!workspace.schools.length) items.push("مدارس العنقود");
  for (const school of workspace.schools) {
    const gaps = [
      !school.stage.trim() && "المرحلة", !school.area.trim() && "الحي", !school.ministryNo.trim() && "الرقم الوزاري",
      school.classes <= 0 && "عدد الفصول", school.students <= 0 && "عدد الطالبات",
    ].filter((gap): gap is string => Boolean(gap));
    if (gaps.length) items.push(`بيانات «${school.name}»: ${gaps.join("، ")}`);
  }
  const pending = workspace.schools.filter(school => !school.absenceToday);
  if (pending.length) items.push(pending.length === workspace.schools.length ? "تثبيت غياب اليوم" : `تثبيت غياب اليوم في ${pending.map(school => `«${school.name}»`).join("، ")}`);
  // The five plans are one item, so they do not crowd out everything else in a short list.
  const plans = workspace.plans.filter(plan => plan.status !== "uploaded");
  if (plans.length) items.push(plans.length === workspace.plans.length ? "رفع الخطط" : `الخطط: ${plans.map(plan => plan.label).join("، ")}`);
  return items;
}

function statsOf(members: MemberSummary[]): TeamStats {
  const sum = (pick: (member: MemberSummary) => number) => members.reduce((total, member) => total + pick(member), 0);
  return {
    members: members.length,
    activated: members.filter(member => member.activated).length,
    notActivated: members.filter(member => !member.activated).length,
    submittedToday: members.filter(member => member.submittedToday).length,
    averageCompletion: members.length ? Math.round(sum(member => member.completion) / members.length) : 0,
    completeProfiles: members.filter(member => member.completion >= 85).length,
    schools: sum(member => member.schoolCount),
    students: sum(member => member.studentCount),
    teachers: sum(member => member.teacherCount),
    visits: sum(member => member.visitCount),
    documents: sum(member => member.documentCount),
  };
}

function visitOf(row: Row): Visit {
  return {
    id: String(row.id), userId: String(row.memberId), schoolId: String(row.schoolId), schoolName: String(row.schoolName ?? ""),
    type: String(row.type), text: String(row.text ?? ""), beneficiaries: Number(row.beneficiaries ?? 0), sessions: Number(row.sessions ?? 0),
    blockers: String(row.blockers ?? ""), createdAt: iso(row.createdAt)!,
  };
}

function memberOf(main: { workspace: Workspace; summary: ReturnType<typeof memberSummary> }, visits: Visit[], documents: StoredDocument[], lastChange: string | null): MemberDetail {
  const { workspace, summary } = main;
  const today = workspace.cluster.today;
  const schools = workspace.schools.map(school => schoolOf(school, today));
  const profile = profileOf(workspace);
  const missing = missingOf(workspace);
  const phone = profile.find(field => field.id === "phone")?.value || workspace.cluster.memberPhone;
  const submittedAt = iso(workspace.cluster.submittedToday);
  return {
    id: summary.id, clusterId: summary.clusterId, name: summary.name, email: summary.email, phone, title: summary.title ?? "",
    clusterLabel: summary.clusterLabel, initials: summary.initials, activated: summary.activated, lastLoginAt: iso(summary.lastSignInAt),
    completion: workspace.completion, missing, schoolCount: schools.length,
    studentCount: schools.reduce((total, school) => total + school.students, 0),
    teacherCount: schools.reduce((total, school) => total + school.teachers, 0),
    absenceDoneToday: summary.absence, visitCount: visits.length, documentCount: documents.length, programCount: workspace.programs.length,
    submittedAt, lastActivityAt: iso(summary.lastActivityAt), submittedToday: Boolean(submittedAt), workspaceUpdatedAt: lastChange,
    workspace: {
      profile, schools,
      programs: workspace.programs.map(({ id, kind, label, count, reportsUrl, status }) => ({ id, kind, label, count, reportsUrl, status })),
      sections: workspace.sections.map(section => ({ id: section.id, label: section.label, fields: section.fields.map(({ id, label, value }) => ({ id, label, value })) })),
      updatedAt: lastChange, completion: workspace.completion, missing,
    },
    visits,
    documents: documents.map(toDocumentInfo),
  };
}

/** Reads the head's whole team into the engine's model (a fixed number of queries). */
export async function loadTeam(db: Sql, head: Actor): Promise<TeamSnapshot> {
  const { members: main } = await loadDistrict(db, head.districtId);
  const clusterIds = db.array(main.map(item => item.workspace.cluster.id));
  const [visitRows, documents, changeRows] = await Promise.all([
    db`select v.*, s.name as school_name from visit_reports v left join schools s on s.id = v.school_id
      where v.cluster_id = any(${clusterIds}::uuid[]) order by v.created_at desc`,
    documentContentsForDistrict(db, head.districtId),
    // The file's last change by anyone (her, the head or the agent); creating the account does not count.
    db`select cluster_id, max(at) as at from audit_log where cluster_id = any(${clusterIds}::uuid[])
      and action <> all(${db.array(PASSIVE_ACTIONS)}::text[]) and not (entity = 'member' and action = 'create') group by cluster_id`,
  ]);
  const visits = new Map<string, Visit[]>();
  for (const row of visitRows) visits.set(String(row.clusterId), [...(visits.get(String(row.clusterId)) ?? []), visitOf(row)]);
  const changes = new Map(changeRows.map(row => [String(row.clusterId), iso(row.at)]));

  const details = main.map(item => {
    const clusterId = item.workspace.cluster.id;
    return memberOf(item, visits.get(clusterId) ?? [], documents.filter(document => document.clusterId === clusterId), changes.get(clusterId) ?? null);
  });
  const members = details.map(({ workspace: _workspace, visits: _visits, documents: _documents, ...summary }) => summary);
  return { members, stats: statsOf(members), index: buildNameIndex(members), details: new Map(details.map(detail => [detail.id, detail])), documents, read: new Set() };
}

/** One read_pii audit row per member whose full file the agent used for a reply (actor = the head, source "agent"). */
export async function auditFileReads(session: Session, snapshots: TeamSnapshot[]) {
  const clusters = new Set<string>();
  for (const team of snapshots) for (const id of team.read) clusters.add(team.details.get(id)!.clusterId);
  if (!clusters.size) return;
  try {
    await atomically(session.db, async tx => {
      for (const clusterId of clusters) await auditWith(tx, session.audit, { action: "read_pii", entity: "cluster", entityId: clusterId, clusterId });
    });
  } catch (error) {
    console.error("could not audit the agent's file reads", error);
  }
}
