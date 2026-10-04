"use client";

import type { DocumentInfo, DocumentKind, Visit } from "@rasd/schemas";
import {
  CircleAlert, ClipboardList, File, FileAudio, FileImage, FileSpreadsheet, FileText, LoaderCircle, Plus, Upload, X, type LucideIcon,
} from "lucide-react";
import { DragEvent, useEffect, useRef, useState } from "react";
import { SEP } from "../../../components/member/model";
import { ConfirmDelete } from "../../../components/member/ui";
import { useVisits, VisitSheet } from "../../../components/member/visits";
import { useWorkspace } from "../../../components/member/workspace-context";
import { api, downloadFile } from "../../../lib/api";
import { ar, relativeTime } from "../../../lib/format";

const ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.txt,image/*";

const KIND_ICON: Record<DocumentKind, LucideIcon> = {
  spreadsheet: FileSpreadsheet,
  pdf: FileText,
  word: FileText,
  text: FileText,
  image: FileImage,
  audio: FileAudio,
  other: File,
};

type Upload = { key: string; file: File; status: "uploading" | "error"; error?: string };
type Item = { kind: "visit"; at: string; visit: Visit } | { kind: "file"; at: string; document: DocumentInfo };

/** Drag & drop only where it means something: a wide screen with a mouse. */
function useCanDrop() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px) and (pointer: fine)");
    const sync = () => setCan(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return can;
}

