"use client";

// ملف الإنجاز: the same folder tree for a member (her own files) and for the head (a member's files).
// Her folders → «مدارس المشرفة» → each school → its seven folders. Files not in a folder yet (older uploads, files
// the head filed from the chat) wait in «غير مصنّفة» until they are moved.
import {
  MEMBER_FOLDERS, SCHOOL_FOLDERS, SCHOOLS_FOLDER, folderLabel, isFileFolder, type DocumentInfo, type DocumentKind, type DocumentPlacement,
} from "@rasd/schemas";
import {
  ChevronLeft, CircleAlert, File, FileAudio, FileImage, FileSpreadsheet, FileText, Folder, FolderInput, FolderOpen, LoaderCircle, School, Trash2,
  Upload, type LucideIcon,
} from "lucide-react";
import { DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../lib/api";
import { counted, relativeTime } from "../../lib/format";

/** {} = her folders · {folder: "schools"} = her schools · {schoolId} = a school · + folder = a folder · {folder: "unsorted"}. */
export type FolderLocation = { folder?: string; schoolId?: string };
export const UNSORTED = "unsorted";

type SchoolRef = { id: string; name: string };
type Props = {
  documents: DocumentInfo[] | null;
  schools: SchoolRef[];
  location: FolderLocation;
  onNavigate: (location: FolderLocation) => void;
  onUpload: (files: File[], placement: DocumentPlacement) => Promise<void>;
  onMove: (document: DocumentInfo, placement: DocumentPlacement) => Promise<void>;
  onRemove: (document: DocumentInfo) => Promise<void>;
  onOpen: (document: DocumentInfo) => void;
  /** Shown in «مدارس المشرفة» when she has no schools yet. */
  noSchools?: ReactNode;
};

const FILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفاً" };
const SCHOOLS = { one: "مدرسة واحدة", two: "مدرستان", few: "مدارس", many: "مدرسة" };
const ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.pptx,image/*";
const KIND_ICON: Record<DocumentKind, LucideIcon> = {
  spreadsheet: FileSpreadsheet, pdf: FileText, word: FileText, text: FileText, image: FileImage, audio: FileAudio, other: File,
};

const schoolName = (school?: SchoolRef) => school?.name.trim() || "مدرسة بدون اسم";
export const filesCount = (n: number) => (n ? counted(n, FILES) : "فارغ");

/** A file the tree can show: a known folder, and (for a school folder) one of her current schools. */
function isSorted(document: DocumentInfo, schoolIds: Set<string>) {
  if (!document.folder) return false;
  if (document.schoolId) return schoolIds.has(document.schoolId) && isFileFolder(document.folder, true);
  return isFileFolder(document.folder, false);
}

const encode = (placement: DocumentPlacement) => `${placement.schoolId ?? ""}|${placement.folder}`;
const decode = (value: string): DocumentPlacement => {
  const [schoolId, folder] = value.split("|");
  return { folder, schoolId: schoolId || null };
};

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

export function FolderBrowser({ documents, schools, location, onNavigate, onUpload, onMove, onRemove, onOpen, noSchools }: Props) {
  const schoolIds = useMemo(() => new Set(schools.map(school => school.id)), [schools]);
  const list = documents ?? [];
  const unsorted = list.filter(document => !isSorted(document, schoolIds));
  const sorted = list.filter(document => isSorted(document, schoolIds));
  const inFolder = (folder: string, schoolId: string | null) =>
    sorted.filter(document => document.folder === folder && (document.schoolId ?? null) === schoolId);
  const inSchool = (schoolId: string) => sorted.filter(document => document.schoolId === schoolId);

  const school = location.schoolId ? schools.find(item => item.id === location.schoolId) : undefined;
  const crumbs: { label: string; to: FolderLocation }[] = [{ label: "ملف الإنجاز", to: {} }];
  if (location.folder === SCHOOLS_FOLDER || location.schoolId) crumbs.push({ label: folderLabel(SCHOOLS_FOLDER, false), to: { folder: SCHOOLS_FOLDER } });
  if (location.schoolId) crumbs.push({ label: schoolName(school), to: { schoolId: location.schoolId } });
  if (location.folder === UNSORTED) crumbs.push({ label: "غير مصنّفة", to: location });
  else if (location.folder && location.folder !== SCHOOLS_FOLDER) crumbs.push({ label: folderLabel(location.folder, Boolean(location.schoolId)), to: location });

  let body: ReactNode;
  if (documents === null) {
    body = <div className="fb-grid">{[0, 1, 2, 3].map(index => <i key={index} className="skeleton fb-skeleton" />)}</div>;
  } else if (location.schoolId && !school) {
    body = <p className="fb-note">لم نجد هذه المدرسة — ربما حُذفت. ملفاتها في «غير مصنّفة».</p>;
  } else if (location.folder === UNSORTED) {
    body = (
      <>
        <p className="fb-note">ملفات رُفعت قبل المجلدات أو لم تُحفظ في مجلد بعد. انقلي كل ملف إلى مجلده.</p>
        <FileList documents={unsorted} schools={schools} onMove={onMove} onRemove={onRemove} onOpen={onOpen} empty="لا توجد ملفات غير مصنّفة." />
      </>
    );
  } else if (location.folder && location.folder !== SCHOOLS_FOLDER && isFileFolder(location.folder, Boolean(location.schoolId))) {
    const placement = { folder: location.folder, schoolId: location.schoolId ?? null };
    body = (
      <FolderFiles placement={placement} documents={inFolder(placement.folder, placement.schoolId)} schools={schools}
        onUpload={onUpload} onMove={onMove} onRemove={onRemove} onOpen={onOpen} />
    );
  } else if (location.schoolId) {
    body = (
      <div className="fb-grid">
        {SCHOOL_FOLDERS.map(folder => (
          <Tile key={folder.key} label={folder.label} meta={filesCount(inFolder(folder.key, location.schoolId!).length)}
            onClick={() => onNavigate({ schoolId: location.schoolId, folder: folder.key })} />
        ))}
      </div>
    );
  } else if (location.folder === SCHOOLS_FOLDER) {
    body = schools.length ? (
      <div className="fb-grid">
        {schools.map(item => (
          <Tile key={item.id} icon={School} label={schoolName(item)} meta={filesCount(inSchool(item.id).length)} onClick={() => onNavigate({ schoolId: item.id })} />
        ))}
      </div>
    ) : (noSchools ?? <p className="fb-note">لا توجد مدارس بعد.</p>);
  } else {
    body = (
      <div className="fb-grid">
        {MEMBER_FOLDERS.map(folder => folder.key === SCHOOLS_FOLDER ? (
          <Tile key={folder.key} icon={School} label={folder.label} meta={schools.length ? counted(schools.length, SCHOOLS) : "لا توجد مدارس بعد"}
            onClick={() => onNavigate({ folder: SCHOOLS_FOLDER })} />
        ) : (
          <Tile key={folder.key} label={folder.label} meta={filesCount(inFolder(folder.key, null).length)} onClick={() => onNavigate({ folder: folder.key })} />
        ))}
        {unsorted.length > 0 && (
          <Tile icon={CircleAlert} tone="warn" label="غير مصنّفة" meta={`${counted(unsorted.length, FILES)} بلا مجلد`} onClick={() => onNavigate({ folder: UNSORTED })} />
        )}
      </div>
    );
  }

  return (
    <div className="fb">
      <nav className="fb-crumbs" aria-label="مكان المجلد">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={index} className="fb-crumb">
              {index > 0 && <ChevronLeft aria-hidden />}
              {last ? <b aria-current="page">{crumb.label}</b> : <button type="button" onClick={() => onNavigate(crumb.to)}>{crumb.label}</button>}
            </span>
          );
        })}
      </nav>
      {body}
    </div>
  );
}

