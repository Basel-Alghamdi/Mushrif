import type { MemberDetail, MemberSummary, TeamResponse, TeamStats } from "@rasd/schemas";
import { Account, findAccountById, membersOfHead, publicUser } from "./accounts.js";
import { riyadhDay, today } from "./db.js";
import { documentsForOwner, toDocumentInfo } from "./documents.js";
import { absenceDoneToday, getWorkspace, visitCountFor, visitsForUser } from "./workspaces.js";

/** First-name and family-name initials (family name without "ال"); ZWNJ keeps them from joining into one glyph. */
export function initialsOf(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.[0] ?? "";
  const family = parts[parts.length - 1].replace(/^ال(?=..)/, "");
  return `${parts[0][0]}‌${family[0]}`;
}

export function summarize(account: Account): MemberSummary {
  const workspace = getWorkspace(account);
  const schools = workspace.schools;
  return {
    ...publicUser(account),
    initials: initialsOf(account.name),
    activated: account.activated,
    lastLoginAt: account.lastLoginAt,
    completion: workspace.completion,
    missing: workspace.missing,
    schoolCount: schools.length,
    studentCount: schools.reduce((sum, school) => sum + (Number(school.students) || 0), 0),
    teacherCount: schools.reduce((sum, school) => sum + (Number(school.teachers) || 0), 0),
    absenceDoneToday: absenceDoneToday(schools),
    visitCount: visitCountFor(account.id),
    documentCount: documentsForOwner(account.id).length,
    programCount: workspace.programs.length,
    submittedAt: workspace.submittedAt,
    lastActivityAt: account.lastActivityAt,
    // "حدّثت اليوم": anything she did herself today counts (there is no separate send step any more).
    submittedToday: [account.lastActivityAt, workspace.submittedAt].some(at => at && riyadhDay(at) === today()),
    workspaceUpdatedAt: workspace.updatedAt,
  };
}

export function statsFor(members: MemberSummary[]): TeamStats {
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

export function teamForHead(headId: string): TeamResponse {
  const members = membersOfHead(headId).map(summarize);
  return { members, stats: statsFor(members) };
}

/** Full record of one member, or null when she is not on this head's team. */
export function memberDetail(headId: string, memberId: string): MemberDetail | null {
  const account = findAccountById(memberId);
  if (!account || account.role !== "member" || account.headId !== headId) return null;
  const workspace = getWorkspace(account);
  return {
    ...summarize(account),
    workspace,
    visits: visitsForUser(account.id, workspace.schools),
    documents: documentsForOwner(account.id).map(toDocumentInfo),
  };
}
