"use client";

import { toWesternDigits, type KpiImportResult } from "@rasd/schemas";
import { FileSpreadsheet, History, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../../../lib/api";
import { ar, counted, relativeTime } from "../../../lib/format";
import { Dialog } from "../dialog";
import { SCHOOLS, scoreText, type KpiImportEntry, type KpiMember } from "./model";

type Mode = KpiImportResult["mode"];
type Props = { file: File; members: KpiMember[]; onPickAnother: () => void; onClose: () => void; onApplied: (result: KpiImportResult) => void };

const NOT_MINE = "none";
const ROWS = { one: "صف واحد", two: "صفان", few: "صفوف", many: "صفاً" };
const NAME_STATUS: Partial<Record<KpiImportResult["names"][number]["status"], string>> = {
  ambiguous: "أكثر من مشرفة بهذا الاسم — اختاري",
  unknown: "لم نجدها في فريقك — اختاري",
};

/** The options as the server reads them; `null` = let the file decide (its own year, every register sheet). */
const optionsKey = (mode: Mode, year: string | null, sheets: string[] | null, names: Record<string, string | null>) =>
  JSON.stringify({ mode, year, sheets, names });

/**
 * «استيراد من Excel»: the file is read on the server without saving (dryRun) and every change of an option reads it
 * again, so what she sees is what «استيراد» does. Applying sends the same file, options and her name choices.
 */
export function ImportDialog({ file, members, onPickAnother, onClose, onApplied }: Props) {
  const [preview, setPreview] = useState<KpiImportResult | null>(null);
  const [mode, setMode] = useState<Mode>("merge");
  const [year, setYear] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[] | null>(null);
  // Her choice for a name in the sheet: a member id, or null for «ليست من فريقي» (saved for the next import).
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [removalSeen, setRemovalSeen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>("preview");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  /** The options the shown preview answers (with the file's own year and sheets filled in). */
  const answered = useRef("");
  const latest = useRef(0);

  const fields = (dryRun: boolean): Record<string, string> => ({
    dryRun: String(dryRun),
    mode,
    ...(year === null ? {} : { year }),
    ...(sheets === null ? {} : { sheets: JSON.stringify(sheets) }),
    ...(Object.keys(names).length ? { names: JSON.stringify(names) } : {}),
  });

  const key = optionsKey(mode, year, sheets, names);
  useEffect(() => {
    const request = ++latest.current; // an older answer still on its way is ignored
    if (key === answered.current) { setBusy(null); return; }
    setBusy("preview");
    // Typing a year waits for a pause; the first read starts at once.
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.upload<KpiImportResult>("/district/kpis/import", [file], fields(true));
        if (request !== latest.current) return;
        const nextYear = year ?? result.year;
        const nextSheets = sheets ?? result.sheets.filter(sheet => sheet.included).map(sheet => sheet.name);
        answered.current = optionsKey(mode, nextYear, nextSheets, names);
        setYear(nextYear);
        setSheets(nextSheets);
        setPreview(result);
        setError("");
      } catch (reason) {
        if (request === latest.current) setError(errorText(reason));
      } finally {
        if (request === latest.current) setBusy(null);
      }
    }, answered.current ? 450 : 0);
    return () => window.clearTimeout(timer);
  }, [file, key, attempt]); // `key` stands for mode, year, sheets and names

  // A different list of schools to remove has to be seen again.
  useEffect(() => { setRemovalSeen(false); }, [preview?.removed, mode]);

  const apply = async () => {
    setBusy("apply");
    setError("");
    try {
      onApplied(await api.upload<KpiImportResult>("/district/kpis/import", [file], fields(false)));
    } catch (reason) {
      setError(errorText(reason));
      setBusy(null);
    }
  };

  const toggleSheet = (name: string, on: boolean) =>
    setSheets(current => preview!.sheets.map(sheet => sheet.name).filter(item => (item === name ? on : current?.includes(item))));
  const nameValue = (entry: KpiImportResult["names"][number]) =>
    entry.name in names ? names[entry.name] ?? NOT_MINE : entry.memberId ?? "";

  const removing = mode === "replace" && Boolean(preview?.removed);
  const changes = preview ? preview.added + preview.updated + preview.removed : 0;
  const ready = Boolean(preview) && busy === null && !error && changes > 0 && (!removing || removalSeen);

  return (
    <Dialog
      title="استيراد مؤشرات الأداء"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy === "apply"}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={!ready}>
          {busy === "apply" ? <span className="spinner spinner-light" /> : <Upload />}
          {preview && !changes && busy === null ? "لا جديد في الملف" : "استيراد"}
        </button>
      </>}
    >
      <p className="kp-imp-file">
        <FileSpreadsheet aria-hidden />
        <bdi>{file.name}</bdi>
        <button type="button" className="kp-link-btn" onClick={onPickAnother} disabled={busy === "apply"}>ملف آخر</button>
      </p>

      {!preview && busy === "preview" && <p className="kp-imp-wait"><span className="spinner" /> نقرأ الملف…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {error && !preview && busy === null && (
        <button type="button" className="btn btn-secondary kp-retry" onClick={() => setAttempt(count => count + 1)}><RefreshCw /> إعادة المحاولة</button>
      )}

      {preview && (
        // While it is applied nothing may change under her finger: the import runs with what was on screen.
        <div className={`kp-imp ${busy === "preview" ? "is-stale" : ""}`} aria-busy={busy === "preview"} inert={busy === "apply"}>
          {preview.sheets.length > 1 && (
            <fieldset className="kp-imp-group">
              <legend>الأوراق</legend>
              {preview.sheets.map(sheet => (
                <label key={sheet.name} className="kp-check">
                  <input type="checkbox" checked={Boolean(sheets?.includes(sheet.name))} onChange={event => toggleSheet(sheet.name, event.target.checked)}
                    disabled={sheets?.length === 1 && sheets[0] === sheet.name} />
                  <span><bdi>{sheet.name}</bdi> <small>{counted(sheet.rows, SCHOOLS)}</small></span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="blk-stats-grid">
            <Stat label="ستُضاف" value={preview.added} />
            <Stat label="ستُحدّث" value={preview.updated} />
            <Stat label="بلا تغيير" value={preview.unchanged} />
            {mode === "replace" && <Stat label="ستُحذف" value={preview.removed} tone={preview.removed ? "bad" : undefined} />}
          </div>

          {preview.sample.length > 0 && (
            <section className="kp-imp-group">
              <h3>عينة مما قُرئ</h3>
              <ul className="kp-imp-sample">
                {preview.sample.slice(0, 5).map((row, index) => (
                  <li key={index}>
                    <span><b>{row.schoolName}</b>{row.ministryNo && <small dir="ltr">{row.ministryNo}</small>}</span>
                    <span>المستوى العام {scoreText(row.overallScore)}</span>
                    <small>{row.memberName || "—"}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview.names.length > 0 && (
            <section className="kp-imp-group">
              <h3>أسماء المشرفات في الملف</h3>
              <ul className="kp-imp-names">
                {preview.names.map(entry => (
                  <li key={entry.name}>
                    <span className="kp-imp-name">
                      <b>{entry.name}</b>
                      <small>{counted(entry.count, SCHOOLS)}{!(entry.name in names) && NAME_STATUS[entry.status] ? ` · ${NAME_STATUS[entry.status]}` : ""}</small>
                    </span>
                    <select className="input" value={nameValue(entry)} aria-label={`مشرفة «${entry.name}»`}
                      onChange={event => event.target.value && setNames(current => ({ ...current, [entry.name]: event.target.value === NOT_MINE ? null : event.target.value }))}>
                      {nameValue(entry) === "" && <option value="">اختاري…</option>}
                      {members.map(member => <option key={member.memberId} value={member.memberId}>{member.name}</option>)}
                      <option value={NOT_MINE}>ليست من فريقي</option>
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview.skipped.length > 0 && (
            <details className="kp-imp-group kp-imp-skipped">
              <summary>تُرك {counted(preview.skipped.length, ROWS)} لم تُفهم</summary>
              <ul>
                {preview.skipped.map((item, index) => <li key={index}><bdi>{item.sheet}</bdi> · الصف {ar(item.row)}: {item.reason}</li>)}
              </ul>
            </details>
          )}

          <fieldset className="kp-imp-group">
            <legend>طريقة الاستيراد</legend>
            <label className="kp-check">
              <input type="radio" name="kpi-mode" checked={mode === "merge"} onChange={() => setMode("merge")} />
              <span>تحديث المدارس الموجودة وإضافة الجديدة (لا يُحذف شيء)</span>
            </label>
            <label className="kp-check">
              <input type="radio" name="kpi-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
              <span>استبدال سجل العام بهذا الملف</span>
            </label>
          </fieldset>

          <label className="field kp-imp-year">
            <span className="field-label">العام</span>
            <input className="input" inputMode="numeric" maxLength={4} value={year ?? ""} placeholder="مثال: ١٤٤٧"
              onChange={event => setYear(toWesternDigits(event.target.value).replace(/\D/g, ""))} />
          </label>

          {removing && (
            <div className="kp-imp-warn">
              <label className="kp-check">
                <input type="checkbox" checked={removalSeen} onChange={event => setRemovalSeen(event.target.checked)} />
                <span>سيُحذف من سجل العام {counted(preview.removed, SCHOOLS)} ليست في هذا الملف (المدارس المضافة يدوياً تبقى)</span>
              </label>
              <ul>{preview.removedNames.map(name => <li key={name}>{name}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className={`blk-stat ${tone ? `tone-${tone}` : ""}`}>
      <span className="blk-stat-label">{label}</span>
      <b className="blk-stat-value">{ar(value)}</b>
    </div>
  );
}

const MODE_LABELS: Record<Mode, string> = { merge: "تحديث وإضافة", replace: "استبدال" };

/** «آخر عمليات الاستيراد»: read when she opens it (and again after an import or an undo). */
export function ImportHistory({ refresh, onUndo }: { refresh: number; onUndo: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<KpiImportEntry[] | null>(null);
  const [error, setError] = useState("");
  const [undoing, setUndoing] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.get<KpiImportEntry[]>("/district/kpis/imports")
      .then(list => { setEntries(list); setError(""); })
      .catch(reason => setError(errorText(reason)));
  }, [open, refresh]);

  const undo = async (id: string) => {
    setUndoing(id);
    await onUndo(id);
    setUndoing(null);
  };

  return (
    <details className="d-invitations kp-history" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><History aria-hidden /> آخر عمليات الاستيراد</summary>
      {error && <p className="field-error">{error}</p>}
      {!entries && !error && <p className="kp-imp-wait"><span className="spinner" /></p>}
      {entries && !entries.length && <p className="kp-empty-line">لم يُستورد ملف بعد.</p>}
      {entries && entries.length > 0 && (
        <ul>
          {entries.map(entry => {
            const counts = [
              entry.summary.added && `أُضيفت ${ar(entry.summary.added)}`,
              entry.summary.updated && `حُدّثت ${ar(entry.summary.updated)}`,
              entry.summary.removed && `حُذفت ${ar(entry.summary.removed)}`,
            ].filter(Boolean).join("، ");
            return (
              <li key={entry.id}>
                <span className="d-member-id">
                  <b><bdi>{entry.fileName}</bdi></b>
                  <small>{[relativeTime(entry.createdAt), entry.year && `العام ${ar(entry.year)}`, MODE_LABELS[entry.mode], counts].filter(Boolean).join("، ")}</small>
                </span>
                {entry.undoneAt
                  ? <span className="pill">تم التراجع</span>
                  : entry.canUndo && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void undo(entry.id)} disabled={undoing !== null}>
                      {undoing === entry.id && <span className="spinner" />}تراجع
                    </button>
                  )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
