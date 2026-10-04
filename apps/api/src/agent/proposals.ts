// Proposals: changes the agent prepares for Khulood to approve, their execution, and undo.
import type { ChatBlock, MemberCreateInput, ProposalChange, ProposalStatus, School } from "@rasd/schemas";
import type { Account } from "../accounts.js";
import { createProposal, type Proposal } from "../chat-store.js";
import { cleanText, newId, now } from "../db.js";
import { getDocument } from "../documents.js";
import { getWorkspace } from "../workspaces.js";
import {
  assignDocumentTo, createTeamMember, memberAccount, removeTeamMember, restoreProfileFields, saveSchools, writeProfileFields,
  type FieldRestore, type FieldWrite,
} from "./data.js";
import { comparable } from "./normalize.js";
import { ar, countAcc, countGen, NOUNS, shortName } from "./render.js";

export type NewMemberSuggestion = MemberCreateInput & { fields?: FieldWrite[]; source?: string };
export type SchoolUpsert = { memberId: string; memberName: string; schools: Partial<School>[]; source?: string };
export type DocumentAssignment = { documentId: string; documentName: string; memberId: string; memberName: string };
export type UndoPlan = {
  profiles: { memberId: string; values: FieldRestore[] }[];
  createdMemberIds: string[];
  schools: { memberId: string; schools: School[] }[];
  assignments: { documentId: string; ownerId: string | null }[];
};

export type ProposalPayload = {
  title: string;
  summary: string;
  changes?: ProposalChange[];
  newMembers?: NewMemberSuggestion[];
  unmatched?: string[];
  schools?: SchoolUpsert[];
  assignments?: DocumentAssignment[];
  undo?: UndoPlan;
};

export type ProposalKind = "profile_updates" | "new_members" | "school_updates" | "assign_documents" | "import" | "undo";
/** A reply to Khulood. `intent` names the local-engine handler that answered (diagnostics and tests only — never stored). */
export type AgentReply = { text: string; blocks: ChatBlock[]; intent?: string };

const MAX_CHANGES_SHOWN = 150;

