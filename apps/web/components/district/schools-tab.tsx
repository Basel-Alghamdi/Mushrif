"use client";

import type { School, SchoolLeader, Workspace } from "@rasd/schemas";
import { Check, Pencil, Plus, School as SchoolIcon, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { newLocalId, toNumber } from "../../lib/chat/helpers";
import { counted } from "../../lib/format";
import { ConfirmDialog } from "./dialog";

type Props = { workspace: Workspace; update: (mutate: (current: Workspace) => Workspace) => void };

// Same values the member's school page offers, so both sides write the same words.
const STAGES = ["ابتدائية", "متوسطة", "ثانوية", "رياض أطفال"];
const TIERS = ["تميز", "تقدم", "انطلاق", "تهيئة"];
const STUDENTS = { one: "طالبة واحدة", two: "طالبتان", few: "طالبات", many: "طالبة" };
const TEACHERS = { one: "معلمة واحدة", two: "معلمتان", few: "معلمات", many: "معلمة" };
const CLASSES = { one: "فصل واحد", two: "فصلان", few: "فصول", many: "فصلاً" };

/** The member side keeps the principal as the «قائدة المدرسة» entry of school.leadership; school.principal mirrors its name. */
const PRINCIPAL_ROLE = "قائدة المدرسة";
const nameOf = (leader: SchoolLeader) => leader.fields.find(field => field.id === "name")?.value ?? "";
const principalName = (school: School) => {
  const leader = school.leadership?.find(item => item.role === PRINCIPAL_ROLE);
  return (leader ? nameOf(leader) : "") || school.principal;
};

/** Writes the principal's name to both places, creating the قائدة entry when it does not exist yet. */
function principalPatch(school: School, name: string): Partial<School> {
  const leaders = school.leadership ?? [];
  if (leaders.some(leader => leader.role === PRINCIPAL_ROLE)) {
    const withName = (leader: SchoolLeader): SchoolLeader => leader.fields.some(field => field.id === "name")
      ? { ...leader, fields: leader.fields.map(field => field.id === "name" ? { ...field, value: name } : field) }
      : { ...leader, fields: [...leader.fields, { id: "name", label: "الاسم", value: name }] };
    return { principal: name, leadership: leaders.map(leader => leader.role === PRINCIPAL_ROLE ? withName(leader) : leader) };
  }
  const principal: SchoolLeader = {
    id: newLocalId(), role: PRINCIPAL_ROLE, state: "",
    fields: [{ id: "name", label: "الاسم", value: name }, { id: "phone", label: "الجوال", value: "" }],
  };
  return { principal: name, leadership: [principal, ...leaders] };
}

function newSchool(name: string): School {
  return {
    id: newLocalId(), name, stage: "", area: "", ministryNo: "", email: "", educationType: "", specialEducation: "", hasGuard: "",
    classes: 0, students: 0, giftedClasses: 0, giftedStudents: 0, teachesChinese: "", teachers: 0, admin: 0, deputies: 0, expert: 0, advanced: 0,
    tier: "", support: "", nafes: "", qudrat: 0, tahsili: 0, madrasati: [0, 0, 0, 0, 0, 0], discipline: [0, 0, 0], absence: false, principal: "",
  };
}

export function SchoolsTab({ workspace, update }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<School | null>(null);

  const patchSchool = (id: string, change: (school: School) => Partial<School>) => update(current => ({
    ...current,
    schools: current.schools.map(school => school.id === id ? { ...school, ...change(school), updatedAt: new Date().toISOString() } : school),
  }));

  // A school is only created once it has a name; then it opens for the rest of its data.
  const addSchool = (name: string) => {
    const school = newSchool(name);
    update(current => ({ ...current, schools: [...current.schools, school] }));
    setEditingId(school.id);
  };

  const removeSchool = (id: string) => update(current => ({ ...current, schools: current.schools.filter(school => school.id !== id) }));

  return (
    <div className="mp-panel">
      {!workspace.schools.length && <p className="mp-note">لم تُضف مدارس بعد. تضيفها من حسابها، أو أضيفيها أنتِ هنا.</p>}

      <div className="mp-schools">
        {workspace.schools.map(school => (
          <SchoolCard
            key={school.id}
            school={school}
            editing={editingId === school.id}
            onEdit={() => setEditingId(editingId === school.id ? null : school.id)}
            onChange={change => patchSchool(school.id, () => change)}
            onPrincipal={name => patchSchool(school.id, current => principalPatch(current, name))}
            onRemove={() => setRemoving(school)}
          />
        ))}
      </div>

      <AddSchool onAdd={addSchool} />

      {removing && (
        <ConfirmDialog
          title="حذف المدرسة؟"
          description={<>ستُحذف «{removing.name || "مدرسة بدون اسم"}» وأرقامها من ملفها.</>}
          confirmLabel="حذف"
          danger
          onConfirm={() => removeSchool(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function AddSchool({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const close = () => { setOpen(false); setName(""); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim());
    close();
  };

  if (!open) return <button className="btn btn-add btn-block" onClick={() => setOpen(true)}><Plus /> إضافة مدرسة</button>;
  return (
    <form className="mp-school mp-add-school" onSubmit={submit}>
      <label className="field">
        <span className="field-label">اسم المدرسة</span>
        <input className="input" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") close(); }} placeholder="مثال: الابتدائية ١٢٠" autoFocus />
      </label>
      <div className="mp-school-actions">
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}><Plus /> إضافة</button>
        <button type="button" className="btn btn-secondary" onClick={close}>إلغاء</button>
      </div>
    </form>
  );
}

type CardProps = {
  school: School; editing: boolean; onEdit: () => void; onChange: (change: Partial<School>) => void; onPrincipal: (name: string) => void; onRemove: () => void;
};

function SchoolCard({ school, editing, onEdit, onChange, onPrincipal, onRemove }: CardProps) {
  const principal = principalName(school);
  const numbers = [
    school.students > 0 && counted(school.students, STUDENTS),
    school.teachers > 0 && counted(school.teachers, TEACHERS),
    school.classes > 0 && counted(school.classes, CLASSES),
  ].filter(Boolean).join(" · ");
  return (
    <article className={`mp-school ${editing ? "is-editing" : ""}`}>
      <header className="mp-school-head">
        <span className="mp-school-icon" aria-hidden><SchoolIcon /></span>
        <div>
          <b>{school.name || "مدرسة بدون اسم"}</b>
          <small>{[school.stage, numbers].filter(Boolean).join(" · ") || "لم تُعبّأ أرقامها بعد"}</small>
          {principal && !editing && <small>القائدة: {principal}</small>}
        </div>
        {school.tier && <span className="pill pill-brand">{school.tier}</span>}
      </header>

      {editing && (
        <>
          <div className="mp-school-form">
            <TextField label="اسم المدرسة" value={school.name} onChange={name => onChange({ name })} placeholder="مثال: الابتدائية ١٢٠" />
            <TextField label="المرحلة" value={school.stage} onChange={stage => onChange({ stage })} options={STAGES} listId={`stages-${school.id}`} />
            <TextField label="قائدة المدرسة" value={principal} onChange={onPrincipal} />
          </div>
          <div className="mp-school-counts">
            <NumberField label="الطالبات" value={school.students} onChange={students => onChange({ students })} />
            <NumberField label="المعلمات" value={school.teachers} onChange={teachers => onChange({ teachers })} />
            <NumberField label="الفصول" value={school.classes} onChange={classes => onChange({ classes })} />
          </div>
          <details className="mp-school-more">
            <summary>بيانات إضافية</summary>
            <div className="mp-school-form">
              <TextField label="الحي" value={school.area} onChange={area => onChange({ area })} placeholder="مثال: حي النرجس" />
              <TextField label="الرقم الوزاري" value={school.ministryNo} onChange={ministryNo => onChange({ ministryNo })} inputMode="numeric" />
              <TextField label="بريد المدرسة" value={school.email} onChange={email => onChange({ email })} dir="ltr" inputMode="email" />
              <TextField label="التصنيف" value={school.tier} onChange={tier => onChange({ tier })} options={TIERS} listId={`tiers-${school.id}`} />
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
  options?: string[]; listId?: string; dir?: string; inputMode?: "numeric" | "email" | "text";
};

function TextField({ label, value, onChange, placeholder, options, listId, dir, inputMode }: TextFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} list={listId} dir={dir} inputMode={inputMode} />
      {options && listId && <datalist id={listId}>{options.map(option => <option key={option} value={option} />)}</datalist>}
    </label>
  );
}

/** Keeps what she typed (Arabic or Western digits) while storing a number. */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => { setText(current => toNumber(current) === value ? current : value ? String(value) : ""); }, [value]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" value={text} inputMode="numeric" placeholder="٠" onChange={event => { setText(event.target.value); onChange(toNumber(event.target.value)); }} />
    </label>
  );
}
