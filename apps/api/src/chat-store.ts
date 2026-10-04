import type { ChatAttachment, ChatBlock, ChatMessage, Conversation, ProposalStatus } from "@rasd/schemas";
import { cleanText, db, newId, now, parseJson } from "./db.js";

function mapConversation(row: Record<string, unknown>): Conversation {
  return { id: String(row.id), title: String(row.title), createdAt: String(row.created_at), updatedAt: String(row.updated_at), preview: cleanText(row.preview ?? "").slice(0, 120) };
}

function mapMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), role: String(row.role) as ChatMessage["role"],
    text: String(row.text ?? ""), blocks: parseJson<ChatBlock[]>(row.blocks_json, []), attachments: parseJson<ChatAttachment[]>(row.attachments_json, []),
    createdAt: String(row.created_at),
  };
}

export function listConversations(userId: string) {
  return db.prepare(`SELECT c.*, (SELECT text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview
    FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC`).all(userId).map(mapConversation);
}

export function getConversation(userId: string, id: string) {
  const row = db.prepare(`SELECT c.*, (SELECT text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview
    FROM conversations c WHERE c.id = ? AND c.user_id = ?`).get(id, userId);
  return row ? mapConversation(row) : null;
}

/** A short title from the first message ("محادثة جديدة" when there is no text). */
export function titleFrom(text: string, attachmentNames: string[] = []) {
  const clean = cleanText(text);
  if (clean) return clean.length > 48 ? `${clean.slice(0, 46).trim()}…` : clean;
  if (attachmentNames.length) return `ملف: ${attachmentNames[0]}`.slice(0, 48);
  return "محادثة جديدة";
}

export function createConversation(userId: string, title = "محادثة جديدة") {
  const id = newId();
  const at = now();
  db.prepare("INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, userId, cleanText(title) || "محادثة جديدة", at, at);
  return getConversation(userId, id)!;
}

export function renameConversation(userId: string, id: string, title: string) {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?").run(cleanText(title).slice(0, 80) || "محادثة", id, userId);
  return getConversation(userId, id);
}

export function deleteConversation(userId: string, id: string) {
  return Number(db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
}

export function listMessages(conversationId: string) {
  return db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC").all(conversationId).map(mapMessage);
}

export function addMessage(conversationId: string, input: { role: ChatMessage["role"]; text: string; blocks?: ChatBlock[]; attachments?: ChatAttachment[] }) {
  const id = newId();
  const at = now();
  db.prepare("INSERT INTO messages (id,conversation_id,role,text,blocks_json,attachments_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, conversationId, input.role, input.text, JSON.stringify(input.blocks ?? []), JSON.stringify(input.attachments ?? []), at);
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, conversationId);
  return mapMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(id)!);
}

/** Rewrites the blocks of a stored message (e.g. a proposal card switching from pending to applied). */
export function updateMessageBlocks(messageId: string, blocks: ChatBlock[]) {
  db.prepare("UPDATE messages SET blocks_json = ? WHERE id = ?").run(JSON.stringify(blocks), messageId);
}

export function findMessageWithProposal(proposalId: string) {
  const rows = db.prepare("SELECT * FROM messages WHERE blocks_json LIKE ?").all(`%${proposalId}%`);
  return rows.map(mapMessage).find(message => message.blocks.some(block => (block.type === "proposal" || block.type === "applied") && ("proposalId" in block ? block.proposalId === proposalId : block.undoProposalId === proposalId))) ?? null;
}

// ---------- Proposals ----------
export type Proposal<T = unknown> = { id: string; userId: string; conversationId: string | null; kind: string; payload: T; status: ProposalStatus; result: unknown; createdAt: string; resolvedAt: string | null };

function mapProposal(row: Record<string, unknown>): Proposal {
  return {
    id: String(row.id), userId: String(row.user_id), conversationId: row.conversation_id ? String(row.conversation_id) : null, kind: String(row.kind),
    payload: parseJson(row.payload_json, null), status: String(row.status) as ProposalStatus, result: parseJson(row.result_json, null),
    createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export function createProposal<T>(input: { userId: string; conversationId: string | null; kind: string; payload: T }) {
  const id = newId();
  db.prepare("INSERT INTO proposals (id,user_id,conversation_id,kind,payload_json,status,created_at) VALUES (?,?,?,?,?,'pending',?)")
    .run(id, input.userId, input.conversationId, input.kind, JSON.stringify(input.payload), now());
  return getProposal(id)! as Proposal<T>;
}

export function getProposal(id: string) {
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
  return row ? mapProposal(row) : null;
}

export function resolveProposal(id: string, status: ProposalStatus, result: unknown = null) {
  db.prepare("UPDATE proposals SET status = ?, result_json = ?, resolved_at = ? WHERE id = ?").run(status, JSON.stringify(result), now(), id);
  return getProposal(id);
}