export default function ReportsPage() {
  const { user, documents, setDocuments, notify } = useWorkspace();
  const { visits, add, remove: removeVisit } = useVisits();
  const [logging, setLogging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [openVisit, setOpenVisit] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canDrop = useCanDrop();
  const busy = uploads.some(item => item.status === "uploading");

  // One file at a time; a row shows only while it uploads or if it failed. Success = the file in the list + a toast.
  const send = async (batch: { key: string; file: File }[]) => {
    let succeeded = 0;
    for (const { key, file } of batch) {
      setUploads(items => items.map(item => (item.key === key ? { ...item, status: "uploading", error: undefined } : item)));
      try {
        const saved = await api.upload<DocumentInfo[]>("/member/documents", [file]);
        setDocuments(current => [...saved, ...current]);
        setUploads(items => items.filter(item => item.key !== key));
        succeeded += 1;
      } catch (error) {
        setUploads(items => items.map(item => (item.key === key ? { ...item, status: "error", error: (error as Error).message } : item)));
      }
    }
    if (succeeded) notify(succeeded === 1 ? "رُفع الملف" : "رُفعت الملفات");
  };

  const uploadAll = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (input.current) input.current.value = "";
    if (!files.length) return;
    const batch = files.map((file, index) => ({ key: `${Date.now()}-${index}`, file }));
    setUploads(items => [...batch.map(({ key, file }) => ({ key, file, status: "uploading" as const })), ...items.filter(item => item.status === "error")]);
    await send(batch);
  };

  // A failed file is kept, so she can send it again without finding it in the picker.
  const retryUpload = (item: Upload) => void send([{ key: item.key, file: item.file }]);
  const dismissUpload = (key: string) => setUploads(items => items.filter(item => item.key !== key));

  const removeFile = async (document: DocumentInfo) => {
    setDocuments(current => current.filter(item => item.id !== document.id));
    try {
      await api.del(`/documents/${document.id}`);
      notify("حُذف الملف");
    } catch (error) {
      setDocuments(current => [document, ...current]);
      notify((error as Error).message, "error");
    }
  };

  const openFile = (document: DocumentInfo) =>
    downloadFile(`/documents/${document.id}/download`, document.name, true).catch(error => notify((error as Error).message, "error"));

  const dropProps = canDrop ? {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void uploadAll(event.dataTransfer.files); },
  } : {};

  const items: Item[] = [
    ...(visits ?? []).map(visit => ({ kind: "visit" as const, at: visit.createdAt, visit })),
    ...documents.map(document => ({ kind: "file" as const, at: document.createdAt, document })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className={`m-page m-reports${dragging ? " is-dragging" : ""}`} {...dropProps}>
      <h1>تقاريري</h1>

      <div className="m-report-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setLogging(true)}><Plus aria-hidden />سجّلي زيارة</button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <LoaderCircle className="m-spin" aria-hidden /> : <Upload aria-hidden />}ارفعي ملفاً
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={event => event.target.files && uploadAll(event.target.files)} />
      </div>
      <p className="m-hint">PDF أو Word أو Excel أو صورة{SEP}حتى ٢٥ ميغابايت{canDrop && `${SEP}أو اسحبي الملفات إلى هنا`}</p>

      {uploads.length > 0 && (
        <ul className="m-uploads" aria-live="polite">
          {uploads.map(item => (
            <li key={item.key} className={`m-upload is-${item.status}`}>
              {item.status === "uploading" ? <LoaderCircle className="m-spin" aria-hidden /> : <CircleAlert aria-hidden />}
              <span className="m-upload-text">
                <bdi className="m-upload-name">{item.file.name}</bdi>
                <small>{item.status === "uploading" ? "جارٍ الرفع…" : item.error || "تعذّر الرفع"}</small>
              </span>
              {item.status === "error" && (
                <>
                  <button type="button" className="m-link" onClick={() => retryUpload(item)}>إعادة المحاولة</button>
                  <button type="button" className="btn btn-icon btn-ghost m-upload-x" onClick={() => dismissUpload(item.key)} aria-label={`إخفاء ${item.file.name}`}>
                    <X aria-hidden />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {visits === null ? (
        <div className="skeleton" style={{ height: 64 }} />
      ) : items.length === 0 ? (
        <p className="m-lead">زياراتك وملفاتك تظهر هنا.</p>
      ) : (
        <ul className="card m-items">
          {items.map(item => item.kind === "file" ? (
            <li key={`f-${item.document.id}`} className="m-item">
              <button type="button" className="m-item-main" onClick={() => openFile(item.document)}>
                <FileIcon kind={item.document.kind} />
                <span className="m-item-text">
                  <b><bdi>{item.document.name}</bdi></b>
                  <small>
                    {relativeTime(item.document.createdAt)}
                    {item.document.uploadedBy !== user.id && item.document.uploadedByName ? `${SEP}رفعته ${item.document.uploadedByName}` : ""}
                  </small>
                </span>
              </button>
              <ConfirmDelete label={`حذف ${item.document.name}`} onConfirm={() => removeFile(item.document)} />
            </li>
          ) : (
            <li key={`v-${item.visit.id}`} className="m-item">
              <button type="button" className="m-item-main" onClick={() => setOpenVisit(id => (id === item.visit.id ? null : item.visit.id))}
                aria-expanded={openVisit === item.visit.id}>
                <span className="m-item-icon is-visit" aria-hidden><ClipboardList /></span>
                <span className="m-item-text">
                  <b>{item.visit.schoolName || "بدون مدرسة"}{SEP}{item.visit.type}</b>
                  <small>{relativeTime(item.visit.createdAt)}</small>
                </span>
              </button>
              <ConfirmDelete label="حذف الزيارة" onConfirm={() => removeVisit(item.visit)} />
              {openVisit === item.visit.id && <VisitDetails visit={item.visit} />}
            </li>
          ))}
        </ul>
      )}

      {logging && <VisitSheet onClose={() => setLogging(false)} onSaved={add} />}
    </div>
  );
}

function FileIcon({ kind }: { kind: DocumentKind }) {
  const Icon = KIND_ICON[kind] ?? File;
  return <span className={`m-item-icon is-${kind}`} aria-hidden><Icon /></span>;
}

function VisitDetails({ visit }: { visit: Visit }) {
  const counts = [
    visit.beneficiaries > 0 ? `المستفيدات: ${ar(visit.beneficiaries)}` : "",
    visit.sessions > 0 ? `الجلسات: ${ar(visit.sessions)}` : "",
  ].filter(Boolean).join(SEP);
  return (
    <div className="m-item-details">
      {visit.text ? <p>{visit.text}</p> : <p className="m-muted">لا يوجد وصف.</p>}
      {counts && <p className="m-muted">{counts}</p>}
      {visit.blockers && <p className="m-muted">المعوقات: {visit.blockers}</p>}
    </div>
  );
}
