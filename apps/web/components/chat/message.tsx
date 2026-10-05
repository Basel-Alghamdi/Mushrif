"use client";

import type { ChatAttachment, ChatBlock, ChatMessage } from "@rasd/schemas";
import { Check, Copy } from "lucide-react";
import { Fragment, memo, useState } from "react";
import { downloadFile } from "../../lib/api";
import { copyText, kindLabel } from "../../lib/chat/helpers";
import { BlockView } from "./blocks";
import { type CopyBlockData, CopyRows, SendAllBar } from "./blocks/copy-block";
import { KindIcon } from "./blocks/shared";
import { Markdown } from "./markdown";

export function AssistantAvatar() {
  return <span className="chat-avatar" aria-hidden>ر</span>;
}

export function AttachmentChips({ items }: { items: ChatAttachment[] }) {
  if (!items.length) return null;
  return (
    <ul className="chat-attachments">
      {items.map(item => (
        <li key={item.id}>
          <button className="file-chip" onClick={() => void downloadFile(`/attachments/${item.id}/download`, item.name)} title={`تنزيل ${item.name}`}>
            <KindIcon kind={item.kind} />
            <span className="file-chip-name" dir="auto">{item.name}</span>
            <small>{kindLabel[item.kind]}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function UserBubble({ text, attachments, faded }: { text: string; attachments: ChatAttachment[]; faded?: boolean }) {
  return (
    <div className={`chat-row is-user ${faded ? "is-sending is-fresh" : ""}`}>
      <div className="chat-user">
        <AttachmentChips items={attachments} />
        {text && <div className="chat-bubble" dir="auto">{text}</div>}
      </div>
    </div>
  );
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button className="chat-action" onClick={copy} aria-label="نسخ الرد">
      {copied ? <><Check /> تم النسخ</> : <><Copy /> نسخ</>}
    </button>
  );
}

type MessageProps = {
  message: ChatMessage;
  onSend: (text: string) => void;
  busy: boolean;
  fresh: boolean;
  /** The message right above is the proposal she just approved, which already shows every change. */
  followsApproval: boolean;
};

/** "حدّثت قيمتين … — تم التراجع" → "حدّثت قيمتين …" */
const appliedCore = (text: string) => text.replace(/ — (تم التراجع|أُبقي التغيير)$/, "");

export const MessageItem = memo(function MessageItem({ message, onSend, busy, fresh, followsApproval }: MessageProps) {
  if (message.role === "user") return <UserBubble text={message.text} attachments={message.attachments} />;

  // Say each result once: the «تم» card replaces the sentence that repeats it, and after an approval the
  // «ما تم تغييره» table is skipped (the proposal above already lists the changes).
  const applied = message.blocks.find((block): block is Extract<ChatBlock, { type: "applied" }> => block.type === "applied");
  const text = applied
    ? message.text.split("\n\n").filter(part => !part.includes(appliedCore(applied.text))).join("\n\n").trim()
    : message.text;
  const blocks = applied && followsApproval ? message.blocks.filter(block => block.type !== "table") : message.blocks;

  // Many ready messages (one per member): the first in full, the rest as one-line rows.
  const copies = blocks.filter((block): block is CopyBlockData => block.type === "copy");
  const folded = copies.length > 2 ? copies.slice(1) : [];
  const foldedLabel = copies[0]?.title.includes("للمجموعة") ? "الرسائل الفردية" : "بقية الرسائل";

  return (
    <div className={`chat-row is-assistant ${fresh ? "is-fresh" : ""}`}>
      <AssistantAvatar />
      <div className="chat-assistant">
        {text && <Markdown text={text} />}
        {blocks.map((block, index) => {
          if (folded.includes(block as CopyBlockData)) return null;
          return (
            <Fragment key={index}>
              {block === copies[0] && <SendAllBar blocks={copies} />}
              <BlockView block={block} conversationId={message.conversationId} messageId={message.id} messageText={message.text} onSend={onSend} busy={busy} />
              {block === copies[0] && folded.length > 0 && <CopyRows blocks={folded} label={foldedLabel} />}
            </Fragment>
          );
        })}
        {text && <div className="chat-actions"><CopyMessage text={text} /></div>}
      </div>
    </div>
  );
});

export function TypingIndicator() {
  return (
    <div className="chat-row is-assistant is-fresh" aria-live="polite">
      <AssistantAvatar />
      <div className="chat-typing">يفكّر<span className="chat-dots" aria-hidden><i /><i /><i /></span></div>
    </div>
  );
}
