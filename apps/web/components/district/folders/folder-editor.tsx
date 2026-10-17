"use client";

import { schoolsEntry, subfoldersOf, topFolders, type FolderDef, type FolderLayout, type FolderScope } from "@rasd/schemas";
import { ArrowDown, ArrowUp, Eye, EyeOff, Folder, FolderPlus, Pencil, Plus, RotateCcw, School, Trash2 } from "lucide-react";
import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { api, errorText, redirectIfSignedOut } from "../../../lib/api";
import { ar, counted, firstName } from "../../../lib/format";
import { ConfirmDialog, Dialog } from "../dialog";
import { FILES, MEMBERS, layoutSignature, titleKey, type BulkRequest, type BulkResult, type FolderMember, type FolderOp } from "./model";
import "./folders.css";

type Props = {
  /** Whose folders she edits: one member (her profile) or a group with the same folders (the folders page). */
  memberIds: string[];
  /** GET /district/folders, when the caller already has it. */
  initial?: FolderMember[];
  /** After every change, with everyone's folders as they are now. */
  onChanged?: (members: FolderMember[]) => void;
  onClose: () => void;
};

type Results = BulkResult["results"];
type Confirm = { title: string; description: ReactNode; confirmLabel: string; op: FolderOp };

const SCOPES: { id: FolderScope; label: string }[] = [
  { id: "member", label: "مجلداتها" },
  { id: "school", label: "مجلدات كل مدرسة" },
];

/**
 * Edits the folders of one member or a group (POST /district/folders/bulk): rename, reorder, add (sub-)folders, delete and
 * restore, show or hide «مدارس المشرفة». The list shown is the first member's (a group's members all have the same
 * folders). Every change is saved at once for them and for anyone picked in «طبّقي أيضاً على…»; changes address folders
 * by key, so a member who lacks the folder is skipped and named under the list.
 */
