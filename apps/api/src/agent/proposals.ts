// Proposals: changes the agent prepares for Khulood to approve (stored in agent_runs), their execution, and undo.
import type { ChatBlock, MemberCreateInput, ProposalChange, ProposalStatus } from "@rasd/schemas";
import { createProposal, type Proposal, type ProposalKind } from "../chat-store.js";
import { ApiError } from "../errors.js";
import type { School, Session } from "./model.js";
import { ar, countAcc, countGen, NOUNS, shortName } from "./render.js";
import {
  createdMemberMark, createTeamMember, fileDocument, findMember, REMOVED_FIELD, runUndo, upsertSchools, writeProfileFields,
  type FieldWrite, type UndoOutcome, type UndoPlan, type UndoStep,
} from "./writes.js";

export type { ProposalKind } from "../chat-store.js";
export type NewMemberSuggestion = MemberCreateInput & { fields?: FieldWrite[]; source?: string };
export type SchoolUpsert = { memberId: string; memberName: string; schools: Partial<School>[]; source?: string };
export type DocumentAssignment = { documentId: string; documentName: string; memberId: string; memberName: string };

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

/** A reply to Khulood. `intent` names the local-engine handler that answered (diagnostics and tests only — never stored). */
export type AgentReply = { text: string; blocks: ChatBlock[]; intent?: string };

const MAX_CHANGES_SHOWN = 150;

