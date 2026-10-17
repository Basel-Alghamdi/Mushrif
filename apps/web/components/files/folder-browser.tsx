"use client";

// ملف الإنجاز: the same folder tree for a member (her own files) and for the head (a member's files), drawn from her
// layout (workspace.folders), which رئيسة النطاق edits. Her folders → «مدارس المشرفة» → each school → its folders. Some
// folders open sub-folders (e.g. النموذج الإشرافي → خطة التحسين) and may still hold files of their own. A file the tree
// cannot reach (never filed, its folder removed, its school deleted) waits in «غير مصنّفة» until it is moved.
import {
  folderFamily, folderLabel, folderParent, folderTitle, isFileFolder, schoolsEntry, subfoldersOf, topFolders,
  type DocumentInfo, type DocumentKind, type DocumentPlacement, type FolderDef, type FolderLayout,
} from "@rasd/schemas";
import {
  ChevronLeft, CircleAlert, File, FileAudio, FileImage, FileSpreadsheet, FileText, Folder, FolderInput, FolderOpen, LoaderCircle, School, Trash2,
  Upload, type LucideIcon,
} from "lucide-react";
import { DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../lib/api";
import { counted, relativeTime } from "../../lib/format";

/** {} = her folders · {folder: <«مدارس المشرفة» key>} = her schools · {schoolId} = a school · + folder = a folder · {folder: "unsorted"}. */
export type FolderLocation = { folder?: string; schoolId?: string };
export const UNSORTED = "unsorted";

type SchoolRef = { id: string; name: string };
type Props = {
  documents: DocumentInfo[] | null;
  schools: SchoolRef[];
  folders: FolderLayout;
  location: FolderLocation;
  onNavigate: (location: FolderLocation) => void;
  onUpload: (files: File[], placement: DocumentPlacement) => Promise<void>;
  onMove: (document: DocumentInfo, placement: DocumentPlacement) => Promise<void>;
  onRemove: (document: DocumentInfo) => Promise<void>;
  onOpen: (document: DocumentInfo) => void;
  /** Shown in «مدارس المشرفة» when she has no schools yet. */
  noSchools?: ReactNode;
  /** Beside the path (the head's «تعديل المجلدات»). */
  actions?: ReactNode;
};

const FILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفاً" };
const SCHOOLS = { one: "مدرسة واحدة", two: "مدرستان", few: "مدارس", many: "مدرسة" };
const ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.pptx,image/*";
const KIND_ICON: Record<DocumentKind, LucideIcon> = {
  spreadsheet: FileSpreadsheet, pdf: FileText, word: FileText, text: FileText, image: FileImage, audio: FileAudio, other: File,
};

const schoolName = (school?: SchoolRef) => school?.name.trim() || "مدرسة بدون اسم";
export const filesCount = (n: number) => (n ? counted(n, FILES) : "فارغ");

/** A file the tree can reach: a folder of her layout that holds files, and (for a school folder) one of her current schools. */
function isSorted(document: DocumentInfo, layout: FolderLayout, schoolIds: Set<string>) {
  if (!document.folder) return false;
  if (document.schoolId && !schoolIds.has(document.schoolId)) return false;
  return isFileFolder(layout, document.folder, Boolean(document.schoolId));
}

/** A folder's last known label: live, or as it was when رئيسة النطاق removed it. */
function knownFolder(layout: FolderLayout, key: string, inSchool: boolean): FolderDef | undefined {
  const scope = inSchool ? "school" : "member";
  return layout[scope].find(item => item.key === key) ?? layout.removed?.find(item => item.scope === scope && item.key === key);
}

/** A school file's school: her school's current name, or the name it had when it was deleted. */
function fileSchool(document: DocumentInfo, schools: SchoolRef[]) {
  const school = schools.find(item => item.id === document.schoolId);
  return school ? schoolName(school) : document.schoolName?.trim() || "مدرسة محذوفة";
}

/** Where an unsorted file was: «الثانوية التاسعة › الانضباط التعليمي › المساءلة», or "" for a file never filed. */
function formerPlace(document: DocumentInfo, layout: FolderLayout, schools: SchoolRef[]) {
  if (!document.folder) return "";
  const inSchool = Boolean(document.schoolId);
  const folder = knownFolder(layout, document.folder, inSchool);
  const parent = folder?.parent ? knownFolder(layout, folder.parent, inSchool) : undefined;
  return [inSchool ? fileSchool(document, schools) : "", parent?.label, folder?.label].filter(Boolean).join(" › ");
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

export function FolderBrowser({ documents, schools, folders, location, onNavigate, onUpload, onMove, onRemove, onOpen, noSchools, actions }: Props) {
  const schoolIds = useMemo(() => new Set(schools.map(school => school.id)), [schools]);
  const list = documents ?? [];
  const unsorted = list.filter(document => !isSorted(document, folders, schoolIds));
  const sorted = list.filter(document => isSorted(document, folders, schoolIds));
  const inFolder = (folder: string, schoolId: string | null) =>
    sorted.filter(document => document.folder === folder && (document.schoolId ?? null) === schoolId);
  /** A folder's files with those of its sub-folders (what its tile counts). */
  const inFamily = (folder: string, schoolId: string | null) => {
    const keys = folderFamily(folders, folder, schoolId !== null);
    return sorted.filter(document => keys.includes(document.folder!) && (document.schoolId ?? null) === schoolId);
  };
  const inSchool = (schoolId: string) => sorted.filter(document => document.schoolId === schoolId);

  // «مدارس المشرفة» is whatever she calls it now; without it her schools' folders are out of reach.
  const entry = schoolsEntry(folders);
  const inSchools = Boolean(location.schoolId);
  const school = location.schoolId ? schools.find(item => item.id === location.schoolId) : undefined;
  const crumbs: { label: string; to: FolderLocation }[] = [{ label: "ملف الإنجاز", to: {} }];
  if (entry && (location.folder === entry.key || inSchools)) crumbs.push({ label: entry.label, to: { folder: entry.key } });
  if (entry && school) crumbs.push({ label: schoolName(school), to: { schoolId: location.schoolId } });
  if (location.folder === UNSORTED) crumbs.push({ label: "غير مصنّفة", to: location });
  else if (location.folder && location.folder !== entry?.key && (!inSchools || school) && isFileFolder(folders, location.folder, inSchools)) {
    const parent = folderParent(folders, location.folder, inSchools);
    if (parent) crumbs.push({ label: folderLabel(folders, parent, inSchools), to: { schoolId: location.schoolId, folder: parent } });
    crumbs.push({ label: folderLabel(folders, location.folder, inSchools), to: location });
  }

  // A place that is gone (an old link, or رئيسة النطاق changed the folders while the page was open): its files are unsorted.
  const gone = (text: string) => (
    <div className="fb-gone">
      <p className="fb-note">{text}</p>
      <div className="fb-links">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ folder: UNSORTED })}><CircleAlert aria-hidden />غير مصنّفة</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate({})}>ملف الإنجاز</button>
      </div>
    </div>
  );

  let body: ReactNode;
  if (documents === null) {
    body = <div className="fb-grid">{[0, 1, 2, 3].map(index => <i key={index} className="skeleton fb-skeleton" />)}</div>;
  } else if (location.folder === UNSORTED) {
    body = (
      <>
        <p className="fb-note">ملفات من مجلدات حذفتها رئيسة النطاق، أو لم تُحفظ في مجلد بعد.</p>
        <UnsortedFiles documents={unsorted} layout={folders} schools={schools} onMove={onMove} onRemove={onRemove} onOpen={onOpen} />
      </>
    );
  } else if (inSchools && !entry) {
    body = gone("هذا المجلد لم يعد موجوداً — ملفاته في غير مصنّفة.");
  } else if (inSchools && !school) {
    body = gone("لم نجد هذه المدرسة — ربما حُذفت. ملفاتها في «غير مصنّفة».");
  } else if (location.folder && location.folder !== entry?.key && !isFileFolder(folders, location.folder, inSchools)) {
    body = gone("هذا المجلد لم يعد موجوداً — ملفاته في غير مصنّفة.");
  } else if (location.folder && location.folder !== entry?.key) {
    const placement = { folder: location.folder, schoolId: location.schoolId ?? null };
    const subfolders = subfoldersOf(folders, placement.folder, inSchools);
    body = (
      <>
        {subfolders.length > 0 && (
          <div className="fb-grid">
            {subfolders.map(folder => (
              <Tile key={folder.key} label={folder.label} meta={filesCount(inFolder(folder.key, placement.schoolId).length)}
                onClick={() => onNavigate({ schoolId: location.schoolId, folder: folder.key })} />
            ))}
          </div>
        )}
        <FolderFiles placement={placement} documents={inFolder(placement.folder, placement.schoolId)} layout={folders} schools={schools}
          onUpload={onUpload} onMove={onMove} onRemove={onRemove} onOpen={onOpen} empty={subfolders.length > 0} />
      </>
    );
  } else if (inSchools) {
    body = (
      <div className="fb-grid">
        {topFolders(folders, true).map(folder => (
          <Tile key={folder.key} label={folder.label} meta={filesCount(inFamily(folder.key, location.schoolId!).length)}
            onClick={() => onNavigate({ schoolId: location.schoolId, folder: folder.key })} />
        ))}
      </div>
    );
  } else if (location.folder) { // her «مدارس المشرفة»
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
        {topFolders(folders, false).map(folder => folder === entry ? (
          <Tile key={folder.key} icon={School} label={folder.label} meta={schools.length ? counted(schools.length, SCHOOLS) : "لا توجد مدارس بعد"}
            onClick={() => onNavigate({ folder: folder.key })} />
        ) : (
          <Tile key={folder.key} label={folder.label} meta={filesCount(inFamily(folder.key, null).length)} onClick={() => onNavigate({ folder: folder.key })} />
        ))}
        {unsorted.length > 0 && (
          <Tile icon={CircleAlert} tone="warn" label="غير مصنّفة" meta={`${counted(unsorted.length, FILES)} بلا مجلد`} onClick={() => onNavigate({ folder: UNSORTED })} />
        )}
      </div>
    );
  }

  return (
    <div className="fb">
      <div className="fb-head">
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
        {actions}
      </div>
      {body}
    </div>
  );
}