function Tile({ label, meta, onClick, icon: Icon = Folder, tone }: { label: string; meta: string; onClick: () => void; icon?: LucideIcon; tone?: "warn" }) {
  return (
    <button type="button" className={`fb-tile${tone ? ` is-${tone}` : ""}`} onClick={onClick}>
      <span className="fb-tile-icon" aria-hidden><Icon /></span>
      <span className="fb-tile-text"><b>{label}</b><small>{meta}</small></span>
      <ChevronLeft className="fb-tile-go" aria-hidden />
    </button>
  );
}

type FileActions = Pick<Props, "onMove" | "onRemove" | "onOpen"> & { schools: SchoolRef[] };

function FolderFiles({ placement, documents, onUpload, ...actions }: FileActions & { placement: DocumentPlacement; documents: DocumentInfo[]; onUpload: Props["onUpload"] }) {
  const input = useRef<HTMLInputElement>(null);
  const canDrop = useCanDrop();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const upload = async (files: File[]) => {
    if (input.current) input.current.value = "";
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    try { await onUpload(files, placement); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const dropProps = canDrop ? {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); },
  } : {};

  return (
    <div className={`fb-folder${dragging ? " is-dragging" : ""}`} {...dropProps}>
      <div className="fb-upload">
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <LoaderCircle className="fb-spin" aria-hidden /> : <Upload aria-hidden />}{busy ? "جارٍ الرفع…" : "ارفعي ملفاً هنا"}
        </button>
        <span className="fb-hint">PDF أو Word أو Excel أو صورة · حتى ٢٥ ميغابايت{canDrop ? " · أو اسحبي الملفات إلى هنا" : ""}</span>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={event => void upload(Array.from(event.target.files ?? []))} />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <FileList documents={documents} {...actions} empty="المجلد فارغ — ارفعي أول ملف." />
    </div>
  );
}