export function describeSchool(school: Partial<School>) {
  const parts = [
    school.stage,
    school.students ? `${ar(Number(school.students))} طالبة` : "",
    school.teachers ? `${ar(Number(school.teachers))} معلمة` : "",
    school.tier ? `تصنيف ${school.tier}` : "",
    school.principal ? `المديرة: ${school.principal}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "مدرسة جديدة";
}

/** Everything a proposal will change, as rows for the proposal card (profile values, schools, files). */
function displayChanges(payload: ProposalPayload): ProposalChange[] {
  const rows: ProposalChange[] = [...(payload.changes ?? [])];
  for (const upsert of payload.schools ?? []) {
    for (const school of upsert.schools) {
      rows.push({ memberId: upsert.memberId, memberName: upsert.memberName, fieldId: null, fieldLabel: `مدرسة: ${school.name ?? ""}`, before: "", after: describeSchool(school), source: upsert.source });
    }
  }
  for (const assignment of payload.assignments ?? []) {
    rows.push({ memberId: assignment.memberId, memberName: assignment.memberName, fieldId: null, fieldLabel: "إضافة ملف إلى ملفها", before: "", after: assignment.documentName });
  }
  return rows;
}

export function proposalBlock(proposalId: string, payload: ProposalPayload, status: ProposalStatus = "pending"): ChatBlock {
  const changes = displayChanges(payload);
  const newMembers = (payload.newMembers ?? []).map(({ name, email, title, phone, clusterLabel }) => ({ name, email, ...(title ? { title } : {}), ...(phone ? { phone } : {}), ...(clusterLabel ? { clusterLabel } : {}) }));
  const hidden = changes.length - MAX_CHANGES_SHOWN;
  return {
    type: "proposal",
    proposalId,
    title: payload.title,
    summary: hidden > 0 ? `${payload.summary} (أعرض أول ${ar(MAX_CHANGES_SHOWN)} تغيير، وسيُطبَّق الكل)` : payload.summary,
    changes: changes.slice(0, MAX_CHANGES_SHOWN),
    ...(newMembers.length ? { newMembers } : {}),
    ...(payload.unmatched?.length ? { unmatched: payload.unmatched.slice(0, 50) } : {}),
    status,
  };
}

export function hasWork(payload: ProposalPayload) {
  return Boolean(payload.changes?.length || payload.newMembers?.length || payload.schools?.some(item => item.schools.length) || payload.assignments?.length);
}

/** Stores a pending proposal and returns its card. */
export function proposeChanges(head: Account, conversationId: string | null, kind: ProposalKind, payload: ProposalPayload): ChatBlock {
  const proposal = createProposal({ userId: head.id, conversationId, kind, payload });
  return proposalBlock(proposal.id, payload);
}

// ---------- Schools ----------
export function emptySchool(name: string): School {
  return {
    id: newId(), name, stage: "", area: "", ministryNo: "", email: "", educationType: "", specialEducation: "", hasGuard: "",
    classes: 0, students: 0, giftedClasses: 0, giftedStudents: 0, teachesChinese: "", teachers: 0, admin: 0, deputies: 0, expert: 0, advanced: 0,
    tier: "", support: "", nafes: "", qudrat: 0, tahsili: 0, madrasati: [0, 0, 0, 0, 0, 0], discipline: [0, 0, 0], absence: false, principal: "",
    notes: "", customFields: [], leadership: [], updatedAt: now(),
  };
}

/** Adds new schools and fills non-empty values into existing ones (matched by name). */
export function upsertSchools(current: School[], incoming: Partial<School>[]) {
  const schools = current.map(school => ({ ...school }));
  for (const item of incoming) {
    const name = cleanText(item.name);
    if (!name) continue;
    const index = schools.findIndex(school => comparable(school.name) === comparable(name));
    const base = index >= 0 ? schools[index] : emptySchool(name);
    const merged: School = { ...base, updatedAt: now() };
    for (const [key, value] of Object.entries(item) as [keyof School, unknown][]) {
      if (key === "id" || value === undefined || value === null || value === "") continue;
      if (key === "customFields" && Array.isArray(value)) {
        const fields = [...(base.customFields ?? [])];
        for (const field of value as { id: string; label: string; value: string }[]) {
          const existing = fields.findIndex(entry => comparable(entry.label) === comparable(field.label));
          if (existing >= 0) fields[existing] = { ...fields[existing], value: field.value };
          else fields.push({ id: newId(), label: field.label, value: field.value });
        }
        merged.customFields = fields;
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    if (index >= 0) schools[index] = merged;
    else schools.push(merged);
  }
  return schools;
}

// ---------- Execution ----------
type Outcome = { rows: string[][]; memberIds: (string | null)[]; undo: UndoPlan; notes: string[]; counts: { values: number; members: Map<string, string>; created: number; schools: number; files: number } };

function emptyOutcome(): Outcome {
  return { rows: [], memberIds: [], undo: { profiles: [], createdMemberIds: [], schools: [], assignments: [] }, notes: [], counts: { values: 0, members: new Map(), created: 0, schools: 0, files: 0 } };
}

function applyProfileChanges(head: Account, changes: ProposalChange[], outcome: Outcome) {
  const byMember = new Map<string, ProposalChange[]>();
  for (const change of changes) byMember.set(change.memberId, [...(byMember.get(change.memberId) ?? []), change]);
  for (const [memberId, list] of byMember) {
    const account = memberAccount(head.id, memberId);
    if (!account) { outcome.notes.push(`لم أجد ${list[0].memberName} في الفريق، فتجاوزت بياناتها`); continue; }
    const results = writeProfileFields(account, list.map(change => ({ fieldId: change.fieldId, fieldLabel: change.fieldLabel, value: change.after })));
    const restores: FieldRestore[] = [];
    for (const result of results) {
      if (result.error) { outcome.notes.push(`${shortName(account.name)} — ${result.fieldLabel}: ${result.error}`); continue; }
      restores.push({ fieldId: result.fieldId, fieldLabel: result.fieldLabel, value: result.before, remove: result.created });
      outcome.rows.push([account.name, result.fieldLabel, result.before || "—", result.after || "(فارغ)"]);
      outcome.memberIds.push(account.id);
      outcome.counts.values += 1;
      outcome.counts.members.set(account.id, account.name);
    }
    if (restores.length) outcome.undo.profiles.push({ memberId: account.id, values: restores });
  }
}

function createMembers(head: Account, members: NewMemberSuggestion[], outcome: Outcome) {
  for (const member of members) {
    try {
      const account = createTeamMember(head.id, { name: member.name, email: member.email, title: member.title, phone: member.phone, clusterLabel: member.clusterLabel });
      if (member.fields?.length) writeProfileFields(account, member.fields);
      outcome.undo.createdMemberIds.push(account.id);
      outcome.rows.push([account.name, "عضوة جديدة", "—", account.email]);
      outcome.memberIds.push(account.id);
      outcome.counts.created += 1;
    } catch (error) {
      const code = (error as Error).message;
      outcome.notes.push(code === "ACCOUNT_EXISTS" ? `يوجد حساب بالبريد ${member.email} من قبل` : `لم أستطع إنشاء حساب ${member.name || member.email}`);
    }
  }
}

function applySchools(head: Account, upserts: SchoolUpsert[], outcome: Outcome) {
  for (const upsert of upserts) {
    const account = memberAccount(head.id, upsert.memberId);
    if (!account) { outcome.notes.push(`لم أجد ${upsert.memberName} في الفريق`); continue; }
    const current = getWorkspace(account).schools;
    outcome.undo.schools.push({ memberId: account.id, schools: current });
    saveSchools(account, upsertSchools(current, upsert.schools));
    for (const school of upsert.schools) {
      outcome.rows.push([account.name, `مدرسة: ${school.name ?? ""}`, "—", describeSchool(school)]);
      outcome.memberIds.push(account.id);
      outcome.counts.schools += 1;
      outcome.counts.members.set(account.id, account.name);
    }
  }
}

function applyAssignments(head: Account, assignments: DocumentAssignment[], outcome: Outcome) {
  for (const assignment of assignments) {
    const document = getDocument(assignment.documentId);
    const account = memberAccount(head.id, assignment.memberId);
    if (!document || !account) { outcome.notes.push(`تعذّر ربط الملف ${assignment.documentName}`); continue; }
    outcome.undo.assignments.push({ documentId: document.id, ownerId: document.ownerId });
    assignDocumentTo(document.id, account.id);
    outcome.rows.push([account.name, "ملف جديد في ملفها", "—", document.name]);
    outcome.memberIds.push(account.id);
    outcome.counts.files += 1;
    outcome.counts.members.set(account.id, account.name);
  }
}

function runUndo(head: Account, plan: UndoPlan, outcome: Outcome) {
  for (const assignment of plan.assignments) {
    assignDocumentTo(assignment.documentId, assignment.ownerId);
    outcome.counts.files += 1;
  }
  for (const item of plan.schools) {
    const account = memberAccount(head.id, item.memberId);
    if (!account) continue;
    saveSchools(account, item.schools);
    outcome.counts.schools += 1;
    outcome.counts.members.set(account.id, account.name);
  }
  for (const item of plan.profiles) {
    const account = memberAccount(head.id, item.memberId);
    if (!account) continue;
    restoreProfileFields(account, item.values);
    for (const value of item.values) outcome.rows.push([account.name, value.fieldLabel, value.remove ? "(أزلت الحقل)" : value.value]);
    outcome.counts.values += item.values.length;
    outcome.counts.members.set(account.id, account.name);
  }
  for (const id of plan.createdMemberIds) {
    const account = memberAccount(head.id, id);
    if (!account) continue;
    if (account.activated) { outcome.notes.push(`${shortName(account.name)} فعّلت حسابها، فأبقيته`); continue; }
    removeTeamMember(head.id, id);
    outcome.rows.push([account.name, "حساب جديد", "(حذفته)"]);
    outcome.counts.created += 1;
  }
}

/** "رجّعت «رقم الجوال» لمنيرة الرويلي: 0509998877" for one value; a short tally otherwise. */
function undoText(outcome: Outcome) {
  const { counts } = outcome;
  const notes = outcome.notes.length ? `\n\n${outcome.notes.map(note => `- ${note}`).join("\n")}` : "";
  if (counts.values === 1 && !counts.created && !counts.schools && !counts.files) {
    const [name, label, value] = outcome.rows[0];
    return `تم التراجع ✅ رجّعت «${label}» لـ ${shortName(name)} ${value ? `كما كان: ${value}` : "فارغاً كما كان"}.${notes}`;
  }
  const parts = [
    counts.values ? `أعدت ${countAcc(counts.values, NOUNS.value)} كما كانت` : "",
    counts.schools ? `رجّعت مدارس ${countGen(counts.schools, NOUNS.member)} كما كانت` : "",
    counts.files ? `أخرجت ${countAcc(counts.files, NOUNS.file)} من ملف المشرفة` : "",
    counts.created ? `حذفت ${countAcc(counts.created, NEW_ACCOUNT)}` : "",
  ].filter(Boolean);
  return `تم التراجع ✅ ${parts.join("، و") || "أعدت البيانات كما كانت"}.${notes}`;
}

const isUndoable = (plan: UndoPlan) => Boolean(plan.profiles.length || plan.createdMemberIds.length || plan.schools.length || plan.assignments.length);

const NEW_ACCOUNT = { one: "حساباً جديداً", two: "حسابان جديدان", twoGen: "حسابين جديدين", few: "حسابات جديدة", many: "حساباً جديداً" };

/** "حدّثت ٥ قيم وحفظت ملفاً واحداً في ملفات ٣ مشرفات، وأنشأت حسابين جديدين …" */
function outcomeText(outcome: Outcome) {
  const { counts } = outcome;
  const parts: string[] = [];
  if (counts.values) parts.push(`حدّثت ${countAcc(counts.values, NOUNS.value)}`);
  if (counts.schools) parts.push(`سجّلت بيانات ${countGen(counts.schools, NOUNS.school)}`);
  if (counts.files) parts.push(`حفظت ${countAcc(counts.files, NOUNS.file)}`);
  const names = [...counts.members.values()];
  const where = names.length === 1 ? ` في ملف ${shortName(names[0])}` : names.length ? ` في ملفات ${countGen(names.length, NOUNS.member)}` : "";
  let text = parts.length ? `${parts.join("، و")}${where}` : "";
  if (counts.created) text += `${text ? "، و" : ""}أنشأت ${countAcc(counts.created, NEW_ACCOUNT)} — تدخل كل عضوة ببريدها وتختار كلمة المرور أول مرة`;
  return text;
}

/** Executes the payload, creates the matching undo proposal, and describes what happened. */
export function executePayload(head: Account, conversationId: string | null, payload: ProposalPayload, options: { offerUndo?: boolean } = {}): AgentReply {
  const outcome = emptyOutcome();
  if (payload.undo) runUndo(head, payload.undo, outcome);
  if (payload.assignments?.length) applyAssignments(head, payload.assignments, outcome);
  if (payload.newMembers?.length) createMembers(head, payload.newMembers, outcome);
  if (payload.changes?.length) applyProfileChanges(head, payload.changes, outcome);
  if (payload.schools?.length) applySchools(head, payload.schools, outcome);

  if (payload.undo) {
    return { text: undoText(outcome), blocks: [] };
  }

  const summary = outcomeText(outcome);
  const blocks: ChatBlock[] = [];
  if (outcome.rows.length) {
    blocks.push({ type: "table", title: "ما تم تغييره", columns: ["المشرفة", "البند", "قبل", "بعد"], rows: outcome.rows.slice(0, 80), memberIds: outcome.memberIds.slice(0, 80) });
  }
  if (options.offerUndo !== false && isUndoable(outcome.undo)) {
    const undo = createProposal({ userId: head.id, conversationId, kind: "undo", payload: { title: "تراجع", summary: "إرجاع البيانات كما كانت", undo: outcome.undo } satisfies ProposalPayload });
    blocks.push({ type: "applied", text: summary || "تم التنفيذ", undoProposalId: undo.id });
  }
  const notes = outcome.notes.length ? `\n\nملاحظات:\n${outcome.notes.map(note => `- ${note}`).join("\n")}` : "";
  const text = summary ? `تم ✅ ${summary}.${notes}` : `لم يتغير شيء${notes ? `.${notes}` : " — البيانات كانت محدّثة أصلاً."}`;
  return { text, blocks };
}

export function executeProposal(head: Account, proposal: Proposal): AgentReply {
  const payload = (proposal.payload ?? {}) as ProposalPayload;
  return executePayload(head, proposal.conversationId, payload);
}
