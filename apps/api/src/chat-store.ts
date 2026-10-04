// The head's conversations with the agent (decision 8): conversations + chat_messages, proposals over agent_runs.
// JSON columns are read as text: postgres.camel would otherwise rewrite keys inside blocks and payloads.
import type { ChatAttachment, ChatBlock, ChatMessage, Conversation, ProposalStatus } from "@rasd/schemas";
import type { Row, Sql } from "./db.js";
import { cleanText, isUuid } from "./parse.js";

export const NEW_CONVERSATION_TITLE = "محادثة جديدة";
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; }
};

const conversationDto = (row: Row): Conversation => ({
  id: String(row.id), title: String(row.title), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  preview: cleanText(row.preview ?? "").slice(0, 120),
});

const messageDto = (row: Row): ChatMessage => ({
  id: String(row.id), conversationId: String(row.conversationId), role: row.role as ChatMessage["role"], text: String(row.text ?? ""),
  blocks: parseJson<ChatBlock[]>(row.blocksJson, []), attachments: parseJson<ChatAttachment[]>(row.attachmentsJson, []),
  createdAt: iso(row.createdAt),
});

const MESSAGE_COLUMNS = (db: Sql) => db`id, conversation_id, role, text, blocks::text as blocks_json, attachments::text as attachments_json, created_at`;

export async function listConversations(db: Sql, userId: string) {
  const rows = await db`
    select c.*, (select m.text from chat_messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as preview
    from conversations c where c.user_id = ${userId} order by c.updated_at desc`;
  return rows.map(conversationDto);
}

export async function getConversation(db: Sql, userId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db`
    select c.*, (select m.text from chat_messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as preview
    from conversations c where c.id = ${id} and c.user_id = ${userId}`;
  return row ? conversationDto(row) : null;
}

/** A short title from the first message ("محادثة جديدة" when there is nothing to name it after). */
export function titleFrom(text: string, attachmentNames: string[] = []) {
  const clean = cleanText(text);
  if (clean) return clean.length > 48 ? `${clean.slice(0, 46).trim()}…` : clean;
  if (attachmentNames.length) return `ملف: ${attachmentNames[0]}`.slice(0, 48);
  return NEW_CONVERSATION_TITLE;
}

export async function createConversation(db: Sql, userId: string, title = NEW_CONVERSATION_TITLE) {
  const [row] = await db`insert into conversations ${db({ userId, title: cleanText(title).slice(0, 80) || NEW_CONVERSATION_TITLE })} returning *`;
  return conversationDto({ ...row, preview: "" });
}

export async function renameConversation(db: Sql, userId: string, id: string, title: string) {
  if (!isUuid(id)) return null;
  const [row] = await db`update conversations set title = ${cleanText(title).slice(0, 80) || "محادثة"} where id = ${id} and user_id = ${userId} returning id`;
  return row ? getConversation(db, userId, id) : null;
}

