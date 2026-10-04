"use client";

import type { ChatBlock } from "@rasd/schemas";
import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { copyText, whatsappLink } from "../../../lib/chat/helpers";
import { ar } from "../../../lib/format";

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

export function CopyBlock({ block }: { block: CopyBlockData }) {
  const { copied, copy } = useCopy(block.text);
  return (
    <section className="blk blk-copy">
      <h4 className="blk-title">{block.title}</h4>
      <div className="blk-copy-text" dir="auto">{block.text}</div>
      <div className="blk-actions">
        <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? <><Check /> تم النسخ</> : <><Copy /> نسخ</>}</button>
        <a className="btn btn-secondary btn-sm" href={whatsappLink(block.text)} target="_blank" rel="noopener noreferrer">
          <MessageCircle /> إرسال واتساب
        </a>
      </div>
    </section>
  );
}

/** Many messages in one answer: the first stays in full above; the rest fold into one-line rows (name · نسخ · واتساب). */
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
  // "تذكير — رشا (١٥٪)" → "رشا (١٥٪)": the kind of message is already in the heading above.
  const name = block.title.split(" — ").slice(1).join(" — ") || block.title;
  return (
    <li>
      <span className="blk-copy-row-name">{name}</span>
      <button className="btn btn-ghost btn-sm" onClick={copy} aria-label={copied ? "تم النسخ" : `نسخ ${block.title}`}>{copied ? <><Check /> تم</> : "نسخ"}</button>
      <a className="btn btn-ghost btn-sm" href={whatsappLink(block.text)} target="_blank" rel="noopener noreferrer" aria-label={`إرسال ${block.title} واتساب`}>واتساب</a>
    </li>
  );
}
