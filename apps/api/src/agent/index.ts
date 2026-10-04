import type { ChatMessage, ChatStatus } from "@rasd/schemas";
import type { Account } from "../accounts.js";
import type { Proposal } from "../chat-store.js";
import { getDocument, type StoredDocument } from "../documents.js";
import { claudeEnabled, claudeModel, claudeRespond, fallbackNote } from "./claude.js";
import { teamSnapshot } from "./data.js";
import { importAttachments, OWNER_PROMPT, pendingOwnerQuestion } from "./importer.js";
import { localRespond } from "./local-engine.js";
import { findMentions, resolvedIds } from "./names.js";
import { tokenize } from "./normalize.js";
import { executeProposal, type AgentReply } from "./proposals.js";
import { choices } from "./render.js";

export type { AgentReply } from "./proposals.js";

export type AgentContext = {
  head: Account; // خلود
  conversationId: string;
  history: ChatMessage[]; // earlier messages in this conversation (oldest first), excluding the new one
  attachments: StoredDocument[]; // files attached to the new message (already stored + text extracted)
};

/** Built-in engine: file imports, the answer to "هذا الملف يخص من؟", then ordinary questions. */
function localReply(context: AgentContext, text: string): AgentReply {
  const team = teamSnapshot(context.head.id);
  const base = { head: context.head, team, text, conversationId: context.conversationId };
  if (context.attachments.length) return { ...importAttachments({ ...base, documents: context.attachments }), intent: "import" };

  // Khulood is answering "هذا الملف يخص من؟" about a file that is still unfiled.
  const pending = pendingOwnerQuestion(context.history);
  const pendingDocument = pending ? getDocument(pending.id) : null;
  const document = pendingDocument && !pendingDocument.ownerId ? pendingDocument : null;
  if (document) {
    const mentions = findMentions(tokenize(text), team.index);
    const ids = resolvedIds(mentions);
    if (ids.length === 1) return { ...importAttachments({ ...base, documents: [document], forcedMemberId: ids[0] }), intent: "import" };
    const ambiguous = mentions.find(mention => mention.ambiguous);
    if (ambiguous) {
      const options = ambiguous.candidates.map(id => team.index.byId.get(id)!).map(member => ({ label: member.name, message: `الملف «${document.name}» يخص ${member.name}` }));
      return { text: "أي واحدة منهن؟", blocks: [choices(options, `${OWNER_PROMPT} «${document.name}»`)], intent: "import" };
    }
  }
  return localRespond({ head: context.head, conversationId: context.conversationId, history: context.history, text });
}

/** Produces the assistant's reply to Khulood's new message. Must never throw for ordinary input. */
export async function respond(context: AgentContext, text: string): Promise<AgentReply> {
  if (claudeEnabled()) {
    try {
      return await claudeRespond(context, text);
    } catch (error) {
      console.error("claude brain failed, using the local engine:", error instanceof Error ? `${error.name}: ${error.message}` : error);
      const local = localReply(context, text);
      return { ...local, text: `${local.text}\n\n${fallbackNote(error)}` };
    }
  }
  return localReply(context, text);
}

/** Executes an approved proposal and describes the outcome. */
export async function applyProposal(head: Account, proposal: Proposal): Promise<AgentReply> {
  return executeProposal(head, proposal);
}

export function agentStatus(): ChatStatus {
  return claudeEnabled() ? { mode: "claude", model: claudeModel() } : { mode: "local", model: null };
}
