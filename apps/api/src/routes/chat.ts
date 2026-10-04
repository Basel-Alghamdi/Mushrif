// The head's chat with the agent (decision 8). Payloads follow packages/schemas/src/contracts.ts exactly.
import type { Hono } from "hono";
import type { ChatAttachment, ChatSendResult, DocumentInfo, ProposalResolveResult } from "@rasd/schemas";
import { UNDO_EXPIRED_MESSAGE, agentStatus, applyProposal, respond, undoExpired, type AgentReply } from "../agent/index.js";
import { auditContext } from "../audit.js";
import { requireHead, type AppEnv } from "../auth.js";
import {
  NEW_CONVERSATION_TITLE, addMessage, claimProposal, createConversation, deleteConversation, findMessageWithProposal, getConversation,
  getProposal, listConversations, listMessages, releaseProposal, renameConversation, resolveProposal, titleFrom, updateMessageBlocks,
} from "../chat-store.js";
import { sql } from "../db.js";
import { getDocument, linkDocumentsToConversation, saveDocument, type StoredDocument } from "../documents.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { isUuid, readBody } from "../parse.js";
import { readUploads, uploadLimit } from "./documents.js";

const chatAttachment = (document: Pick<DocumentInfo, "id" | "name" | "kind" | "size">): ChatAttachment => ({ id: document.id, name: document.name, kind: document.kind, size: document.size });
const optionalBody = async (c: { req: { json: () => Promise<unknown> } }) => {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
};

/** Rewrites the original message's proposal card (and any undo offer pointing at it) after a decision. */
async function markProposalBlocks(proposalId: string, status: "applied" | "rejected" | "expired", resultText: string) {
  const message = await findMessageWithProposal(sql, proposalId);
  if (!message) return;
  const note = { applied: "تم التراجع", rejected: "أُبقي التغيير", expired: "انتهت مهلة التراجع" }[status];
  await updateMessageBlocks(sql, message.id, message.blocks.map(block => {
    if (block.type === "proposal" && block.proposalId === proposalId) return { ...block, status: status === "expired" ? "rejected" : status, resultText };
    if (block.type === "applied" && block.undoProposalId === proposalId) return { type: "applied", text: `${block.text} — ${note}` };
    return block;
  }));
}

