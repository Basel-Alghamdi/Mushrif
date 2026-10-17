"use client";

import {
  isUnclassified, KPI_DOMAINS, KPI_EVALUATION_TYPES, KPI_FOLLOW_UP_LEVELS, KPI_STAGES, KPI_STANDARDS, kpiLevel, toWesternDigits, type SchoolKpi,
} from "@rasd/schemas";
import { Trash2 } from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";
import { api, ApiError, errorText } from "../../../lib/api";
import { Dialog } from "../dialog";
import { LevelChip, SupportChip } from "./kpi-view";
import { parseScore, type KpiMember } from "./model";

type Props = {
  /** null: a new school (POST /district/kpis), started from `preset`. */
  row: SchoolKpi | null;
  preset?: Record<string, string>;
  members: KpiMember[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (row: SchoolKpi) => void;
};

const TEXT_FIELDS: { key: string; label: string; options?: string[]; dir?: "ltr"; numeric?: boolean }[] = [
  { key: "schoolName", label: "اسم المدرسة" },
  { key: "ministryNo", label: "الرقم الوزاري", dir: "ltr" },
  { key: "stage", label: "المرحلة", options: KPI_STAGES },
  { key: "evaluationType", label: "نوع التقويم", options: KPI_EVALUATION_TYPES },
  { key: "authority", label: "السلطة" },
  { key: "region", label: "المنطقة / المحافظة" },
  { key: "sector", label: "القطاع" },
  { key: "year", label: "العام", numeric: true },
];
const STANDARD = "standards.";
const SCORE_KEYS = ["overallScore", "outcomesScore", ...KPI_STANDARDS.map(standard => `${STANDARD}${standard.key}`)];
/** Fields that show the server's message under their box; any other refusal shows under the form. */
const SHOWN = new Set([...TEXT_FIELDS.map(field => field.key), "overallScore", "outcomesScore", "followUpLevel", "assignedMemberId", "note"]);

/** The value a field shows before she changes it: scores as she would type them, nothing as "". */
function initialText(row: SchoolKpi | null, key: string) {
  if (!row) return "";
  const value = key.startsWith(STANDARD) ? row.standards[key.slice(STANDARD.length) as keyof SchoolKpi["standards"]] : row[key as keyof SchoolKpi];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * One school's row of the register: its scores by domain (each with the level or support it gives, as she types),
 * the مشرفة it belongs to, and the school's details. Saves only what she changed, with the version it was opened at.
 */
export function KpiEditor({ row, preset = {}, members, onClose, onSaved, onDeleted }: Props) {
  const [base, setBase] = useState(row);
  // Only the fields she changed, as typed: after a conflict the others show the newer copy and hers stay.
  const [edits, setEdits] = useState<Record<string, string>>(preset);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const text = (key: string) => edits[key] ?? initialText(base, key);
  const set = (key: string) => (value: string) => setEdits(current => ({ ...current, [key]: value }));
  const scores = Object.fromEntries(SCORE_KEYS.filter(key => key in edits).map(key => [key, parseScore(edits[key])]));
  const invalid = Object.values(scores).some(score => score.error);
  const unclassified = isUnclassified(text("evaluationType"));

  const body = () => {
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(edits)) {
      if (key.startsWith(STANDARD)) continue;
      if (key in scores) changes[key] = scores[key].value;
      // A new school with nobody chosen stays open to the next import's name (a choice, even «بلا مشرفة», is kept).
      else if (key === "assignedMemberId") { if (value || base) changes[key] = value || null; }
      else changes[key] = key === "year" ? toWesternDigits(value.trim()) : value.trim();
    }
    // Only the standards she changed: the server keeps the others.
    const standards = Object.keys(edits).filter(key => key.startsWith(STANDARD));
    if (standards.length) changes.standards = Object.fromEntries(standards.map(key => [key.slice(STANDARD.length), scores[key].value]));
    return changes;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || busy) return;
    if (!text("schoolName").trim()) { setFieldErrors({ schoolName: "اكتبي اسم المدرسة" }); return; }
    if (base && !Object.keys(edits).length) { onClose(); return; }
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      if (base) await api.patch(`/district/kpis/${base.id}`, { ...body(), expectedUpdatedAt: base.updatedAt });
      else await api.post("/district/kpis", body());
      onSaved();
      onClose();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "CONFLICT" && base) {
        // Keep what she typed; untouched fields now show the newer copy, and saving again goes over it.
        setBase({ ...base, ...(reason.details?.current as Partial<SchoolKpi> | undefined) });
        setError("عُدّلت هذه المدرسة للتو من جهاز آخر — عرضنا أحدث نسخة. احفظي مرة أخرى لاعتماد ما كتبتِه.");
      } else if (reason instanceof ApiError && reason.fields) {
        setFieldErrors(reason.fields);
        setError(Object.entries(reason.fields).filter(([key]) => !SHOWN.has(key)).map(([, message]) => message).join(" · "));
      } else setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!base) return;
    setBusy(true);
    try {
      await api.del(`/district/kpis/${base.id}`);
      onDeleted(base);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const score = (key: string, label: string, scale: "level" | "support") => (
    <ScoreField key={key} id={`kpi-${key}`} label={label} text={text(key)} onChange={set(key)} error={fieldErrors[key]}
      chip={value => scale === "support" ? <SupportChip score={value} /> : unclassified ? null : <LevelChip level={kpiLevel(value)} />} />
  );

  // Who sees the row: a member whose school has this ministry number sees it whatever is chosen here.
  const bySchool = base?.owners.filter(owner => owner.schoolId) ?? [];
  const owner = (
    <section className="kp-form-group" key="owner">
      <label className="field">
        <span className="field-label">المشرفة المسؤولة</span>
        <select className="input" value={text("assignedMemberId")} onChange={event => set("assignedMemberId")(event.target.value)}>
          <option value="">بلا مشرفة</option>
          {members.map(member => <option key={member.memberId} value={member.memberId}>{member.name}</option>)}
        </select>
        {bySchool.length > 0 && (
          <span className="field-hint">مسجّلة برقمها الوزاري في مدارس {bySchool.map(item => item.name).join(" و")}، فتظهر لها مهما اخترتِ هنا.</span>
        )}
        {base?.memberName && !base.assignedMemberId && <span className="field-hint">الاسم في الملف: «{base.memberName}»</span>}
        {fieldErrors.assignedMemberId && <span className="field-error">{fieldErrors.assignedMemberId}</span>}
      </label>
    </section>
  );
  const results = (
    <section className="kp-form-group" key="results">
      <h3>النتيجة العامة</h3>
      <div className="kp-form-grid">
        {score("overallScore", "المستوى العام", "level")}
        {score("outcomesScore", "درجة النواتج", "level")}
        <TextField id="kpi-followUpLevel" label="مستوى المتابعة" value={text("followUpLevel")} onChange={set("followUpLevel")} options={KPI_FOLLOW_UP_LEVELS} error={fieldErrors.followUpLevel} />
      </div>
    </section>
  );
  const domains = KPI_DOMAINS.map(domain => (
    <section className="kp-form-group" key={domain.key}>
      <h3>{domain.label}</h3>
      <div className="kp-form-grid">
        {domain.standards.map(standard => score(`${STANDARD}${standard.key}`, standard.label, "support"))}
      </div>
    </section>
  ));
  const school = (
    <section className="kp-form-group" key="school">
      <h3>بيانات المدرسة</h3>
      <div className="kp-form-grid">
        {TEXT_FIELDS.map(field => (
          <TextField key={field.key} id={`kpi-${field.key}`} label={field.label} value={text(field.key)} onChange={set(field.key)}
            options={field.options} dir={field.dir} numeric={field.numeric} error={fieldErrors[field.key]} />
        ))}
      </div>
    </section>
  );
  const note = (
    <section className="kp-form-group" key="note">
      <label className="field">
        <span className="field-label">ملاحظة <span className="muted">(تراها المشرفة مع المؤشرات)</span></span>
        <textarea className="input" value={text("note")} onChange={event => set("note")(event.target.value)} aria-invalid={Boolean(fieldErrors.note) || undefined} />
        {fieldErrors.note && <span className="field-error">{fieldErrors.note}</span>}
      </label>
      {base && base.extra.length > 0 && (
        <dl className="kp-extra">
          {base.extra.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
        </dl>
      )}
    </section>
  );

  return (
    <Dialog
      title={base ? base.schoolName || "مدرسة بدون اسم" : "إضافة مدرسة إلى السجل"}
      onClose={onClose}
      footer={<>
        {base && (confirmDelete
          ? <button type="button" className="btn btn-danger-solid kp-delete" onClick={() => void remove()} disabled={busy}>تأكيد الحذف</button>
          : <button type="button" className="btn btn-ghost mp-danger-text kp-delete" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 /> حذف</button>)}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="submit" form="kpi-form" className="btn btn-primary" disabled={busy || invalid}>
          {busy && <span className="spinner spinner-light" />}{base ? "حفظ" : "إضافة"}
        </button>
      </>}
    >
      {/* An open row starts with who it belongs to and its numbers (a select first: no keyboard pops up on phones);
          a new one starts with the school's name. */}
      <form id="kpi-form" className="d-form" onSubmit={submit} noValidate>
        {base ? [owner, results, ...domains, school, note] : [school, owner, results, ...domains, note]}
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

type ScoreFieldProps = {
  id: string; label: string; text: string; onChange: (text: string) => void; error?: string;
  /** The level or support the typed number gives, shown beside it. */
  chip: (value: number) => ReactNode;
};

/** A score 0–100 with up to 2 decimals, typed with Arabic or Western digits and «٫» or «,» (empty = no score). */
function ScoreField({ id, label, text, onChange, error, chip }: ScoreFieldProps) {
  const parsed = parseScore(text);
  const message = parsed.error ?? error;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="kp-score-input">
        <input id={id} className="input" inputMode="decimal" value={text} placeholder="—" autoComplete="off" aria-invalid={Boolean(message) || undefined}
          onChange={event => onChange(event.target.value)} />
        {parsed.value !== null && chip(parsed.value)}
      </div>
      {message && <span className="field-error">{message}</span>}
    </div>
  );
}

type TextFieldProps = {
  id: string; label: string; value: string; onChange: (value: string) => void; options?: string[]; dir?: "ltr"; numeric?: boolean; error?: string;
};

function TextField({ id, label, value, onChange, options, dir, numeric, error }: TextFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input id={id} className="input" value={value} onChange={event => onChange(event.target.value)} list={options && `${id}-options`} dir={dir}
        inputMode={numeric ? "numeric" : undefined} maxLength={200} autoComplete="off" aria-invalid={Boolean(error) || undefined} />
      {options && <datalist id={`${id}-options`}>{options.map(option => <option key={option} value={option} />)}</datalist>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