function FileList({ documents, schools, onMove, onRemove, onOpen, empty }: FileActions & { documents: DocumentInfo[]; empty: string }) {
  const [moving, setMoving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!documents.length) return <p className="fb-note">{empty}</p>;

  const run = async (job: () => Promise<void>) => {
    setError("");
    try { await job(); } catch (reason) { setError(errorText(reason)); }
  };

  return (
    <>
      {error && <p className="field-error" role="alert">{error}</p>}
      <ul className="fb-files">
        {documents.map(item => {
          const Icon = KIND_ICON[item.kind] ?? File;
          const meta = [relativeTime(item.createdAt), item.uploadedByName && item.uploadedBy !== item.ownerId ? `رفعته ${item.uploadedByName}` : ""].filter(Boolean).join(" · ");
          return (
            <li key={item.id} className="fb-file">
              <div className="fb-file-row">
                <button type="button" className="fb-file-open" onClick={() => onOpen(item)}>
                  <span className={`fb-file-icon is-${item.kind}`} aria-hidden><Icon /></span>
                  <span className="fb-file-text"><bdi>{item.name}</bdi><small>{meta}</small></span>
                </button>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => { setRemoving(null); setMoving(id => (id === item.id ? null : item.id)); }}
                  aria-label={`نقل ${item.name} إلى مجلد آخر`} aria-expanded={moving === item.id} title="نقل إلى مجلد">
                  <FolderInput aria-hidden />
                </button>
                <button type="button" className="btn btn-ghost btn-icon fb-danger" onClick={() => { setMoving(null); setRemoving(id => (id === item.id ? null : item.id)); }}
                  aria-label={`حذف ${item.name}`} aria-expanded={removing === item.id} title="حذف">
                  <Trash2 aria-hidden />
                </button>
              </div>
              {moving === item.id && (
                <MoveForm document={item} schools={schools} onCancel={() => setMoving(null)}
                  onMove={placement => run(async () => { await onMove(item, placement); setMoving(null); })} />
              )}
              {removing === item.id && (
                <div className="fb-inline">
                  <span>حذف «<bdi>{item.name}</bdi>»؟</span>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void run(async () => { await onRemove(item); setRemoving(null); })}>نعم، احذفيه</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRemoving(null)}>إلغاء</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function MoveForm({ document, schools, onMove, onCancel }: { document: DocumentInfo; schools: SchoolRef[]; onMove: (placement: DocumentPlacement) => Promise<void>; onCancel: () => void }) {
  const current = document.folder && isSorted(document, new Set(schools.map(school => school.id)))
    ? encode({ folder: document.folder, schoolId: document.schoolId }) : "";
  const [target, setTarget] = useState(current);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!target || target === current) return;
    setBusy(true);
    try { await onMove(decode(target)); } finally { setBusy(false); }
  };
  return (
    <div className="fb-inline">
      <label className="sr-only" htmlFor={`move-${document.id}`}>المجلد الجديد</label>
      <select id={`move-${document.id}`} className="input fb-select" value={target} onChange={event => setTarget(event.target.value)}>
        {!current && <option value="" disabled>اختاري المجلد…</option>}
        <optgroup label="ملف الإنجاز">
          {MEMBER_FOLDERS.filter(folder => folder.key !== SCHOOLS_FOLDER).map(folder => (
            <option key={folder.key} value={encode({ folder: folder.key, schoolId: null })}>{folder.label}</option>
          ))}
        </optgroup>
        {schools.map(school => (
          <optgroup key={school.id} label={schoolName(school)}>
            {SCHOOL_FOLDERS.map(folder => (
              <option key={folder.key} value={encode({ folder: folder.key, schoolId: school.id })}>{folder.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !target || target === current}>
        {busy ? <LoaderCircle className="fb-spin" aria-hidden /> : <FolderOpen aria-hidden />}نقل
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

/** The seven folders of one school with how many of her files each holds (her school page links to them). */
export function schoolFolderCounts(documents: DocumentInfo[], schoolId: string) {
  return SCHOOL_FOLDERS.map(folder => ({ ...folder, count: documents.filter(item => item.schoolId === schoolId && item.folder === folder.key).length }));
}