export function describeSchool(school: Partial<School>) {
  const parts = [
    school.stage,
    school.students ? `${ar(Number(school.students))} طالبة` : "",
    school.teachers ? `${ar(Number(school.teachers))} معلمة` : "",
    school.tier ? `تصنيف ${school.tier}` : "",
    school.nafes ? `نافس ${/^\d+(\.\d+)?$/.test(String(school.nafes).trim()) ? ar(Number(school.nafes)) : school.nafes}` : "",
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

/** Stores a pending proposal (agent_runs) and returns its card. */
export async function proposeChanges(session: Session, kind: ProposalKind, payload: ProposalPayload): Promise<ChatBlock> {
  const proposal = await createProposal(session.db, { userId: session.head.id, districtId: session.head.districtId, conversationId: session.conversationId, kind, payload });
  return proposalBlock(proposal.id, payload);
}

// ---------- Execution ----------
type Outcome = UndoOutcome & { memberIds: (string | null)[]; undo: UndoStep[]; schools: number };

const emptyOutcome = (): Outcome => ({
  rows: [], memberIds: [], undo: [], notes: [], values: 0, schoolMembers: new Map(), files: 0, created: 0, members: new Map(), schools: 0,
});

const failure = (error: unknown) => {
  console.error("agent change failed", error);
  return error instanceof ApiError ? error.message : "حدث خطأ أثناء الحفظ";
};

async function applyProfileChanges(session: Session, changes: ProposalChange[], outcome: Outcome) {
  const byMember = new Map<string, ProposalChange[]>();
  for (const change of changes) byMember.set(change.memberId, [...(byMember.get(change.memberId) ?? []), change]);
  for (const [memberId, list] of byMember) {
    const member = await findMember(session.db, session, memberId);
    if (!member) { outcome.notes.push(`لم أجد ${list[0].memberName} في الفريق، فتجاوزت بياناتها`); continue; }
    try {
      const { results, undo } = await writeProfileFields(session, member, list.map(change => ({ fieldId: change.fieldId, fieldLabel: change.fieldLabel, value: change.after })));
      outcome.undo.push(...undo);
      for (const result of results) {
        if (result.error) { outcome.notes.push(`${shortName(member.name)} — ${result.fieldLabel}: ${result.error}`); continue; }
        outcome.rows.push([member.name, result.fieldLabel, result.before || "—", result.after || "(فارغ)"]);
        outcome.memberIds.push(member.id);
        outcome.values += 1;
        outcome.members.set(member.id, member.name);
      }
    } catch (error) {
      outcome.notes.push(`تعذّر تحديث بيانات ${shortName(member.name)}: ${failure(error)}`);
    }
  }
}

async function createMembers(session: Session, members: NewMemberSuggestion[], outcome: Outcome) {
  for (const suggestion of members) {
    try {
      const member = await createTeamMember(session, { name: suggestion.name, email: suggestion.email, title: suggestion.title, phone: suggestion.phone, clusterLabel: suggestion.clusterLabel });
      // Her other columns fill her new file; undoing removes the whole account, so these need no undo steps of their own.
      if (suggestion.fields?.length) await writeProfileFields(session, member, suggestion.fields);
      // The undo removes her only while her account is exactly as created here.
      outcome.undo.push({ kind: "member", memberId: member.id, name: member.name, ...await createdMemberMark(session.db, member) });
      outcome.rows.push([member.name, "عضوة جديدة", "—", member.email]);
      outcome.memberIds.push(member.id);
      outcome.created += 1;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "";
      outcome.notes.push(code === "ACCOUNT_EXISTS" ? `يوجد حساب بالبريد ${suggestion.email} من قبل` : `لم أستطع إنشاء حساب ${suggestion.name || suggestion.email}`);
      if (code !== "ACCOUNT_EXISTS") failure(error);
    }
  }
}

async function applySchools(session: Session, upserts: SchoolUpsert[], outcome: Outcome) {
  for (const upsert of upserts) {
    const member = await findMember(session.db, session, upsert.memberId);
    if (!member) { outcome.notes.push(`لم أجد ${upsert.memberName} في الفريق`); continue; }
    try {
      const { undo, notes } = await upsertSchools(session, member, upsert.schools);
      outcome.undo.push(...undo);
      outcome.notes.push(...notes);
      for (const school of upsert.schools) {
        outcome.rows.push([member.name, `مدرسة: ${school.name ?? ""}`, "—", describeSchool(school)]);
        outcome.memberIds.push(member.id);
        outcome.schools += 1;
        outcome.members.set(member.id, member.name);
      }
    } catch (error) {
      outcome.notes.push(`تعذّر حفظ مدارس ${shortName(member.name)}: ${failure(error)}`);
    }
  }
}

async function applyAssignments(session: Session, assignments: DocumentAssignment[], outcome: Outcome) {
  for (const assignment of assignments) {
    const member = await findMember(session.db, session, assignment.memberId);
    const filed = member ? await fileDocument(session, assignment.documentId, member.id).catch(error => { failure(error); return null; }) : null;
    if (!member || !filed) { outcome.notes.push(`تعذّر ربط الملف ${assignment.documentName}`); continue; }
    outcome.undo.push({ kind: "file", documentId: filed.before.id, documentName: filed.before.name, ownerId: filed.before.ownerId });
    outcome.rows.push([member.name, "ملف جديد في ملفها", "—", filed.before.name]);
    outcome.memberIds.push(member.id);
    outcome.files += 1;
    outcome.members.set(member.id, member.name);
  }
}

const NEW_ACCOUNT = { one: "حساباً جديداً", two: "حسابان جديدان", twoGen: "حسابين جديدين", few: "حسابات جديدة", many: "حساباً جديداً" };

/** "رجّعت «رقم الجوال» لمنيرة الرويلي: 0509998877" for one value; a short tally otherwise. */
function undoText(outcome: Outcome) {
  const notes = outcome.notes.length ? `\n\n${outcome.notes.map(note => `- ${note}`).join("\n")}` : "";
  const schools = outcome.schoolMembers.size;
  if (outcome.values === 1 && !outcome.created && !schools && !outcome.files) {
    const [name, label, value] = outcome.rows[0];
    if (value === REMOVED_FIELD) return `تم التراجع ✅ أزلت حقل «${label}» من ملف ${shortName(name)}.${notes}`;
    return `تم التراجع ✅ رجّعت «${label}» لـ ${shortName(name)} ${value ? `كما كان: ${value}` : "فارغاً كما كان"}.${notes}`;
  }
  const parts = [
    outcome.values ? `أعدت ${countAcc(outcome.values, NOUNS.value)} كما كانت` : "",
    schools ? `رجّعت مدارس ${countGen(schools, NOUNS.member)} كما كانت` : "",
    outcome.files ? `أخرجت ${countAcc(outcome.files, NOUNS.file)} من ملف المشرفة` : "",
    outcome.created ? `حذفت ${countAcc(outcome.created, NEW_ACCOUNT)}` : "",
  ].filter(Boolean);
  if (!parts.length && outcome.notes.length) return `لم أتراجع عن هذا التغيير.${notes}`;
  return `تم التراجع ✅ ${parts.join("، و") || "أعدت البيانات كما كانت"}.${notes}`;
}

/** "حدّثت ٥ قيم وحفظت ملفاً واحداً في ملفات ٣ مشرفات، وأنشأت حسابين جديدين …" */
function outcomeText(outcome: Outcome) {
  const parts: string[] = [];
  if (outcome.values) parts.push(`حدّثت ${countAcc(outcome.values, NOUNS.value)}`);
  if (outcome.schools) parts.push(`سجّلت بيانات ${countGen(outcome.schools, NOUNS.school)}`);
  if (outcome.files) parts.push(`حفظت ${countAcc(outcome.files, NOUNS.file)}`);
  const names = [...outcome.members.values()];
  const where = names.length === 1 ? ` في ملف ${shortName(names[0])}` : names.length ? ` في ملفات ${countGen(names.length, NOUNS.member)}` : "";
  let text = parts.length ? `${parts.join("، و")}${where}` : "";
  if (outcome.created) text += `${text ? "، و" : ""}أنشأت ${countAcc(outcome.created, NEW_ACCOUNT)} — تدخل كل عضوة ببريدها وتختار كلمة المرور أول مرة`;
  return text;
}

/** Executes the payload, creates the matching undo proposal, and describes what happened. */
export async function executePayload(session: Session, payload: ProposalPayload, options: { offerUndo?: boolean } = {}): Promise<AgentReply> {
  const outcome = emptyOutcome();
  if (payload.undo) {
    await runUndo(session, payload.undo, outcome);
    return { text: undoText(outcome), blocks: [] };
  }
  if (payload.assignments?.length) await applyAssignments(session, payload.assignments, outcome);
  if (payload.newMembers?.length) await createMembers(session, payload.newMembers, outcome);
  if (payload.changes?.length) await applyProfileChanges(session, payload.changes, outcome);
  if (payload.schools?.length) await applySchools(session, payload.schools, outcome);

  const summary = outcomeText(outcome);
  const blocks: ChatBlock[] = [];
  if (outcome.rows.length) {
    blocks.push({ type: "table", title: "ما تم تغييره", columns: ["المشرفة", "البند", "قبل", "بعد"], rows: outcome.rows.slice(0, 80), memberIds: outcome.memberIds.slice(0, 80) });
  }
  if (options.offerUndo !== false && outcome.undo.length) {
    const undo = await createProposal(session.db, {
      userId: session.head.id, districtId: session.head.districtId, conversationId: session.conversationId, kind: "undo",
      payload: { title: "تراجع", summary: "إرجاع البيانات كما كانت", undo: { steps: outcome.undo } } satisfies ProposalPayload,
    });
    blocks.push({ type: "applied", text: summary || "تم التنفيذ", undoProposalId: undo.id });
  }
  const notes = outcome.notes.length ? `\n\nملاحظات:\n${outcome.notes.map(note => `- ${note}`).join("\n")}` : "";
  const text = summary ? `تم ✅ ${summary}.${notes}` : `لم يتغير شيء${notes ? `.${notes}` : " — البيانات كانت محدّثة أصلاً."}`;
  return { text, blocks };
}

/** An undo can be applied for this long after the change it reverses; later, the data may have moved on. */
export const UNDO_WINDOW_HOURS = 24;
export const UNDO_EXPIRED_MESSAGE = "انتهت مهلة التراجع: يمكن التراجع خلال ٢٤ ساعة من التنفيذ فقط. عدّلي البيانات من ملف المشرفة إن احتجتِ.";

export const undoExpired = (proposal: Pick<Proposal, "kind" | "createdAt">, now = Date.now()) =>
  proposal.kind === "undo" && now - Date.parse(proposal.createdAt) > UNDO_WINDOW_HOURS * 3_600_000;

export async function executeProposal(session: Session, proposal: Proposal): Promise<AgentReply> {
  if (undoExpired(proposal)) throw new ApiError(410, "UNDO_EXPIRED", UNDO_EXPIRED_MESSAGE);
  return executePayload({ ...session, conversationId: proposal.conversationId ?? session.conversationId }, (proposal.payload ?? {}) as ProposalPayload);
}
