"use client";

import type { ChatBlock, DocumentKind } from "@rasd/schemas";
import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";
import { downloadFile } from "../../../lib/api";
import { relativeTime } from "../../../lib/format";
import { KindIcon } from "./shared";

type DocumentsBlockData = Extract<ChatBlock, { type: "documents" }>;
const OPENABLE: DocumentKind[] = ["pdf", "image", "text"];

export function DocumentsBlock({ block }: { block: DocumentsBlockData }) {
  const [error, setError] = useState("");
  const fetchFile = (id: string, name: string, open: boolean) => {
    setError("");
    downloadFile(`/attachments/${id}/download`, name, open).catch((reason: Error) => setError(reason.message));
  };

  return (
    <section className="blk blk-documents">
      {block.title && <h4 className="blk-title">{block.title}</h4>}
      {!block.items.length && <p className="blk-note">لا توجد ملفات.</p>}
      <ul className="doc-list">
        {block.items.map(item => (
          <li key={item.id} className="doc-row">
            <KindIcon kind={item.kind} />
            <div className="doc-main">
              <bdi className="doc-name">{item.name}</bdi>
              <small>{[item.ownerName ?? "ملفاتك", relativeTime(item.createdAt)].join(" · ")}</small>
              {item.snippet && <p className="doc-snippet">{item.snippet}</p>}
            </div>
            <div className="doc-actions">
              {OPENABLE.includes(item.kind) && (
                <button className="btn btn-ghost btn-icon" onClick={() => fetchFile(item.id, item.name, true)} aria-label={`فتح ${item.name}`}><ExternalLink /></button>
              )}
              <button className="btn btn-ghost btn-icon" onClick={() => fetchFile(item.id, item.name, false)} aria-label={`تنزيل ${item.name}`}><Download /></button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
