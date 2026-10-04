"use client";

import { EDUCATION_TYPES, MADRASATI_METRICS, STAGES, TIERS } from "@rasd/schemas";
import { Check, Pencil, Plus, School as SchoolIcon, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toNumber } from "../../lib/chat/helpers";
import { ar, counted } from "../../lib/format";
import type { School, Workspace } from "../../lib/types";
import { ConfirmDialog } from "./dialog";
import { principalName, teachersTile } from "./model";
import { useToast } from "./toast";
import type { MemberFile } from "./use-member-file";

const STUDENTS = { one: "طالبة واحدة", two: "طالبتان", few: "طالبات", many: "طالبة" };
const TEACHERS = { one: "معلمة واحدة", two: "معلمتان", few: "معلمات", many: "معلمة" };
const CLASSES = { one: "فصل واحد", two: "فصلان", few: "فصول", many: "فصلاً" };

/** Core school data main's completion counts, with the label the head sees when it is empty. */
const CORE: { label: string; empty: (school: School) => boolean }[] = [
  { label: "المرحلة", empty: school => !school.stage.trim() },
  { label: "الحي", empty: school => !school.area.trim() },
  { label: "الرقم الوزاري", empty: school => !school.ministryNo.trim() },
  { label: "عدد الطالبات", empty: school => school.students <= 0 },
  { label: "عدد الفصول", empty: school => school.classes <= 0 },
];
const missingCore = (school: School) => CORE.filter(item => item.empty(school)).map(item => item.label);

