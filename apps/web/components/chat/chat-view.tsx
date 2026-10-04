"use client";

import type { ChatAttachment, ChatMessage } from "@rasd/schemas";
import { ArrowDown, CircleAlert, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DragEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../lib/api";
import { NEW_CHAT, useChat } from "../../lib/chat/chat-context";
import { useAttachments } from "../../lib/chat/use-attachments";
import { useHead } from "../district/session";
import { Composer } from "./composer";
import { ChatEmptyState } from "./empty-state";
import { MessageItem, TypingIndicator, UserBubble } from "./message";

type Props = { conversationId: string | null; initialText?: string; sendInitial?: boolean };

const NO_MESSAGES: ChatMessage[] = [];
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
const approvedBefore = (previous?: ChatMessage) =>
  Boolean(previous?.role === "assistant" && previous.blocks.some(block => block.type === "proposal" && block.status === "applied"));

export function ChatView({ conversationId, initialText = "", sendInitial = false }: Props) {
  const router = useRouter();
  const head = useHead();
  const chat = useChat();
  const uploads = useAttachments();

  // A new chat keeps showing its messages under the new id until the URL switches to /district/c/<id>.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const activeId = conversationId ?? createdId;
  const cached = activeId ? chat.messages[activeId] : NO_MESSAGES;
  const messages = cached ?? NO_MESSAGES;
  const pending = chat.pending[activeId ?? NEW_CHAT];
  const busy = Boolean(pending);

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const dragDepth = useRef(0);
  const mounted = useRef(true);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Messages already on screen when this view opened don't animate (so the URL swap after a new chat doesn't flash).
  const initialIds = useRef<Set<string> | null>(null);
  if (initialIds.current === null && (!conversationId || cached !== undefined)) initialIds.current = new Set(messages.map(message => message.id));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Existing conversation: show the cache at once and refresh it in the background.
  const { loadMessages } = chat;
  useEffect(() => {
    if (!conversationId) return;
    loadMessages(conversationId).catch((error: ApiRequestError) => setLoadError({ status: error.status, message: error.message }));
  }, [conversationId, loadMessages]);

  const send = useCallback(async (text: string, attachments: ChatAttachment[]) => {
    const clean = text.trim();
    if (!clean && !attachments.length) return;
    setSendError("");
    stickToBottom.current = true;
    try {
      const result = await chat.send(activeId, clean, attachments);
      if (!conversationId && mounted.current) {
        setCreatedId(result.conversation.id);
        router.replace(`/district/c/${result.conversation.id}`, { scroll: false });
      }
    } catch (error) {
      if (!mounted.current) return;
      if (!draftRef.current.trim()) setDraft(clean);
      if (attachments.length) uploads.restore(attachments);
      setSendError((error as Error).message);
    }
  }, [chat, activeId, conversationId, router, uploads]);

  const submitComposer = () => {
    if (busy || uploads.uploading) return;
    const text = draft;
    const attachments = uploads.ready;
    if (!text.trim() && !attachments.length) return;
    setDraft("");
    uploads.clear();
    void send(text, attachments);
  };

  // Quick replies and suggestion cards send straight away (the composer keeps whatever she was typing).
  const sendRef = useRef(send);
  sendRef.current = send;
  const sendText = useCallback((text: string) => { void sendRef.current(text, []); }, []);

  // ?q= from another page: prefill (or send) once.
  const initialHandled = useRef(false);
  useEffect(() => {
    if (initialHandled.current || !initialText) return;
    initialHandled.current = true;
    if (sendInitial) sendText(initialText);
    else { setDraft(initialText); textareaRef.current?.focus(); }
  }, [initialText, sendInitial, sendText]);

  // Auto-scroll on new content unless she scrolled up to read.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [messages, pending, sendError]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    stickToBottom.current = near;
    setAtBottom(near);
  };

  const scrollToBottom = () => {
    stickToBottom.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    uploads.add(Array.from(event.dataTransfer.files));
    textareaRef.current?.focus();
  };

  const loading = Boolean(conversationId) && cached === undefined && !loadError;
  const notFound = loadError?.status === 404;
  const showEmpty = !loading && !loadError && !messages.length && !pending;
  const canSend = !busy && !uploads.uploading && Boolean(draft.trim() || uploads.ready.length);

  // Toasts sit just above the composer, which grows with attachments and long drafts (see district.css).
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--chat-dock-h", `${Math.round(dock.getBoundingClientRect().height)}px`));
    observer.observe(dock);
    return () => { observer.disconnect(); root.style.removeProperty("--chat-dock-h"); };
  }, [notFound]);

  return (
    <div className="chat" onDragEnter={onDragEnter} onDragOver={event => { if (hasFiles(event)) event.preventDefault(); }} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className={`chat-column ${showEmpty ? "is-empty" : ""}`}>
          {loading && <ChatSkeleton />}
          {loadError && (
            <div className="empty chat-load-error">
              <CircleAlert />
              <b>{notFound ? "هذه المحادثة غير موجودة" : "تعذّر تحميل المحادثة"}</b>
              <span>{notFound ? "ربما حُذفت. ابدئي محادثة جديدة." : loadError.message}</span>
              {notFound
                ? <Link href="/district" className="btn btn-primary">محادثة جديدة</Link>
                : <button className="btn btn-primary" onClick={() => { setLoadError(null); loadMessages(conversationId!).catch((error: ApiRequestError) => setLoadError({ status: error.status, message: error.message })); }}><RefreshCw /> إعادة المحاولة</button>}
            </div>
          )}
          {showEmpty && <ChatEmptyState name={head.name} onPrompt={sendText} disabled={busy} />}
          {messages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              onSend={sendText}
              busy={busy}
              fresh={message.role === "assistant" && !initialIds.current?.has(message.id)}
              followsApproval={approvedBefore(messages[index - 1])}
            />
          ))}
          {pending && <UserBubble text={pending.text} attachments={pending.attachments} faded />}
          {pending && <TypingIndicator />}
          {sendError && (
            <div className="chat-error" role="alert">
              <CircleAlert />
              <span>لم تُرسل الرسالة: {sendError}</span>
              <button className="btn btn-secondary btn-sm" onClick={submitComposer} disabled={!canSend}><RefreshCw /> إعادة المحاولة</button>
            </div>
          )}
        </div>
      </div>

      {!notFound && (
        <div className="chat-dock" ref={dockRef}>
          {!atBottom && messages.length > 0 && (
            <button className="chat-to-bottom" onClick={scrollToBottom}><ArrowDown /> إلى الأسفل</button>
          )}
          <Composer
            value={draft}
            onChange={value => { setDraft(value); if (sendError) setSendError(""); }}
            onSubmit={submitComposer}
            onFiles={files => uploads.add(files)}
            onRemoveFile={uploads.remove}
            uploads={uploads.items}
            canSend={canSend}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
          />
          <p className="chat-disclaimer">المساعد يقرأ بيانات المشرفات وملفاتهن — راجعي أي تعبئة قبل اعتمادها.</p>
        </div>
      )}

      {dragging && (
        <div className="chat-drop" aria-hidden>
          <div><Upload /><b>أفلتي الملفات هنا</b><span>Excel أو Word أو PDF أو صور — أقرأها وأعبّي البيانات</span></div>
        </div>
      )}
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="chat-skeleton" aria-label="جارٍ التحميل">
      <i className="skeleton is-user" />
      <i className="skeleton" />
      <i className="skeleton is-short" />
    </div>
  );
}
