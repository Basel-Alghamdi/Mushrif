// The head's agent: answers from the team's data, edits it on request (with undo), and imports files into members' files.
// Uses Claude when ANTHROPIC_API_KEY is set, otherwise (and whenever Claude fails) the built-in Arabic engine.
import type { ChatMessage, ChatStatus } from "@rasd/schemas";
import type { AuditContext } from "../audit.js";
import type { Actor } from "../auth.js";
import type { Proposal } from "../chat-store.js";
import { sql } from "../db.js";
import { getDocument, type StoredDocument } from "../documents.js";
import { claudeEnabled, claudeModel, claudeRespond, fallbackNote } from "./claude.js";
import { openaiEnabled, openaiModel, openaiRespond, openaiFallbackNote } from "./openai.js";
import { importAttachments, OWNER_PROMPT, pendingOwnerQuestion } from "./importer.js";
import { localRespond } from "./local-engine.js";
import type { Session } from "./model.js";
import { findMentions, resolvedIds } from "./names.js";
import { tokenize } from "./normalize.js";
import { executeProposal, type AgentReply } from "./proposals.js";
import { choices } from "./render.js";
import { auditFileReads, loadTeam, type TeamSnapshot } from "./snapshot.js";

export type { AgentReply } from "./proposals.js";
export { UNDO_EXPIRED_MESSAGE, undoExpired } from "./proposals.js";

export type AgentContext = {
  /** خلود: role "head"; every read and write is limited to her district. */
  head: Actor;
  /** The conversation this reply belongs to (proposals are created with it). */
  conversationId: string;
  /** Earlier messages in this conversation, oldest first, without the new one. */
  history: ChatMessage[];
  /** Files attached to the new message: already stored, with extracted `text` and `tables`. */
  attachments: StoredDocument[];
  /** Actor = the head, source "agent": every write the agent makes is audited with it. */
  audit: AuditContext;
};

const sessionOf = (context: AgentContext): Session => ({ db: sql, head: context.head, audit: context.audit, conversationId: context.conversationId });

/** Built-in engine: file imports, the answer to "هذا الملف يخص من؟", then ordinary questions. */
async function localReply(context: AgentContext, text: string): Promise<AgentReply> {
  const session = sessionOf(context);
  const team = await loadTeam(sql, context.head);
  const reply = await localAnswer(context, session, team, text);
  await auditFileReads(session, [team]);
  return reply;
}

async function localAnswer(context: AgentContext, session: Session, team: TeamSnapshot, text: string): Promise<AgentReply> {
  if (context.attachments.length) return { ...await importAttachments({ session, team, text, documents: context.attachments }), intent: "import" };

  // Khulood is answering "هذا الملف يخص من؟" about a file that is still unfiled.
  const pending = pendingOwnerQuestion(context.history);
  const pendingDocument = pending ? await getDocument(sql, pending.id) : null;
  const document = pendingDocument && !pendingDocument.ownerId && pendingDocument.districtId === context.head.districtId ? pendingDocument : null;
  if (document) {
    const mentions = findMentions(tokenize(text), team.index);
    const ids = resolvedIds(mentions);
    if (ids.length === 1) return { ...await importAttachments({ session, team, text, documents: [document], forcedMemberId: ids[0] }), intent: "import" };
    const ambiguous = mentions.find(mention => mention.ambiguous);
    if (ambiguous) {
      const options = ambiguous.candidates.map(id => team.index.byId.get(id)!).map(member => ({ label: member.name, message: `الملف «${document.name}» يخص ${member.name}` }));
      return { text: "أي واحدة منهن؟", blocks: [choices(options, `${OWNER_PROMPT} «${document.name}»`)], intent: "import" };
    }
  }
  return localRespond({ session, team, history: context.history, text });
}

/** Produces the assistant's reply to Khulood's new message. Must never throw for ordinary input. */
export async function respond(context: AgentContext, text: string): Promise<AgentReply> {
  if (openaiEnabled()) {
    try {
      return await openaiRespond(context, text);
    } catch (error) {
      console.error("OpenAI brain failed, using the local engine:", error instanceof Error ? error.name : "unknown error");
      const local = await localReply(context, text);
      return { ...local, text: `${local.text}\n\n${openaiFallbackNote(error)}` };
    }
  }
  if (claudeEnabled()) {
    try {
      return await claudeRespond(context, text);
    } catch (error) {
      console.error("claude brain failed, using the local engine:", error instanceof Error ? `${error.name}: ${error.message}` : error);
      const local = await localReply(context, text);
      return { ...local, text: `${local.text}\n\n${fallbackNote(error)}` };
    }
  }
  return localReply(context, text);
}

/** Executes an approved proposal and describes the outcome (audited with `audit`: the head, source "agent"). */
export async function applyProposal(head: Actor, proposal: Proposal, audit: AuditContext): Promise<AgentReply> {
  return executeProposal({ db: sql, head, audit, conversationId: proposal.conversationId }, proposal);
}

export function agentStatus(): ChatStatus {
  if (openaiEnabled()) return { mode: "openai", model: openaiModel() };
  return claudeEnabled() ? { mode: "claude", model: claudeModel() } : { mode: "local", model: null };
}