export function FolderEditor({ memberIds, initial, onChanged, onClose }: Props) {
  const [members, setMembers] = useState<FolderMember[] | null>(initial ?? null);
  // Everyone's folders as they were when the editor opened: «نفس المجلدات» means the folders she started from.
  const [opened, setOpened] = useState<FolderMember[] | null>(initial ?? null);
  const [loadError, setLoadError] = useState("");
  const [scope, setScope] = useState<FolderScope>("member");
  const [also, setAlso] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<Results>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const notice = useRef<HTMLDivElement>(null);

  // An action far down the list (the add box, a restore) reports above it: bring the message into view.
  useEffect(() => {
    if (error || skipped.length) notice.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error, skipped]);

  const load = useCallback(async () => {
    const { members: fresh } = await api.get<{ members: FolderMember[] }>("/district/folders");
    setMembers(fresh);
    setOpened(current => current ?? fresh);
    changed.current?.(fresh);
  }, []);

  const firstLoad = useCallback(() => {
    setLoadError("");
    load().catch(reason => { if (!redirectIfSignedOut(reason)) setLoadError(errorText(reason)); });
  }, [load]);
  useEffect(() => { if (!initial) firstLoad(); }, [initial, firstLoad]);

  const isTarget = (member: FolderMember) => memberIds.includes(member.memberId);
  const targets = members?.filter(isTarget) ?? [];
  const others = members?.filter(member => !isTarget(member)) ?? [];
  const picks = quickPicks(opened ?? [], isTarget);

  const send = (op: FolderOp, dryRun = false) => {
    const body: BulkRequest = {
      memberIds: [...targets, ...others.filter(member => also.includes(member.memberId))].map(member => member.memberId),
      // «مدارس المشرفة» is one of her own folders, whichever list is on screen.
      scope: op.type === "hide_schools" || op.type === "show_schools" ? "member" : scope,
      dryRun,
      op,
    };
    return api.post<BulkResult>("/district/folders/bulk", body);
  };

  /** Saves one change, names whoever it skipped, and shows the folders as they are now. */
  const apply = async (op: FolderOp) => {
    const result = await send(op);
    setSkipped(result.results.filter(item => item.status === "skipped"));
    await load();
  };

  const guard = async (job: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setSkipped([]);
    try {
      await job();
      return true;
    } catch (reason) {
      if (!redirectIfSignedOut(reason)) setError(errorText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const run = (op: FolderOp) => guard(() => apply(op));

  /** Deleting a folder or hiding «مدارس المشرفة» takes files out of their folders: count them (dry run), then ask. */
  const ask = (op: FolderOp, { title, confirmLabel, ...words }: AskWords) => guard(async () => {
    const preview = await send(op, true);
    const done = preview.results.filter(item => item.status === "done");
    // Nobody left to change (the folders changed elsewhere since they loaded): say why, and show them as they are.
    if (!done.length) {
      setSkipped(preview.results);
      await load();
      return;
    }
    const where = done.length === 1 ? `من ملف ${firstName(done[0].name)}` : `من ملفات ${counted(done.length, MEMBERS)}`;
    setConfirm({ op, title, confirmLabel, description: <Consequence results={done} where={where} {...words} /> });
  });

  const lead = targets[0];
  let body: ReactNode;
  if (loadError) {
    body = (
      <div className="d-load-error">
        <p className="field-error" role="alert">{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={firstLoad}>إعادة المحاولة</button>
      </div>
    );
  } else if (!members) {
    body = <div className="fe-skeleton" aria-label="جارٍ التحميل">{Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton" />)}</div>;
  } else if (!lead) {
    body = <p className="mp-note">لم نجد المشرفة — ربما حُذف حسابها.</p>;
  } else {
    const layout = lead.layout;
    const inSchool = scope === "school";
    const entry = schoolsEntry(layout);
    const count = (key: string) => targets.reduce((sum, member) => sum + (member.counts[scope][key] ?? 0), 0);
    const removed = (layout.removed ?? []).filter(item => item.scope === scope && item.kind !== "schools");
    const known = [...layout[scope], ...removed];
    const removedTitle = (folder: FolderDef) => {
      const parent = folder.parent ? known.find(item => item.key === folder.parent) : undefined;
      return parent ? `${parent.label} › ${folder.label}` : folder.label;
    };

    const reorder = (folder: FolderDef, step: -1 | 1) => {
      const keys = layout[scope].filter(item => (item.parent ?? null) === (folder.parent ?? null)).map(item => item.key);
      const from = keys.indexOf(folder.key);
      [keys[from], keys[from + step]] = [keys[from + step], keys[from]];
      void run({ type: "order", parentKey: folder.parent ?? null, keys });
    };

    const remove = (folder: FolderDef) => {
      if (folder.kind === "schools") {
        void ask({ type: "hide_schools" }, {
          title: `إخفاء «${folder.label}»؟`, confirmLabel: "إخفاء",
          text: where => `تختفي مجلدات المدارس ${where}، ولا يمكن رفع ملفات فيها حتى تُظهريها.`,
          none: "لا توجد ملفات في مجلدات المدارس.", undo: "إن أظهرتِها",
        });
        return;
      }
      const subs = subfoldersOf(layout, folder.key, inSchool).length > 0;
      void ask({ type: "delete", key: folder.key }, {
        title: `حذف مجلد «${folder.label}»؟`, confirmLabel: "حذف المجلد",
        text: where => `سيُحذف${subs ? " مع مجلداته الفرعية" : ""} ${where}${inSchool ? " (من كل مدرسة)" : ""}.`,
        none: "لا توجد فيه ملفات.", undo: "إن استعدتِه من «المحذوفة مؤخراً»",
      });
    };

    const row = (folder: FolderDef, siblings: readonly FolderDef[], index: number) => (
      <FolderRow
        folder={folder}
        count={count(folder.key)}
        first={index === 0}
        last={index === siblings.length - 1}
        busy={busy}
        open={open === folder.key}
        onToggle={() => setOpen(key => (key === folder.key ? null : folder.key))}
        onMove={step => reorder(folder, step)}
        onRename={label => run({ type: "rename", key: folder.key, label })}
        onAddSub={!folder.parent && folder.kind !== "schools" ? label => run({ type: "add", label, parentKey: folder.key }) : undefined}
        onRemove={() => remove(folder)}
      />
    );
    const tops = topFolders(layout, inSchool);

    body = (
      <>
        <div className="fe-scopes" role="radiogroup" aria-label="المجلدات المعروضة">
          {SCOPES.map(item => (
            <label key={item.id} className={`chip ${scope === item.id ? "is-active" : ""}`}>
              <input type="radio" name="fe-scope" className="sr-only" checked={scope === item.id} onChange={() => { setScope(item.id); setOpen(null); }} />
              {item.label}
            </label>
          ))}
        </div>

        {others.length > 0 && <AlsoPicker others={others} picks={picks} value={also} onChange={setAlso} />}

        <div ref={notice}>
          {error && <p className="field-error" role="alert">{error}</p>}
          {skipped.length > 0 && (
            <div className="fe-skipped" role="status">
              <b>لم يُطبّق عند {counted(skipped.length, MEMBERS)}:</b>
              <ul>{skipped.map(item => <li key={item.memberId}>{item.name}: {item.note ?? "تعذّر التطبيق"}</li>)}</ul>
            </div>
          )}
        </div>
        {inSchool && !entry && <p className="fe-note">«مدارس المشرفة» مخفية، فلا تظهر هذه المجلدات حتى تُظهريها من «مجلداتها».</p>}
        <p className="fe-note">اضغطي اسم المجلد لتغيير اسمه أو حذفه، والأسهم لترتيبه.</p>

        <ul className="fe-list">
          {tops.map((folder, index) => {
            const subs = subfoldersOf(layout, folder.key, inSchool);
            return (
              <li key={folder.key}>
                {row(folder, tops, index)}
                {subs.length > 0 && <ul className="fe-subs">{subs.map((sub, subIndex) => <li key={sub.key}>{row(sub, subs, subIndex)}</li>)}</ul>}
              </li>
            );
          })}
        </ul>
        {!inSchool && !entry && (
          <div className="fe-row fe-hidden">
            <div className="fe-row-main">
              <span className="fe-icon" aria-hidden><School /></span>
              <span className="fe-label"><b>{hiddenSchoolsLabel(layout)}</b><small>مخفية — لا تظهر مجلدات المدارس</small></span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run({ type: "show_schools" })}><Eye aria-hidden /> إظهار</button>
            </div>
          </div>
        )}

        <LabelForm
          hint={inSchool ? "مجلد جديد في كل مدرسة" : "مجلد جديد"}
          submitLabel="إضافة"
          icon={<Plus aria-hidden />}
          busy={busy}
          onSubmit={label => run({ type: "add", label, parentKey: null })}
        />

        {removed.length > 0 && (
          <details className="fe-removed">
            <summary>المحذوفة مؤخراً ({ar(removed.length)})</summary>
            <ul>
              {removed.map(folder => (
                <li key={folder.key}>
                  <span>{removedTitle(folder)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run({ type: "restore", key: folder.key })}>
                    <RotateCcw aria-hidden /> استعادة
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }

  if (confirm) {
    return (
      <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} danger
        onConfirm={() => apply(confirm.op)} onClose={() => setConfirm(null)} />
    );
  }

  return (
    <Dialog
      title="تعديل المجلدات"
      description={targets.length ? whose(targets) : undefined}
      onClose={onClose}
      footer={<>
        {busy && <span className="fe-saving" role="status"><span className="spinner" /> جارٍ الحفظ…</span>}
        <button type="button" className="btn btn-primary" onClick={onClose}>تم</button>
      </>}
    >
      {body}
    </Dialog>
  );
}

/** «الكل», «نفس الصفة», «نفس المجلدات» (as everyone's folders were when the editor opened), each only when it names someone. */
function quickPicks(members: FolderMember[], isTarget: (member: FolderMember) => boolean) {
  const lead = members.find(isTarget);
  const titles = new Set(members.filter(isTarget).map(member => titleKey(member.title)).filter(Boolean));
  const ids = (test: (member: FolderMember) => boolean) => members.filter(member => !isTarget(member) && test(member)).map(member => member.memberId);
  return [
    { label: "الكل", ids: ids(() => true) },
    { label: "نفس الصفة", ids: ids(member => titles.has(titleKey(member.title))) },
    { label: "نفس المجلدات", ids: lead ? ids(member => layoutSignature(member.layout) === layoutSignature(lead.layout)) : [] },
  ].filter(pick => pick.ids.length);
}

const OTHERS = { one: "واحدة أخرى", two: "اثنتان أخريان", few: "أخريات", many: "أخرى" };

/** «عند نورة العتيبي» · «عند ٥ مشرفات: نورة، سارة، هند واثنتان أخريان». */
function whose(targets: FolderMember[]) {
  const shown = targets.slice(0, 3).map(member => member.name).join("، ");
  const rest = targets.length > 3 ? ` و${counted(targets.length - 3, OTHERS)}` : "";
  const names = targets.length === 1 ? targets[0].name : `${counted(targets.length, MEMBERS)}: ${shown}${rest}`;
  return `مجلدات ملف الإنجاز عند ${names}. كل تعديل يُحفظ فوراً.`;
}

/** The name «مدارس المشرفة» had when it was hidden. */
const hiddenSchoolsLabel = (layout: FolderLayout) => layout.removed?.find(item => item.kind === "schools")?.label ?? "مدارس المشرفة";

/** `text(where)`: what happens («… من ملف نورة») · `none`: when no file is affected · `undo`: how her files come back. */
type AskWords = { title: string; confirmLabel: string; text: (where: string) => string; none: string; undo: string };

/** What a delete or hide does, with the files it takes out of their folders (per member when several). */
function Consequence({ results, where, text, none, undo }: Omit<AskWords, "title" | "confirmLabel"> & { results: Results; where: string }) {
  const moving = results.filter(item => item.filesToUnsorted);
  const total = moving.reduce((sum, item) => sum + item.filesToUnsorted!, 0);
  const each = results.length > 1 && moving.length ? ` (${moving.map(item => `${firstName(item.name)}: ${ar(item.filesToUnsorted!)}`).join("، ")})` : "";
  return (
    <>
      <p>{text(where)}</p>
      {total ? <p className="fe-warn">سينتقل {counted(total, FILES)} إلى «غير مصنّفة»{each}.</p> : <p>{none}</p>}
      {total > 0 && <p>الملفات لا تُحذف، وتعود إلى مكانها {undo}.</p>}
    </>
  );
}

type RowProps = {
  folder: FolderDef; count: number; first: boolean; last: boolean; busy: boolean; open: boolean;
  onToggle: () => void;
  onMove: (step: -1 | 1) => void;
  onRename: (label: string) => Promise<boolean>;
  /** Top-level folders that hold files may open sub-folders (one level). */
  onAddSub?: (label: string) => Promise<boolean>;
  onRemove: () => void;
};

/** One folder: tap the name for its actions; ↑/↓ always there (no dragging, so it works the same on a phone). */
function FolderRow({ folder, count, first, last, busy, open, onToggle, onMove, onRename, onAddSub, onRemove }: RowProps) {
  const [mode, setMode] = useState<"rename" | "sub" | null>(null);
  const schools = folder.kind === "schools";
  const Icon = schools ? School : Folder;
  return (
    <div className={`fe-row${open ? " is-open" : ""}`}>
      <div className="fe-row-main">
        <span className="fe-icon" aria-hidden><Icon /></span>
        {mode === "rename" ? (
          <LabelForm hint="الاسم الجديد" initial={folder.label} submitLabel="حفظ" busy={busy} onSubmit={onRename} onDone={() => setMode(null)} />
        ) : (
          <button type="button" className="fe-label" onClick={onToggle} aria-expanded={open}>
            <b>{folder.label}</b>
            {(count > 0 || schools) && <small>{schools ? "تفتح مدارسها، ولكل مدرسة مجلداتها" : counted(count, FILES)}</small>}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" disabled={busy || first} onClick={() => onMove(-1)} aria-label={`تقديم «${folder.label}»`} title="تقديم">
          <ArrowUp aria-hidden />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" disabled={busy || last} onClick={() => onMove(1)} aria-label={`تأخير «${folder.label}»`} title="تأخير">
          <ArrowDown aria-hidden />
        </button>
      </div>
      {open && !mode && (
        <div className="fe-row-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode("rename")}><Pencil aria-hidden /> إعادة تسمية</button>
          {onAddSub && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode("sub")}><FolderPlus aria-hidden /> مجلد فرعي</button>}
          <button type="button" className="btn btn-ghost btn-sm fe-danger" disabled={busy} onClick={onRemove}>
            {schools ? <><EyeOff aria-hidden /> إخفاء</> : <><Trash2 aria-hidden /> حذف</>}
          </button>
        </div>
      )}
      {mode === "sub" && onAddSub && (
        <LabelForm hint={`مجلد فرعي في «${folder.label}»`} submitLabel="إضافة" icon={<Plus aria-hidden />} busy={busy} onSubmit={onAddSub} onDone={() => setMode(null)} />
      )}
    </div>
  );
}

type LabelFormProps = {
  /** Says what to type (placeholder and the input's label). */
  hint: string; initial?: string; submitLabel: string; icon?: ReactNode; busy: boolean;
  onSubmit: (label: string) => Promise<boolean>;
  /** An inline edit closes when saved or cancelled; without it the form stays and empties after saving. */
  onDone?: () => void;
};

function LabelForm({ hint, initial = "", submitLabel, icon, busy, onSubmit, onDone }: LabelFormProps) {
  const id = useId();
  const [label, setLabel] = useState(initial);
  const clean = label.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!clean || clean === initial) { onDone?.(); return; }
    if (!(await onSubmit(clean))) return;
    if (onDone) onDone();
    else setLabel("");
  };
  // Escape cancels the edit only: the editor dialog stays open.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !onDone) return;
    event.nativeEvent.stopImmediatePropagation();
    onDone();
  };

  return (
    <form className="fe-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>{hint}</label>
      <input id={id} className="input" value={label} onChange={event => setLabel(event.target.value)} onKeyDown={onKey}
        placeholder={hint} maxLength={200} autoFocus={Boolean(onDone)} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !clean}>{icon}{submitLabel}</button>
      {onDone && <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>إلغاء</button>}
    </form>
  );
}

type AlsoProps = { others: FolderMember[]; picks: { label: string; ids: string[] }[]; value: string[]; onChange: (ids: string[]) => void };

/** «طبّقي أيضاً على…»: the same change for other members, picked one by one or by a quick pick. */
function AlsoPicker({ others, picks, value, onChange }: AlsoProps) {
  const same = (ids: string[]) => ids.length === value.length && ids.every(id => value.includes(id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  return (
    <details className="fe-also">
      <summary>
        <span>طبّقي أيضاً على…</span>
        {value.length > 0 && <span className="pill pill-brand">{counted(value.length, MEMBERS)}</span>}
      </summary>
      <div className="fe-also-body">
        <p className="fe-note">كل تعديل بعدها يُطبّق عليهن أيضاً، ومن ليس عندها المجلد نفسه يُذكر اسمها تحت القائمة.</p>
        {picks.length > 0 && (
          <div className="fe-picks" role="group" aria-label="اختيار سريع">
            {picks.map(pick => (
              <button key={pick.label} type="button" className={`chip ${same(pick.ids) ? "is-active" : ""}`} aria-pressed={same(pick.ids)}
                onClick={() => onChange(same(pick.ids) ? [] : pick.ids)}>
                {pick.label} ({ar(pick.ids.length)})
              </button>
            ))}
          </div>
        )}
        <ul className="fe-also-list">
          {others.map(member => (
            <li key={member.memberId}>
              <label>
                <input type="checkbox" checked={value.includes(member.memberId)} onChange={() => toggle(member.memberId)} />
                <span><b>{member.name}</b>{member.title && <small>{member.title}</small>}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