export function SchoolsTab({ file }: { file: MemberFile }) {
  const toast = useToast();
  const { workspace } = file;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<School | null>(null);

  // A school is only created once it has a name; then it opens for the rest of its data (see AddSchool).
  const addSchool = (name: string) => { file.addSchool(name).catch(reason => toast((reason as Error).message)); };

  return (
    <div className="mp-panel">
      {!workspace.schools.length && <p className="mp-note">لم تُضف مدارس بعد. تضيفها من حسابها، أو أضيفيها أنتِ هنا.</p>}

      <div className="mp-schools">
        {workspace.schools.map(school => (
          <SchoolCard
            key={school.id}
            school={school}
            file={file}
            editing={editingId === school.id}
            onEdit={() => setEditingId(editingId === school.id ? null : school.id)}
            onRemove={() => setRemoving(school)}
          />
        ))}
      </div>

      <AddSchool onAdd={addSchool} workspace={workspace} onCreated={setEditingId} />

      {removing && (
        <ConfirmDialog
          title="حذف المدرسة؟"
          description={<>ستُحذف «{removing.name || "مدرسة بدون اسم"}» وأرقامها من ملفها.</>}
          confirmLabel="حذف"
          danger
          onConfirm={() => file.removeSchool(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function AddSchool({ onAdd, workspace, onCreated }: { onAdd: (name: string) => void; workspace: Workspace; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useState<number | null>(null);
  const close = () => { setOpen(false); setName(""); };

  // Open the new school as soon as it appears in the list.
  useEffect(() => {
    if (waiting === null || workspace.schools.length <= waiting) return;
    onCreated(workspace.schools[workspace.schools.length - 1].id);
    setWaiting(null);
  }, [waiting, workspace.schools, onCreated]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setWaiting(workspace.schools.length);
    onAdd(name.trim());
    close();
  };

  if (!open) return <button className="btn btn-add btn-block" onClick={() => setOpen(true)}><Plus /> إضافة مدرسة</button>;
  return (
    <form className="mp-school mp-add-school" onSubmit={submit}>
      <label className="field">
        <span className="field-label">اسم المدرسة</span>
        <input className="input" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") close(); }} placeholder="مثال: الابتدائية ١٢٠" maxLength={200} autoFocus />
      </label>
      <div className="mp-school-actions">
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}><Plus /> إضافة</button>
        <button type="button" className="btn btn-secondary" onClick={close}>إلغاء</button>
      </div>
    </form>
  );
}

type CardProps = { school: School; file: MemberFile; editing: boolean; onEdit: () => void; onRemove: () => void };

function SchoolCard({ school, file, editing, onEdit, onRemove }: CardProps) {
  const principal = principalName(school);
  const teachers = teachersTile(school)?.value ?? 0;
  const gaps = missingCore(school);
  const change = (values: Parameters<MemberFile["setSchool"]>[1]) => file.setSchool(school.id, values);
  const refused = (key: string) => file.fieldErrors[`${school.id}:${key}`];
  const numbers = [
    school.students > 0 && counted(school.students, STUDENTS),
    teachers > 0 && counted(teachers, TEACHERS),
    school.classes > 0 && counted(school.classes, CLASSES),
  ].filter(Boolean).join(" · ");
  const evaluation = school.evaluation;

  return (
    <article className={`mp-school ${editing ? "is-editing" : ""}`}>
      <header className="mp-school-head">
        <span className="mp-school-icon" aria-hidden><SchoolIcon /></span>
        <div>
          <b>{school.name || "مدرسة بدون اسم"}</b>
          <small>{[school.stage, numbers].filter(Boolean).join(" · ") || "لم تُعبّأ أرقامها بعد"}</small>
          {principal && !editing && <small>المديرة: {principal}</small>}
          {gaps.length > 0 && !editing && <small className="mp-school-gaps">ينقصها: {gaps.join("، ")}</small>}
        </div>
        {school.tier && <span className="pill pill-brand">{school.tier}</span>}
      </header>

      {editing && (
        <>
          <div className="mp-school-form">
            <TextField label="اسم المدرسة" value={school.name} onChange={name => change({ name })} placeholder="مثال: الابتدائية ١٢٠" error={refused("name")} />
            <TextField label="المرحلة" value={school.stage} onChange={stage => change({ stage })} options={STAGES} listId={`stages-${school.id}`} />
            <TextField label="مديرة المدرسة" value={principal} onChange={name => file.setPrincipal(school.id, name)} />
          </div>
          <div className="mp-school-counts">
            <NumberField label="الطالبات" value={school.students} onChange={students => change({ students })} />
            <NumberField label="المعلمات" value={teachers} onChange={value => file.setTeachers(school.id, value)} />
            <NumberField label="الفصول" value={school.classes} onChange={classes => change({ classes })} />
          </div>
          <details className="mp-school-more" open={!school.area.trim() || !school.ministryNo.trim() || Boolean(refused("ministryNo"))}>
            <summary>بيانات إضافية</summary>
            <div className="mp-school-form">
              <TextField label="الحي" value={school.area} onChange={area => change({ area })} placeholder="مثال: حي النرجس" />
              <TextField label="الرقم الوزاري" value={school.ministryNo} onChange={ministryNo => change({ ministryNo })} inputMode="numeric" dir="ltr" error={refused("ministryNo")} />
              <TextField label="بريد المدرسة" value={school.ministryEmail} onChange={ministryEmail => change({ ministryEmail })} dir="ltr" inputMode="email" />
              <TextField label="نوع التعليم" value={school.educationType} onChange={educationType => change({ educationType })} options={EDUCATION_TYPES} listId={`edu-${school.id}`} />
            </div>
          </details>
          <details className="mp-school-more">
            <summary>المؤشرات</summary>
            <div className="field">
              <span className="field-label" id={`tier-${school.id}`}>التصنيف</span>
              <div className="mp-chips" role="group" aria-labelledby={`tier-${school.id}`}>
                {TIERS.map(tier => (
                  <button key={tier} type="button" className={`chip ${school.tier === tier ? "is-active" : ""}`} aria-pressed={school.tier === tier} onClick={() => change({ tier: school.tier === tier ? null : tier })}>{tier}</button>
                ))}
              </div>
            </div>
            <div className="mp-school-form">
              <TextField label="نوع الدعم" value={evaluation?.supportType ?? ""} onChange={supportType => file.setEvaluation(school.id, { supportType })} />
            </div>
            <div className="mp-school-counts">
              <PercentField label="نافس" value={evaluation?.nafesValue ?? null} onChange={nafesValue => file.setEvaluation(school.id, { nafesValue })} nullable />
              <PercentField label="قدرات" value={evaluation?.qudrat ?? null} onChange={qudrat => file.setEvaluation(school.id, { qudrat })} nullable />
              <PercentField label="تحصيلي" value={evaluation?.tahsili ?? null} onChange={tahsili => file.setEvaluation(school.id, { tahsili })} nullable />
            </div>
            <h5 className="mp-sub-title">مدرستي</h5>
            <div className="mp-school-counts">
              {MADRASATI_METRICS.map((metric, index) => (
                <PercentField key={metric.key} label={metric.label} value={school.madrasati[index] ?? 0} onChange={value => file.setMadrasati(school.id, index, value ?? 0)} />
              ))}
            </div>
            <h5 className="mp-sub-title">الانضباط</h5>
            <div className="mp-school-counts">
              <PercentField label="يومي" value={school.discipline.daily} onChange={daily => file.setDiscipline(school.id, { daily: daily ?? 0 })} />
              <PercentField label="أسبوعي" value={school.discipline.weekly} onChange={weekly => file.setDiscipline(school.id, { weekly: weekly ?? 0 })} />
              <PercentField label="شهري" value={school.discipline.monthly} onChange={monthly => file.setDiscipline(school.id, { monthly: monthly ?? 0 })} />
            </div>
          </details>
        </>
      )}

      <footer className="mp-school-actions">
        <button className={`btn ${editing ? "btn-primary" : "btn-secondary"}`} onClick={onEdit}>{editing ? <><Check /> تم</> : <><Pencil /> تعديل</>}</button>
        <button className="btn btn-ghost mp-danger-text" onClick={onRemove}><Trash2 /> حذف</button>
      </footer>
    </article>
  );
}

type TextFieldProps = {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  options?: readonly string[]; listId?: string; dir?: string; inputMode?: "numeric" | "email" | "text"; error?: string;
};

function TextField({ label, value, onChange, placeholder, options, listId, dir, inputMode, error }: TextFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} list={listId} dir={dir} inputMode={inputMode} aria-invalid={Boolean(error) || undefined} />
      {options && listId && <datalist id={listId}>{options.map(option => <option key={option} value={option} />)}</datalist>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/** Keeps what she typed (Arabic or Western digits) while storing a whole number ≥ 0. */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => { setText(current => toNumber(current) === value ? current : value ? String(value) : ""); }, [value]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" value={text} inputMode="numeric" placeholder="٠" onChange={event => { setText(event.target.value); onChange(Math.max(0, Math.floor(toNumber(event.target.value)))); }} />
    </label>
  );
}

/** A whole percentage 0–100; out-of-range values are not saved (and say why). Empty = no value when `nullable`. */
function PercentField({ label, value, onChange, nullable }: { label: string; value: number | null; onChange: (value: number | null) => void; nullable?: boolean }) {
  const [text, setText] = useState(value === null || (!nullable && !value) ? "" : String(value));
  useEffect(() => {
    setText(current => {
      const parsed = current.trim() ? toNumber(current) : null;
      if (parsed === value || (!nullable && parsed === null && !value)) return current;
      return value === null || (!nullable && !value) ? "" : String(value);
    });
  }, [value, nullable]);
  const parsed = text.trim() ? toNumber(text) : null;
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100);
  return (
    <label className="field">
      <span className="field-label">{label} <span className="muted">(٪)</span></span>
      <input
        className="input"
        value={text}
        inputMode="numeric"
        placeholder={nullable ? "—" : "٠"}
        aria-invalid={invalid || undefined}
        onChange={event => {
          const next = event.target.value;
          setText(next);
          const number = next.trim() ? toNumber(next) : null;
          if (number === null) onChange(nullable ? null : 0);
          else if (Number.isInteger(number) && number >= 0 && number <= 100) onChange(number);
        }}
      />
      {invalid && <span className="field-error">بين {ar(0)} و{ar(100)}</span>}
    </label>
  );
}
