"use client";

import type {
  ChatAttachment, ChatBlock, ChatMessage, ChatSendResult, Conversation, ProposalResolveResult, ProposalStatus,
} from "@rasd/schemas";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, redirectIfSignedOut } from "../api";

/** Key used for the in-flight send of a conversation that does not exist yet. */
export const NEW_CHAT = "__new__";

export type PendingSend = { text: string; attachments: ChatAttachment[] };

type ChatContextValue = {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  messages: Record<string, ChatMessage[] | undefined>;
  pending: Record<string, PendingSend | undefined>;
  loadMessages: (conversationId: string) => Promise<void>;
  send: (conversationId: string | null, text: string, attachments: ChatAttachment[]) => Promise<ChatSendResult>;
  rename: (conversationId: string, title: string) => Promise<void>;
  remove: (conversationId: string) => Promise<void>;
  resolveProposal: (conversationId: string, messageId: string, proposalId: string, action: "apply" | "reject") => Promise<void>;
  undoApplied: (conversationId: string, messageId: string, undoProposalId: string) => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside <ChatProvider>");
  return value;
}

const byUpdatedDesc = (a: Conversation, b: Conversation) => b.updatedAt.localeCompare(a.updatedAt);

function withoutKey<T>(record: Record<string, T | undefined>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function markProposal(blocks: ChatBlock[], proposalId: string, status: ProposalStatus, resultText: string): ChatBlock[] {
  return blocks.map(block => block.type === "proposal" && block.proposalId === proposalId ? { ...block, status, resultText } : block);
}

function markUndone(blocks: ChatBlock[], undoProposalId: string): ChatBlock[] {
  return blocks.map(block => block.type === "applied" && block.undoProposalId === undoProposalId
    ? { type: "applied", text: `${block.text} — تم التراجع` }
    : block);
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [messages, setMessages] = useState<Record<string, ChatMessage[] | undefined>>({});
  const [pending, setPending] = useState<Record<string, PendingSend | undefined>>({});
  // Bumped on every local write to a conversation, so a slower background fetch never overwrites newer messages.
  const revisions = useRef<Record<string, number>>({});
  const bump = (id: string) => { revisions.current[id] = (revisions.current[id] ?? 0) + 1; };

  useEffect(() => {
    api.get<Conversation[]>("/chat/conversations")
      .then(list => setConversations(list.sort(byUpdatedDesc)))
      .catch(error => { redirectIfSignedOut(error); /* otherwise the sidebar shows an empty list; the chat still works */ })
      .finally(() => setConversationsLoaded(true));
  }, []);

  const upsertConversation = useCallback((conversation: Conversation) => {
    setConversations(list => [conversation, ...list.filter(item => item.id !== conversation.id)].sort(byUpdatedDesc));
  }, []);

  const patchMessages = useCallback((conversationId: string, update: (list: ChatMessage[]) => ChatMessage[]) => {
    bump(conversationId);
    setMessages(cache => ({ ...cache, [conversationId]: update(cache[conversationId] ?? []) }));
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const revision = revisions.current[conversationId] ?? 0;
    const list = await api.get<ChatMessage[]>(`/chat/conversations/${conversationId}/messages`);
    if ((revisions.current[conversationId] ?? 0) !== revision) return;
    setMessages(cache => ({ ...cache, [conversationId]: list }));
  }, []);

  const send = useCallback(async (conversationId: string | null, text: string, attachments: ChatAttachment[]) => {
    const key = conversationId ?? NEW_CHAT;
    setPending(state => ({ ...state, [key]: { text, attachments } }));
    try {
      const result = await api.post<ChatSendResult>("/chat/messages", {
        conversationId, text, attachmentIds: attachments.map(item => item.id),
      });
      patchMessages(result.conversation.id, list => [...list, result.userMessage, result.assistantMessage]);
      upsertConversation(result.conversation);
      return result;
    } finally {
      setPending(state => withoutKey(state, key));
    }
  }, [patchMessages, upsertConversation]);

  const rename = useCallback(async (conversationId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setConversations(list => list.map(item => item.id === conversationId ? { ...item, title: clean } : item));
    const updated = await api.patch<Conversation>(`/chat/conversations/${conversationId}`, { title: clean });
    setConversations(list => list.map(item => item.id === conversationId ? { ...item, title: updated.title } : item));
  }, []);

  const remove = useCallback(async (conversationId: string) => {
    await api.del(`/chat/conversations/${conversationId}`);
    setConversations(list => list.filter(item => item.id !== conversationId));
    setMessages(cache => withoutKey(cache, conversationId));
  }, []);

  const resolveProposal = useCallback(async (conversationId: string, messageId: string, proposalId: string, action: "apply" | "reject") => {
    const result = await api.post<ProposalResolveResult>(`/chat/proposals/${proposalId}/${action}`);
    const resultText = result.status === "applied" ? result.assistantMessage?.text ?? "تم التنفيذ" : "أُلغي — لم يتم تغيير أي بيانات";
    patchMessages(conversationId, list => {
      const updated = list.map(message => message.id === messageId ? { ...message, blocks: markProposal(message.blocks, proposalId, result.status, resultText) } : message);
      return result.assistantMessage ? [...updated, result.assistantMessage] : updated;
    });
  }, [patchMessages]);

  const undoApplied = useCallback(async (conversationId: string, messageId: string, undoProposalId: string) => {
    let result: ProposalResolveResult;
    try {
      result = await api.post<ProposalResolveResult>(`/chat/proposals/${undoProposalId}/apply`);
    } catch (error) {
      // Expired (410) or already decided (409): the server has rewritten the card — show its current state.
      if (error instanceof ApiError && (error.status === 410 || error.status === 409)) await loadMessages(conversationId).catch(() => undefined);
      throw error;
    }
    patchMessages(conversationId, list => {
      const updated = list.map(message => message.id === messageId ? { ...message, blocks: markUndone(message.blocks, undoProposalId) } : message);
      return result.assistantMessage ? [...updated, result.assistantMessage] : updated;
    });
  }, [patchMessages, loadMessages]);

  const value = useMemo<ChatContextValue>(() => ({
    conversations, conversationsLoaded, messages, pending, loadMessages, send, rename, remove, resolveProposal, undoApplied,
  }), [conversations, conversationsLoaded, messages, pending, loadMessages, send, rename, remove, resolveProposal, undoApplied]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