export function chatRoutes(app: Hono<AppEnv>) {
  app.get("/chat/status", c => {
    requireHead(c);
    return c.json(ok(agentStatus()));
  });

  app.get("/chat/conversations", async c => c.json(ok(await listConversations(sql, requireHead(c).id))));

  app.post("/chat/conversations", async c => {
    const head = requireHead(c);
    const body = await optionalBody(c);
    return c.json(ok(await createConversation(sql, head.id, typeof body.title === "string" ? body.title : undefined)), 201);
  });

  app.patch("/chat/conversations/:id", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    if (typeof body.title !== "string") throw invalid({ title: "اكتبي اسم المحادثة" });
    const conversation = await renameConversation(sql, head.id, c.req.param("id"), body.title);
    if (!conversation) throw notFound("المحادثة غير موجودة");
    return c.json(ok(conversation));
  });

  app.delete("/chat/conversations/:id", async c => {
    const head = requireHead(c);
    if (!(await deleteConversation(sql, head.id, c.req.param("id")))) throw notFound("المحادثة غير موجودة");
    return c.json(ok({ deleted: true }));
  });

  app.get("/chat/conversations/:id/messages", async c => {
    const head = requireHead(c);
    const conversation = await getConversation(sql, head.id, c.req.param("id"));
    if (!conversation) throw notFound("المحادثة غير موجودة");
    return c.json(ok(await listMessages(sql, conversation.id)));
  });

  // Files are uploaded first (stored and read), then sent with a message by id.
  app.post("/chat/attachments", uploadLimit, async c => {
    const head = requireHead(c);
    const saved: ChatAttachment[] = [];
    for (const file of await readUploads(c)) {
      const document = await saveDocument(sql, { districtId: head.districtId, clusterId: null, uploadedBy: head.id, ownerType: "chat", ...file }, auditContext(c));
      saved.push(chatAttachment(document));
    }
    return c.json(ok(saved), 201);
  });

  app.post("/chat/messages", async c => {
    const head = requireHead(c);
    const body = await readBody(c);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 8000) : "";
    const ids = Array.isArray(body.attachmentIds) ? [...new Set(body.attachmentIds.filter(isUuid))] : [];
    const attachments = (await Promise.all(ids.map(id => getDocument(sql, id))))
      .filter((document): document is StoredDocument => Boolean(document && document.districtId === head.districtId && document.uploadedBy === head.id));
    if (!text && !attachments.length) throw invalid({ text: "اكتبي سؤالك أو أرفقي ملفاً" });

    const requested = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
    let conversation = requested ? await getConversation(sql, head.id, requested) : null;
    if (requested && !conversation) throw notFound("المحادثة غير موجودة");
    const history = conversation ? await listMessages(sql, conversation.id) : [];
    const title = titleFrom(text, attachments.map(document => document.name));
    if (!conversation) conversation = await createConversation(sql, head.id, title);
    else if (!history.length && conversation.title === NEW_CONVERSATION_TITLE) await renameConversation(sql, head.id, conversation.id, title);
    await linkDocumentsToConversation(sql, attachments.map(document => document.id), conversation.id);

    const userMessage = await addMessage(sql, conversation.id, { role: "user", text, attachments: attachments.map(chatAttachment) });
    let reply: AgentReply;
    try {
      reply = await respond({ head, conversationId: conversation.id, history, attachments, audit: auditContext(c, "agent") }, text);
    } catch (error) {
      console.error("agent failed", error);
      reply = { text: "عذراً، واجهت مشكلة أثناء تجهيز الرد. أعيدي المحاولة أو صيغي السؤال بطريقة أخرى.", blocks: [] };
    }
    const assistantMessage = await addMessage(sql, conversation.id, { role: "assistant", text: reply.text, blocks: reply.blocks });
    const result: ChatSendResult = { conversation: (await getConversation(sql, head.id, conversation.id))!, userMessage, assistantMessage };
    return c.json(ok(result), 201);
  });

  app.post("/chat/proposals/:id/:action{apply|reject}", async c => {
    const head = requireHead(c);
    const proposal = await getProposal(sql, c.req.param("id"));
    if (!proposal || proposal.userId !== head.id || !proposal.conversationId) throw notFound("الاقتراح غير موجود");
    if (proposal.status !== "pending") {
      throw new ApiError(409, "ALREADY_RESOLVED", proposal.status === "applied" ? "تم تنفيذ هذا الاقتراح مسبقاً" : "تم إلغاء هذا الاقتراح");
    }
    // An old undo would put back values that have moved on since (or remove a member who has started working): it expires.
    if (c.req.param("action") === "apply" && undoExpired(proposal)) {
      if (await claimProposal(sql, proposal.id)) {
        await resolveProposal(sql, proposal.id, "rejected", UNDO_EXPIRED_MESSAGE);
        await markProposalBlocks(proposal.id, "expired", UNDO_EXPIRED_MESSAGE);
      }
      throw new ApiError(410, "UNDO_EXPIRED", UNDO_EXPIRED_MESSAGE);
    }
    if (!(await claimProposal(sql, proposal.id))) throw new ApiError(409, "ALREADY_RESOLVED", "يجري تنفيذ هذا الاقتراح الآن");
    const conversationId = proposal.conversationId;

    if (c.req.param("action") === "reject") {
      await resolveProposal(sql, proposal.id, "rejected");
      await markProposalBlocks(proposal.id, "rejected", "أُلغي — لم يتم تغيير أي بيانات");
      const assistantMessage = await addMessage(sql, conversationId, { role: "assistant", text: "تمام، ألغيت التغييرات ولم أعدّل أي بيانات." });
      const result: ProposalResolveResult = { proposalId: proposal.id, status: "rejected", assistantMessage };
      return c.json(ok(result));
    }

    let reply: AgentReply;
    try {
      reply = await applyProposal(head, proposal, auditContext(c, "agent"));
    } catch (error) {
      await releaseProposal(sql, proposal.id);
      throw error;
    }
    await resolveProposal(sql, proposal.id, "applied", reply.text);
    await markProposalBlocks(proposal.id, "applied", reply.text);
    const assistantMessage = await addMessage(sql, conversationId, { role: "assistant", text: reply.text, blocks: reply.blocks });
    const result: ProposalResolveResult = { proposalId: proposal.id, status: "applied", assistantMessage };
    return c.json(ok(result));
  });
}
