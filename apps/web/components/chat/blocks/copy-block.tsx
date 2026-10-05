"use client";

import type { ChatBlock, ReminderSendInput } from "@rasd/schemas";
import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { copyText } from "../../../lib/chat/helpers";
import { ar } from "../../../lib/format";
import { useSendMessages, type SendStatus } from "../../../lib/send-messages";

export type CopyBlockData = Extract<ChatBlock, { type: "copy" }>;

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };
  return { copied, copy };
}

/** A personal message (it has her memberId) can go to her email; reports and the group message are copy-only. */
const emailInput = (blocks: CopyBlockData[]): ReminderSendInput => ({
  kind: blocks.every(block => block.kind === "login") ? "login" : "reminder",
  messages: blocks.filter(block => block.memberId).map(block => ({ memberId: block.memberId!, body: block.text })),
});

function sendLabel(status: SendStatus, idle: string) {
  if (status === "sending") return <><span className="spinner spinner-light" /> جارٍ الإرسال…</>;
  if (status === "sent") return <><Check /> أُرسلت</>;
  return <><Mail /> {status === "idle" ? idle : "إعادة الإرسال"}</>;
}

export function CopyBlock({ block }: { block: CopyBlockData }) {
  const { copied, copy } = useCopy(block.text);
  const email = useSendMessages();
  return (
    <section className="blk blk-copy">
      <h4 className="blk-title">{block.title}</h4>
      <div className="blk-copy-text" dir="auto">{block.text}</div>
      <div className="blk-actions">
        {block.memberId && (
          <button className="btn btn-primary btn-sm" onClick={() => void email.send(emailInput([block]))} disabled={email.busy || email.status === "sent"}>
            {sendLabel(email.status, "إرسال لبريدها")}
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? <><Check /> تم النسخ</> : <><Copy /> نسخ</>}</button>
      </div>
      {email.note && <p className={`blk-send-note is-${email.status}`} role="status">{email.note}</p>}
    </section>
  );
}

/** Several personal messages in one answer: one button emails each member her own message. */
export function SendAllBar({ blocks }: { blocks: CopyBlockData[] }) {
  const email = useSendMessages();
  const personal = blocks.filter(block => block.memberId);
  if (personal.length < 2) return null;
  return (
    <div className="blk blk-send-all">
      <button className="btn btn-primary" onClick={() => void email.send(emailInput(personal))} disabled={email.busy || email.status === "sent"}>
        {sendLabel(email.status, `إرسال الكل لبريدهن (${ar(personal.length)})`)}
      </button>
      <span className="blk-send-note" role="status">{email.note || "كل واحدة تصلها رسالتها الخاصة على بريدها وداخل المنصة."}</span>
    </div>
  );
}

/** Many messages in one answer: the first stays in full above; the rest fold into one-line rows (name · نسخ · إرسال). */
export function CopyRows({ blocks, label }: { blocks: CopyBlockData[]; label: string }) {
  return (
    <details className="blk blk-copy-rows">
      <summary>{label} ({ar(blocks.length)})</summary>
      <ul>{blocks.map((block, index) => <CopyRow key={index} block={block} />)}</ul>
    </details>
  );
}

function CopyRow({ block }: { block: CopyBlockData }) {
  const { copied, copy } = useCopy(block.text);
  const email = useSendMessages();
  // "تذكير — رشا (١٥٪)" → "رشا (١٥٪)": the kind of message is already in the heading above.
  const name = block.title.split(" — ").slice(1).join(" — ") || block.title;
  return (
    <li>
      <span className="blk-copy-row-name">{name}{email.status === "warn" || email.status === "error" ? <small className="blk-send-note is-warn">{email.note}</small> : null}</span>
      <button className="btn btn-ghost btn-sm" onClick={copy} aria-label={copied ? "تم النسخ" : `نسخ ${block.title}`}>{copied ? <><Check /> تم</> : "نسخ"}</button>
      {block.memberId && (
        <button className="btn btn-ghost btn-sm" onClick={() => void email.send(emailInput([block]))} disabled={email.busy || email.status === "sent"}
          aria-label={email.status === "sent" ? `أُرسلت ${block.title}` : `إرسال ${block.title} لبريدها`}>
          {email.status === "sending" ? <span className="spinner" /> : email.status === "sent" ? <><Check /> أُرسلت</> : "إرسال"}
        </button>
      )}
    </li>
  );
}
