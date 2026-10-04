"use client";

import type { DocumentInfo, DocumentKind } from "@rasd/schemas";
import {
  Check, CircleAlert, ClipboardList, File, FileAudio, FileImage, FileSpreadsheet, FileText, LoaderCircle, Plus, Upload, X, type LucideIcon,
} from "lucide-react";
import { DragEvent, useEffect, useRef, useState } from "react";
import { useActions } from "../../../components/member/actions";
import { useMember } from "../../../components/member/context";
import { SEP } from "../../../components/member/model";
import { useSchoolName } from "../../../components/member/today";
import { ConfirmDelete, Expander } from "../../../components/member/ui";
import { VisitSheet } from "../../../components/member/visits";
import { downloadFile, errorText } from "../../../lib/api";
import { ar, relativeTime } from "../../../lib/format";
import type { VisitReport } from "../../../lib/types";

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
type Item = { kind: "visit"; at: string; visit: VisitReport } | { kind: "file"; at: string; document: DocumentInfo };

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
  const { me, documents, visits, notify } = useMember();
  const { uploadDocument, removeDocument } = useActions();
  const schoolName = useSchoolName();
  const [logging, setLogging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [openVisit, setOpenVisit] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canDrop = useCanDrop();
  const busy = uploads.some(item => item.status === "uploading");

  // #plans (from «جهّزي ملفك») opens the plans and brings them into view.
  useEffect(() => {
    if (window.location.hash !== "#plans") return;
    const section = document.getElementById("plans");
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ block: "start" });
  }, []);

  // One file at a time; a row shows only while it uploads or if it failed. Success = the file in the list + a toast.
  const send = async (batch: { key: string; file: File }[]) => {
    let succeeded = 0;
    for (const { key, file } of batch) {
      setUploads(items => items.map(item => (item.key === key ? { ...item, status: "uploading", error: undefined } : item)));
      try {
        await uploadDocument(file);
        setUploads(items => items.filter(item => item.key !== key));
        succeeded += 1;
      } catch (error) {
        setUploads(items => items.map(item => (item.key === key ? { ...item, status: "error", error: errorText(error) } : item)));
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

  const openFile = (document: DocumentInfo) =>
    downloadFile(`/attachments/${document.id}/download`, document.name, true).catch(error => notify(errorText(error), { tone: "error" }));

  const dropProps = canDrop ? {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void uploadAll(event.dataTransfer.files); },
  } : {};

  const items: Item[] = [
    ...visits.map(visit => ({ kind: "visit" as const, at: visit.createdAt, visit })),
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

      <Plans />

      {items.length === 0 ? (
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
                    {item.document.uploadedBy !== me.id && item.document.uploadedByName ? `${SEP}رفعته ${item.document.uploadedByName}` : ""}
                  </small>
                </span>
              </button>
              <ConfirmDelete label={`حذف ${item.document.name}`} onConfirm={() => void removeDocument(item.document)} />
            </li>
          ) : (
            <li key={`v-${item.visit.id}`} className="m-item">
              <button type="button" className="m-item-main" onClick={() => setOpenVisit(id => (id === item.visit.id ? null : item.visit.id))}
                aria-expanded={openVisit === item.visit.id}>
                <span className="m-item-icon is-visit" aria-hidden><ClipboardList /></span>
                <span className="m-item-text">
                  <b>{schoolName(item.visit)}{SEP}{item.visit.type}</b>
                  <small>{relativeTime(item.visit.createdAt)}</small>
                </span>
              </button>
              {openVisit === item.visit.id && <VisitDetails visit={item.visit} />}
            </li>
          ))}
        </ul>
      )}

      {logging && <VisitSheet onClose={() => setLogging(false)} />}
    </div>
  );
}

/** main's five plans as link rows (a link marks the plan as uploaded), plus the Nafes card folder. */
function Plans() {
  const { ws } = useMember();
  const { setPlanUrl, setNafesFolder } = useActions();
  const uploaded = ws.plans.filter(plan => plan.status === "uploaded").length;
  return (
    <div className="m-exp-group">
      <Expander id="plans" title={<>روابط الخطط <span className="m-count">({ar(uploaded)} من {ar(ws.plans.length)})</span></>}>
        {ws.plans.map(plan => (
          <div className="field" key={plan.id}>
            <label className="field-label m-plan-label" htmlFor={`plan-${plan.id}`}>
              {plan.label}
              {plan.status === "uploaded" && <span className="m-plan-done"><Check aria-hidden />مرفوعة</span>}
            </label>
            <input id={`plan-${plan.id}`} className="input" type="url" inputMode="url" dir="ltr" value={plan.url} placeholder="الصقي رابط الملف"
              onChange={event => setPlanUrl(plan, event.target.value)} />
          </div>
        ))}
        <div className="field">
          <label className="field-label" htmlFor="nafes-folder">مجلد بطاقة نافس <span className="m-optional">(اختياري)</span></label>
          <input id="nafes-folder" className="input" type="url" inputMode="url" dir="ltr" value={ws.cluster.nafesCardFolderUrl} placeholder="الصقي رابط المجلد"
            onChange={event => setNafesFolder(event.target.value)} />
        </div>
      </Expander>
    </div>
  );
}

function FileIcon({ kind }: { kind: DocumentKind }) {
  const Icon = KIND_ICON[kind] ?? File;
  return <span className={`m-item-icon is-${kind}`} aria-hidden><Icon /></span>;
}

function VisitDetails({ visit }: { visit: VisitReport }) {
  const counts = [
    visit.beneficiaries ? `المستفيدات: ${ar(visit.beneficiaries)}` : "",
    visit.sessions ? `الجلسات: ${ar(visit.sessions)}` : "",
  ].filter(Boolean).join(SEP);
  return (
    <div className="m-item-details">
      {visit.text ? <p>{visit.text}</p> : <p className="m-muted">لا يوجد وصف.</p>}
      {counts && <p className="m-muted">{counts}</p>}
      {visit.blockers && <p className="m-muted">المعوقات: {visit.blockers}</p>}
    </div>
  );
}
