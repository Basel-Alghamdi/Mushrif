"use client";

import { KPI_LEVELS, type KpiImportResult, type SchoolKpi } from "@rasd/schemas";
import { Check, ChevronLeft, CircleAlert, Download, FileSpreadsheet, ListChecks, Plus, RefreshCw, Search, Upload, UserRound, X } from "lucide-react";
import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadFile, errorText, redirectIfSignedOut } from "../../../lib/api";
import { ar, counted } from "../../../lib/format";
import { useToast } from "../toast";
import { ImportDialog, ImportHistory } from "./import-dialog";
import { KpiEditor } from "./kpi-editor";
import { LevelChip } from "./kpi-view";
import { levelPill, matchesQuery, SCHOOLS, severeCount, type KpiMember, type KpiRegister } from "./model";

type View = "" | "unassigned" | "severe" | "missing";
type Filters = { q: string; memberId: string; level: string; stage: string; evaluationType: string; view: View };
type Missing = KpiRegister["summary"]["memberSchoolsMissing"][number];

const NO_FILTERS: Filters = { q: "", memberId: "", level: "", stage: "", evaluationType: "", view: "" };
const NO_LEVEL = "none";
const NO_MEMBER = "none";
const LEVEL_FILTERS = [{ id: "", label: "كل المستويات" }, ...KPI_LEVELS.map(level => ({ id: level, label: level })), { id: NO_LEVEL, label: "بلا مستوى" }];