/** «غير مصنّفة», grouped by school: her own files first, then each school's, each file saying where it was. */
function UnsortedFiles({ documents, ...actions }: FileActions & { documents: DocumentInfo[] }) {
  if (!documents.length) return <p className="fb-note">لا توجد ملفات غير مصنّفة.</p>;
  const groups = new Map<string, DocumentInfo[]>([["", []]]);
  for (const document of documents) {
    const key = document.schoolId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }
  const place = (document: DocumentInfo) => formerPlace(document, actions.layout, actions.schools);
  return (
    <>
      {[...groups].filter(([, items]) => items.length).map(([schoolId, items]) => (
        <section key={schoolId} className="fb-group">
          {schoolId && <h3><School aria-hidden />{fileSchool(items[0], actions.schools)}</h3>}
          <FileList documents={items} {...actions} place={place} empty="" />
        </section>
      ))}
    </>
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

type FileActions = Pick<Props, "onMove" | "onRemove" | "onOpen"> & { layout: FolderLayout; schools: SchoolRef[] };

/** `empty`: the folder has sub-folders, so its own file list says less when it is empty. */
function FolderFiles({ placement, documents, onUpload, empty, ...actions }: FileActions & {
  placement: DocumentPlacement; documents: DocumentInfo[]; onUpload: Props["onUpload"]; empty?: boolean;
}) {
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
      <FileList documents={documents} {...actions} empty={empty ? "افتحي المجلد المناسب أعلاه، أو ارفعي هنا ملفاً عاماً." : "المجلد فارغ — ارفعي أول ملف."} />
    </div>
  );
}

/** `place`: where each file was (shown in «غير مصنّفة»). */
function FileList({ documents, layout, schools, onMove, onRemove, onOpen, empty, place }: FileActions & {
  documents: DocumentInfo[]; empty: string; place?: (document: DocumentInfo) => string;
}) {
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
          const was = place?.(item);
          return (
            <li key={item.id} className="fb-file">
              <div className="fb-file-row">
                <button type="button" className="fb-file-open" onClick={() => onOpen(item)}>
                  <span className={`fb-file-icon is-${item.kind}`} aria-hidden><Icon /></span>
                  <span className="fb-file-text">
                    <bdi>{item.name}</bdi><small>{meta}</small>
                    {was && <small className="fb-file-was">كانت في: {was}</small>}
                  </span>
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
                <MoveForm document={item} layout={layout} schools={schools} onCancel={() => setMoving(null)}
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

type MoveProps = { document: DocumentInfo; layout: FolderLayout; schools: SchoolRef[]; onMove: (placement: DocumentPlacement) => Promise<void>; onCancel: () => void };

/** Her folders that hold files, then each school's — only while she has «مدارس المشرفة». */
function MoveForm({ document, layout, schools, onMove, onCancel }: MoveProps) {
  const current = document.folder && isSorted(document, layout, new Set(schools.map(school => school.id)))
    ? encode({ folder: document.folder, schoolId: document.schoolId }) : "";
  const fileFolders = (inSchool: boolean) => layout[inSchool ? "school" : "member"].filter(folder => isFileFolder(layout, folder.key, inSchool));
  const schoolFolders = fileFolders(true);
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
          {fileFolders(false).map(folder => (
            <option key={folder.key} value={encode({ folder: folder.key, schoolId: null })}>{folderTitle(layout, folder.key, false)}</option>
          ))}
        </optgroup>
        {schoolFolders.length > 0 && schools.map(school => (
          <optgroup key={school.id} label={schoolName(school)}>
            {schoolFolders.map(folder => (
              <option key={folder.key} value={encode({ folder: folder.key, schoolId: school.id })}>{folderTitle(layout, folder.key, true)}</option>
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

/**
 * The folders of one school with how many of her files each holds, sub-folders included (her school page links to them).
 * None while she has no «مدارس المشرفة»: her school folders are out of reach then.
 */
export function schoolFolderCounts(documents: DocumentInfo[], schoolId: string, layout: FolderLayout) {
  return topFolders(layout, true).filter(folder => isFileFolder(layout, folder.key, true)).map(folder => {
    const keys = folderFamily(layout, folder.key, true);
    return { ...folder, count: documents.filter(item => item.schoolId === schoolId && keys.includes(item.folder ?? "")).length };
  });
}
