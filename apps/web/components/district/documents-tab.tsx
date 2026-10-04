"use client";

import type { DocumentInfo, DocumentKind } from "@rasd/schemas";
import { Trash2, Upload } from "lucide-react";
import { DragEvent, useEffect, useRef, useState } from "react";
import { api, downloadFile, errorText } from "../../lib/api";
import { counted, relativeTime } from "../../lib/format";
import { KindIcon } from "../chat/blocks/shared";
import { ConfirmDialog } from "./dialog";
import { useToast } from "./toast";

type Props = { memberId: string; documents: DocumentInfo[] | null; error: string; onChanged: () => void };
const OPENABLE: DocumentKind[] = ["pdf", "image", "text"];
const FILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفاً" };

/** Her files (GET /district/members/:id/attachments): open, add (POST …/documents), delete (DELETE /attachments/:id). */
export function DocumentsTab({ memberId, documents, error: loadError, onChanged }: Props) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [canDrop, setCanDrop] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<DocumentInfo | null>(null);

  // Drag & drop only where it makes sense: a mouse on a wide screen.
  useEffect(() => { setCanDrop(window.matchMedia("(pointer: fine) and (min-width: 900px)").matches); }, []);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const saved = await api.upload<DocumentInfo[]>(`/district/members/${memberId}/documents`, files);
      toast(saved.length === 1 ? "رُفع الملف" : `رُفعت ${counted(saved.length, FILES)}`);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setUploading(false);
    }
  };

  // Tap a file: open it when the browser can show it safely, otherwise download it.
  const openFile = (item: DocumentInfo) => {
    setError("");
    downloadFile(`/attachments/${item.id}/download`, item.name, OPENABLE.includes(item.kind)).catch(reason => setError(errorText(reason)));
  };

  const remove = async (item: DocumentInfo) => {
    await api.del(`/attachments/${item.id}`);
    toast("حُذف الملف");
    onChanged();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload(Array.from(event.dataTransfer.files));
  };

  const dropProps = canDrop ? {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop,
  } : {};

  return (
    <div className={`mp-panel ${dragging ? "is-dragging" : ""}`} {...dropProps}>
      <div className="mp-upload">
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <span className="spinner spinner-light" /> : <Upload />} {uploading ? "جارٍ الرفع…" : "أضيفي ملفاً"}
        </button>
        {canDrop && <span className="mp-note">أو أفلتي الملفات هنا</span>}
        <input ref={input} type="file" multiple hidden onChange={event => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      </div>
      {(error || loadError) && <p className="field-error" role="alert">{error || loadError}</p>}

      {documents === null && !loadError && <div className="mp-fields"><i className="skeleton mp-skeleton-field" /><i className="skeleton mp-skeleton-field" /></div>}
      {documents?.length === 0 && <p className="mp-note">لا توجد ملفات بعد. ما ترفعه هي أو ترفعينه أنتِ يظهر هنا.</p>}
      {documents && documents.length > 0 && (
        <ul className="doc-list">
          {documents.map(item => (
            <li key={item.id} className="doc-row">
              <button className="doc-open" onClick={() => openFile(item)}>
                <KindIcon kind={item.kind} />
                <span className="doc-main">
                  <bdi className="doc-name">{item.name}</bdi>
                  <small>{[item.uploadedByName && item.uploadedBy !== item.ownerId ? `رفعته ${item.uploadedByName}` : "", relativeTime(item.createdAt)].filter(Boolean).join(" · ")}</small>
                </span>
              </button>
              <button className="btn btn-ghost btn-icon mp-danger-text" onClick={() => setRemoving(item)} aria-label={`حذف ${item.name}`}><Trash2 /></button>
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <ConfirmDialog
          title="حذف الملف؟"
          description={<>سيُحذف «<bdi>{removing.name}</bdi>» من ملفها.</>}
          confirmLabel="حذف"
          danger
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