const ownerNames = (row: SchoolKpi) => row.owners.map(owner => owner.name).join("، ");
const distinct = (rows: SchoolKpi[], pick: (row: SchoolKpi) => string) =>
  [...new Set(rows.map(row => pick(row).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));

function passes(row: SchoolKpi, filters: Filters) {
  return matchesQuery(row, filters.q)
    && (!filters.memberId || row.owners.some(owner => owner.memberId === filters.memberId))
    && (!filters.level || (filters.level === NO_LEVEL ? !row.overallLevel : row.overallLevel === filters.level))
    && (!filters.stage || row.stage.trim() === filters.stage)
    && (!filters.evaluationType || row.evaluationType.trim() === filters.evaluationType)
    && (filters.view !== "unassigned" || !row.owners.length)
    && (filters.view !== "severe" || severeCount(row) > 0);
}

type Editing = { row: SchoolKpi | null; preset?: Record<string, string> };

/**
 * /district/kpis: the district register of مؤشرات الأداء. What needs her attention first (schools without a مشرفة,
 * members' schools missing from the register, schools needing severe support), then each مشرفة, then the schools.
 * Filters run on the loaded year, so every tap answers at once.
 */
export function KpisPage({ initialQuery }: { initialQuery: string }) {
  const toast = useToast();
  const [register, setRegister] = useState<KpiRegister | null>(null);
  const [error, setError] = useState("");
  /** The year asked for; "" = the latest (the server's default). */
  const [year, setYear] = useState("");
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, q: initialQuery });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState<{ file: File; id: number } | null>(null);
  /** The rows ticked for «إسناد إلى مشرفة»; null while she is not choosing. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRegister(await api.get<KpiRegister>(`/district/kpis${year ? `?year=${encodeURIComponent(year)}` : ""}`));
      setError("");
    } catch (reason) {
      if (!redirectIfSignedOut(reason)) setError(errorText(reason));
    }
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => register?.rows ?? [], [register]);
  const visible = useMemo(() => rows.filter(row => passes(row, filters)), [rows, filters]);
  // The summary counts the same way the filters test, so a tile's number is what a tap on it shows.
  const summary = register?.summary;
  const members = useMemo(() => summary?.perMember ?? [], [summary]);
  const missing = useMemo(() => summary?.memberSchoolsMissing ?? [], [summary]);
  const stages = useMemo(() => distinct(rows, row => row.stage), [rows]);
  const types = useMemo(() => distinct(rows, row => row.evaluationType), [rows]);
  const people = useMemo(() => [...members].sort((a, b) => Number(b.rows > 0) - Number(a.rows > 0)), [members]);

  const setFilter = (change: Partial<Filters>) => setFilters(current => ({ ...current, ...change }));
  const toggleView = (view: View) => setFilter({ view: filters.view === view ? "" : view });
  const filtered = Object.values(filters).some(Boolean);

  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const open = (row: SchoolKpi) => (selected ? toggle(row.id) : setEditing({ row }));

  const assign = async (memberId: string | null) => {
    const ids = [...(selected ?? [])];
    await api.post("/district/kpis/assign", { ids, memberId });
    const name = members.find(member => member.memberId === memberId)?.name;
    toast(name ? `أُسندت ${counted(ids.length, SCHOOLS)} إلى ${name}` : `أصبحت ${counted(ids.length, SCHOOLS)} بلا مشرفة`);
    setSelected(null);
    await load();
  };

  const restore = async (row: SchoolKpi) => {
    try {
      await api.post(`/district/kpis/${row.id}/restore`);
      toast("أُعيدت المدرسة إلى السجل");
      await load();
    } catch (reason) {
      toast(errorText(reason));
    }
  };

  const undoImport = useCallback(async (id: string) => {
    try {
      await api.post(`/district/kpis/imports/${id}/undo`);
      toast("تم التراجع عن الاستيراد");
      setHistoryVersion(version => version + 1);
      await load();
    } catch (reason) {
      toast(errorText(reason));
    }
  }, [load, toast]);

  const pickFile = () => fileInput.current?.click();
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // so the same file can be chosen again
    if (file) setImporting({ file, id: Date.now() });
  };

  const imported = (result: KpiImportResult) => {
    setImporting(null);
    setHistoryVersion(version => version + 1);
    // Show the year the file went into.
    if (result.year === year) void load();
    else setYear(result.year);
    const done = [
      result.added && `أُضيفت ${ar(result.added)}`, result.updated && `حُدّثت ${ar(result.updated)}`, result.removed && `حُذفت ${ar(result.removed)}`,
    ].filter(Boolean).join("، ");
    toast(`استُورد الملف${done ? `: ${done}` : ""}`, result.importId ? { label: "تراجع", run: () => void undoImport(result.importId!) } : undefined);
  };

  // The file holds the rows on screen: the server applies the same filters.
  const exportExcel = async () => {
    if (!register) return;
    const params = new URLSearchParams(Object.entries({
      year: register.year, memberId: filters.memberId, level: filters.level, q: filters.q.trim(), stage: filters.stage, evaluationType: filters.evaluationType,
      unassigned: filters.view === "unassigned" ? "1" : "", severe: filters.view === "severe" ? "1" : "",
    }).filter(([, value]) => value));
    setExporting(true);
    try {
      await downloadFile(`/district/kpis/export?${params}`, `مؤشرات الأداء${register.year ? ` ${register.year}` : ""}.xlsx`);
    } catch (reason) {
      toast(errorText(reason));
    } finally {
      setExporting(false);
    }
  };

  const addSchool = (preset: Record<string, string> = {}) => setEditing({ row: null, preset: { year: register?.year ?? "", ...preset } });
  const empty = register !== null && !rows.length && !year;

  return (
    <div className="d-page kp-page">
      <header className="d-page-head kp-page-head">
        <div className="kp-title">
          <h1>مؤشرات الأداء</h1>
          <p>سجل التقويم المدرسي لمدارس النطاق؛ تظهر مؤشرات كل مدرسة للمشرفة المسؤولة عنها في مدارسها.</p>
        </div>
        {register && !empty && (
          <div className="kp-actions">
            {register.years.length > 1 && (
              <select className="input kp-year" value={register.year} aria-label="العام" onChange={event => { setSelected(null); setYear(event.target.value); }}>
                {register.years.map(item => <option key={item} value={item}>{item ? `العام ${ar(item)}` : "بلا عام"}</option>)}
              </select>
            )}
            <button className="btn btn-primary btn-sm" onClick={pickFile}><Upload /> استيراد من Excel</button>
            <button className="btn btn-secondary btn-sm" onClick={() => void exportExcel()} disabled={exporting}>
              {exporting ? <span className="spinner" /> : <Download />} تصدير Excel
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => addSchool()}><Plus /> إضافة مدرسة</button>
          </div>
        )}
      </header>
      <input ref={fileInput} type="file" accept=".xlsx,.xls,.xlsm" hidden onChange={chooseFile} />

      {error && !register && (
        <div className="empty">
          <CircleAlert />
          <b>تعذّر تحميل المؤشرات</b>
          <span>{error}</span>
          <button className="btn btn-primary" onClick={() => void load()}><RefreshCw /> إعادة المحاولة</button>
        </div>
      )}
      {error && register && (
        <p className="field-error kp-load-error" role="alert">{error} <button className="kp-link-btn" onClick={() => void load()}>إعادة المحاولة</button></p>
      )}
      {!register && !error && <KpisSkeleton />}

      {empty && (
        <div className="empty kp-empty">
          <FileSpreadsheet />
          <b>سجل مؤشرات الأداء فارغ</b>
          <span>ارفعي الملف كما يصلك؛ تعرض لك الصفحة ما قرأته منه قبل أن يُحفظ شيء.</span>
          <button className="btn btn-primary btn-lg" onClick={pickFile}><Upload /> ارفعي ملف المؤشرات (Excel)</button>
          <button className="btn btn-secondary" onClick={() => addSchool()}><Plus /> إضافة مدرسة يدوياً</button>
        </div>
      )}

      {register && summary && !empty && (
        <>
          <section className="kp-tiles" aria-label="ما يحتاج انتباهك">
            <Tile label="مدارس بلا مشرفة" value={summary.unassigned} tone={summary.unassigned ? "warn" : "ok"} active={filters.view === "unassigned"}
              onClick={() => toggleView("unassigned")} />
            <Tile label="مدارس المشرفات غير الموجودة في السجل" value={missing.length} tone={missing.length ? "warn" : "ok"} active={filters.view === "missing"}
              onClick={() => toggleView("missing")} />
            <Tile label="مدارس تحتاج دعماً شديداً" value={summary.severe} tone={summary.severe ? "bad" : "ok"} active={filters.view === "severe"}
              onClick={() => toggleView("severe")} />
          </section>

          {people.length > 0 && (
            <details className="kp-people" open>
              <summary>حسب المشرفة</summary>
              <ul>
                {people.map(person => {
                  const active = filters.memberId === person.memberId;
                  return (
                    <li key={person.memberId} className={`kp-person ${active ? "is-active" : ""} ${person.rows ? "" : "is-empty"}`}>
                      <button type="button" aria-pressed={active} onClick={() => setFilter({ memberId: active ? "" : person.memberId })}>
                        <b>{person.name}</b>
                        <small>{person.rows ? counted(person.rows, SCHOOLS) : "لا مدارس لها في السجل"}</small>
                        {(person.tahyia > 0 || person.intilaq > 0 || person.severeStandards > 0) && (
                          <span className="kp-person-stats">
                            {person.tahyia > 0 && <span className={`pill ${levelPill("تهيئة")}`}>تهيئة {ar(person.tahyia)}</span>}
                            {person.intilaq > 0 && <span className={`pill ${levelPill("انطلاق")}`}>انطلاق {ar(person.intilaq)}</span>}
                            {person.severeStandards > 0 && <span className="pill pill-bad">معايير شديدة {ar(person.severeStandards)}</span>}
                          </span>
                        )}
                      </button>
                      <Link href={`/district/team/${person.memberId}`} className="kp-person-link" aria-label={`ملف ${person.name}`} title="ملفها"><UserRound /></Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <div className="kp-tools">
            <label className="d-search kp-search">
              <Search aria-hidden />
              <span className="sr-only">ابحثي عن مدرسة</span>
              <input type="search" placeholder="ابحثي بالمدرسة أو رقمها الوزاري أو المشرفة" value={filters.q} onChange={event => setFilter({ q: event.target.value })} />
            </label>
            <div className="d-filter-chips" role="group" aria-label="تصفية">
              {LEVEL_FILTERS.map(item => (
                <button key={item.id} className={`chip ${filters.level === item.id ? "is-active" : ""}`} aria-pressed={filters.level === item.id} onClick={() => setFilter({ level: item.id })}>
                  {item.label}
                </button>
              ))}
              <ChipSelect label="المشرفة" all="كل المشرفات" value={filters.memberId} onChange={memberId => setFilter({ memberId })}
                options={members.map(member => ({ value: member.memberId, label: member.name }))} />
              {stages.length > 1 && (
                <ChipSelect label="المرحلة" all="كل المراحل" value={filters.stage} onChange={stage => setFilter({ stage })} options={stages.map(value => ({ value, label: value }))} />
              )}
              {types.length > 1 && (
                <ChipSelect label="نوع التقويم" all="كل أنواع التقويم" value={filters.evaluationType} onChange={evaluationType => setFilter({ evaluationType })}
                  options={types.map(value => ({ value, label: value }))} />
              )}
            </div>
          </div>

          {filters.view === "missing" ? (
            <MissingList items={missing.filter(item => !filters.memberId || item.memberId === filters.memberId)}
              onAdd={item => addSchool({ schoolName: item.schoolName, ministryNo: item.ministryNo, assignedMemberId: item.memberId })} />
          ) : (
            <>
              <div className="kp-list-head">
                <span>{counted(visible.length, SCHOOLS)}{filtered && ` من ${ar(rows.length)}`}</span>
                {filtered && <button className="kp-link-btn" onClick={() => setFilters(NO_FILTERS)}>عرض الكل</button>}
                {!selected && <button className="btn btn-ghost btn-sm kp-select-start" onClick={() => setSelected(new Set())}><ListChecks /> إسناد إلى مشرفة</button>}
              </div>
              {visible.length ? (
                <RegisterList rows={visible} selected={selected} onOpen={open}
                  onSelectAll={on => setSelected(on ? new Set(visible.map(row => row.id)) : new Set())} />
              ) : (
                <div className="empty">
                  <Search />
                  <b>لا توجد مدرسة بهذا الوصف</b>
                  <button className="btn btn-secondary" onClick={() => setFilters(NO_FILTERS)}>عرض الكل</button>
                </div>
              )}
            </>
          )}

          {selected && (
            <SelectionBar count={selected.size} members={members} onAll={() => setSelected(new Set(visible.map(row => row.id)))}
              onAssign={assign} onCancel={() => setSelected(null)} />
          )}
        </>
      )}

      {register && <ImportHistory refresh={historyVersion} onUndo={undoImport} />}

      {editing && (
        <KpiEditor
          row={editing.row}
          preset={editing.preset}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => { toast(editing.row ? "حُفظت التعديلات" : "أُضيفت المدرسة إلى السجل"); void load(); }}
          onDeleted={row => { toast(`حُذفت «${row.schoolName}» من السجل`, { label: "تراجع", run: () => void restore(row) }); void load(); }}
        />
      )}
      {importing && (
        <ImportDialog key={importing.id} file={importing.file} members={members} onPickAnother={pickFile} onClose={() => setImporting(null)} onApplied={imported} />
      )}
    </div>
  );
}

function Tile({ label, value, tone, active, onClick }: { label: string; value: number; tone: "ok" | "warn" | "bad"; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`kp-tile tone-${tone} ${active ? "is-active" : ""}`} aria-pressed={active} onClick={onClick}>
      <span>{label}</span>
      <b>{ar(value)}</b>
    </button>
  );
}

type ChipSelectProps = { label: string; all: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void };

/** A filter with many choices (a مشرفة, a stage): a select that looks like the chips beside it. */
function ChipSelect({ label, all, value, options, onChange }: ChipSelectProps) {
  return (
    <select className={`chip kp-chip-select ${value ? "is-set" : ""}`} value={value} aria-label={label} onChange={event => onChange(event.target.value)}>
      <option value="">{all}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

type ListProps = { rows: SchoolKpi[]; selected: Set<string> | null; onOpen: (row: SchoolKpi) => void; onSelectAll: (on: boolean) => void };

/** A table on wide screens; on phones (≤600px, via CSS) two-line rows: the school, then مشرفة · level · follow-up. */
function RegisterList({ rows, selected, onOpen, onSelectAll }: ListProps) {
  const score = (level: SchoolKpi["overallLevel"], value: number | null) => (value === null ? "—" : <LevelChip level={level} score={value} />);
  return (
    <>
      <div className="md-table-wrap blk-table-wide">
        <table className="md-table kp-table">
          <thead>
            <tr>
              {selected && (
                <th className="kp-check-cell">
                  <input type="checkbox" checked={rows.every(row => selected.has(row.id))} onChange={event => onSelectAll(event.target.checked)} aria-label="تحديد كل المدارس الظاهرة" />
                </th>
              )}
              <th>المدرسة</th><th>المرحلة</th><th>نوع التقويم</th><th>المستوى العام</th><th>النواتج</th><th>المتابعة</th><th>المشرفة</th><th aria-label="فتح" />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className={`is-link ${selected?.has(row.id) ? "is-selected" : ""}`} tabIndex={0} onClick={() => onOpen(row)}
                onKeyDown={event => { if (event.key === "Enter") onOpen(row); }}>
                {selected && (
                  <td className="kp-check-cell"><input type="checkbox" checked={selected.has(row.id)} readOnly tabIndex={-1} aria-label={`تحديد ${row.schoolName}`} /></td>
                )}
                <td><b className="kp-school">{row.schoolName}</b>{row.ministryNo && <small className="kp-ministry" dir="ltr">{row.ministryNo}</small>}</td>
                <td>{row.stage || "—"}</td>
                <td>{row.evaluationType || "—"}</td>
                <td>{score(row.overallLevel, row.overallScore)}</td>
                <td>{score(row.outcomesLevel, row.outcomesScore)}</td>
                <td>{row.followUpLevel || "—"}</td>
                <td>{ownerNames(row) || <span className="muted">بلا مشرفة</span>}</td>
                <td className="cell-chevron"><ChevronLeft aria-hidden /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="blk-rows">
        {rows.map(row => (
          <li key={row.id}>
            <button type="button" className={`blk-row is-link kp-row ${selected?.has(row.id) ? "is-selected" : ""}`} onClick={() => onOpen(row)}
              aria-pressed={selected ? selected.has(row.id) : undefined}>
              {selected && <span className="kp-tick" aria-hidden>{selected.has(row.id) && <Check />}</span>}
              <span className="blk-row-text">
                <b>{row.schoolName}</b>
                <span className="kp-row-meta">
                  <span>{ownerNames(row) || "بلا مشرفة"}</span>
                  <LevelChip level={row.overallLevel} score={row.overallScore} />
                  {row.followUpLevel && <span>{row.followUpLevel}</span>}
                </span>
              </span>
              <ChevronLeft className="blk-row-chevron" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Members' schools with no row this year: usually a ministry number that is missing or written differently. */
function MissingList({ items, onAdd }: { items: Missing[]; onAdd: (item: Missing) => void }) {
  return (
    <section className="kp-missing">
      <p className="kp-empty-line">مدارس في قوائم المشرفات لا يقابلها صف في سجل هذا العام — غالباً لأن رقمها الوزاري غير مكتوب أو مكتوب بشكل مختلف.</p>
      {items.length ? (
        <ul className="d-member-list">
          {items.map(item => (
            <li key={item.schoolId} className="kp-missing-row">
              <span className="d-member-id">
                <b>{item.schoolName || "مدرسة بدون اسم"}</b>
                <small>{item.name} · {item.ministryNo ? <bdi dir="ltr">{item.ministryNo}</bdi> : "بلا رقم وزاري"}</small>
              </span>
              <Link href={`/district/team/${item.memberId}`} className="btn btn-ghost btn-sm">ملفها</Link>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAdd(item)}><Plus /> إضافة إلى السجل</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="kp-empty-line">كل مدارس المشرفات موجودة في السجل.</p>
      )}
    </section>
  );
}

type BarProps = { count: number; members: KpiMember[]; onAll: () => void; onAssign: (memberId: string | null) => Promise<void>; onCancel: () => void };

/** «إسناد إلى مشرفة»: tick schools in the list, pick her, assign (her choice wins over the sheet's name from now on). */
function SelectionBar({ count, members, onAll, onAssign, onCancel }: BarProps) {
  const toast = useToast();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const assign = async () => {
    setBusy(true);
    try {
      await onAssign(target === NO_MEMBER ? null : target);
    } catch (reason) {
      toast(errorText(reason));
      setBusy(false);
    }
  };

  return (
    <div className="kp-selbar" role="region" aria-label="إسناد المدارس المحددة">
      <span className="kp-selbar-count">{count ? `المحددة: ${counted(count, SCHOOLS)}` : "اختاري المدارس من القائمة"}</span>
      <button type="button" className="kp-link-btn" onClick={onAll}>تحديد الكل</button>
      <select className="input" value={target} onChange={event => setTarget(event.target.value)} aria-label="المشرفة">
        <option value="">إلى مشرفة…</option>
        {members.map(member => <option key={member.memberId} value={member.memberId}>{member.name}</option>)}
        <option value={NO_MEMBER}>بلا مشرفة</option>
      </select>
      <button type="button" className="btn btn-primary" onClick={() => void assign()} disabled={!count || !target || busy}>
        {busy && <span className="spinner spinner-light" />}إسناد
      </button>
      <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel} aria-label="إلغاء التحديد"><X /></button>
    </div>
  );
}

function KpisSkeleton() {
  return (
    <div className="d-team-skeleton" aria-label="جارٍ التحميل">
      <div className="kp-tiles">{Array.from({ length: 3 }, (_, index) => <i key={index} className="skeleton d-kpi-skeleton" />)}</div>
      <div className="d-member-list">{Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton d-row-skeleton" />)}</div>
    </div>
  );
}