/** Deletes the conversation and its messages; its files stay (their conversation link is cleared). */
export async function deleteConversation(db: Sql, userId: string, id: string) {
  if (!isUuid(id)) return false;
  const rows = await db`delete from conversations where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

export async function listMessages(db: Sql, conversationId: string) {
  const rows = await db`select ${MESSAGE_COLUMNS(db)} from chat_messages where conversation_id = ${conversationId} order by created_at, id`;
  return rows.map(messageDto);
}

/** Appends a message (clock time, so a reply written in the same transaction still sorts after the question). */
export async function addMessage(db: Sql, conversationId: string, input: { role: ChatMessage["role"]; text: string; blocks?: ChatBlock[]; attachments?: ChatAttachment[] }) {
  const [row] = await db`
    insert into chat_messages (user_id, conversation_id, role, text, blocks, attachments, created_at)
    select c.user_id, c.id, ${input.role}, ${input.text}, ${db.json((input.blocks ?? []) as never)}, ${db.json((input.attachments ?? []) as never)}, clock_timestamp()
    from conversations c where c.id = ${conversationId}
    returning ${MESSAGE_COLUMNS(db)}`;
  if (!row) throw new Error(`conversation ${conversationId} not found`);
  await db`update conversations set updated_at = now() where id = ${conversationId}`;
  return messageDto(row);
}

/** Rewrites the blocks of a stored message (e.g. a proposal card switching from pending to applied). */
export async function updateMessageBlocks(db: Sql, messageId: string, blocks: ChatBlock[]) {
  await db`update chat_messages set blocks = ${db.json(blocks as never)} where id = ${messageId}`;
}

/** The message whose proposal card (or undo offer) refers to this proposal. */
export async function findMessageWithProposal(db: Sql, proposalId: string) {
  const [row] = await db`
    select ${MESSAGE_COLUMNS(db)} from chat_messages
    where blocks @> ${db.json([{ proposalId }] as never)} or blocks @> ${db.json([{ undoProposalId: proposalId }] as never)}
    order by created_at desc limit 1`;
  return row ? messageDto(row) : null;
}

// ---------- Proposals (agent_runs) ----------
export type ProposalKind = "profile_updates" | "new_members" | "school_updates" | "assign_documents" | "import" | "undo";
export const PROPOSAL_KINDS: ProposalKind[] = ["profile_updates", "new_members", "school_updates", "assign_documents", "import", "undo"];

/** A change the agent prepared; nothing happens until the head applies it. `result` is the text shown after applying. */
export type Proposal<T = unknown> = {
  id: string; userId: string; districtId: string; conversationId: string | null; kind: ProposalKind; payload: T;
  status: ProposalStatus; result: string | null; createdAt: string; resolvedAt: string | null;
};

const fromRunStatus: Record<string, ProposalStatus> = { proposed: "pending", executed: "applied", rejected: "rejected" };
const toRunStatus: Record<ProposalStatus, string> = { pending: "proposed", applied: "executed", rejected: "rejected" };

const proposalDto = (row: Row): Proposal => ({
  id: String(row.id), userId: String(row.userId), districtId: String(row.districtId), conversationId: row.conversationId ? String(row.conversationId) : null,
  kind: row.action as ProposalKind, payload: parseJson(row.payloadJson, null), status: fromRunStatus[String(row.status)] ?? "pending",
  result: (row.resultSummary as string | null) ?? null, createdAt: iso(row.proposedAt), resolvedAt: row.decidedAt ? iso(row.decidedAt) : null,
});

const PROPOSAL_COLUMNS = (db: Sql) => db`id, user_id, district_id, conversation_id, action, payload::text as payload_json, status, result_summary, proposed_at, decided_at`;

export async function createProposal<T>(db: Sql, input: { userId: string; districtId: string; conversationId: string | null; kind: ProposalKind; payload: T }) {
  const [row] = await db`
    insert into agent_runs ${db({
      districtId: input.districtId, userId: input.userId, conversationId: input.conversationId, action: input.kind,
      payload: db.json(input.payload as never),
    })}
    returning ${PROPOSAL_COLUMNS(db)}`;
  return proposalDto(row) as Proposal<T>;
}

/** A chat proposal (main's /ai/agent runs — remind, report, gaps — are not returned). */
export async function getProposal(db: Sql, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db`select ${PROPOSAL_COLUMNS(db)} from agent_runs where id = ${id} and action = any(${db.array(PROPOSAL_KINDS)}::text[])`;
  return row ? proposalDto(row) : null;
}

/**
 * Marks a pending proposal as being applied so a double click cannot apply it twice. False when someone else holds it
 * (a claim older than five minutes is considered abandoned, e.g. after a crash).
 */
export async function claimProposal(db: Sql, id: string) {
  const rows = await db`
    update agent_runs set decided_at = now()
    where id = ${id} and status = 'proposed' and (decided_at is null or decided_at < now() - interval '5 minutes') returning id`;
  return rows.length > 0;
}

/** Gives a claimed proposal back (applying it failed). */
export async function releaseProposal(db: Sql, id: string) {
  await db`update agent_runs set decided_at = null where id = ${id} and status = 'proposed'`;
}

export async function resolveProposal(db: Sql, id: string, status: ProposalStatus, result: string | null = null) {
  const [row] = await db`
    update agent_runs set status = ${toRunStatus[status]}, result_summary = ${result}, decided_at = ${status === "pending" ? null : new Date()}
    where id = ${id} returning ${PROPOSAL_COLUMNS(db)}`;
  return row ? proposalDto(row) : null;
}
