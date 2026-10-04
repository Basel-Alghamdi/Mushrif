"use client";

import type { ProfileField, Workspace } from "@rasd/schemas";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { newLocalId, toNumber } from "../../lib/chat/helpers";
import { counted } from "../../lib/format";
import { ConfirmDialog } from "./dialog";

type GoTab = "schools" | "documents";
type Props = {
  workspace: Workspace;
  update: (mutate: (current: Workspace) => Workspace) => void;
  /** «الفارغة فقط»: the fields that were empty when she opened the filter (frozen, so a field stays while she types in it). */
  onlyIds: string[] | null;
  onShowAll: () => void;
  onGo: (tab: GoTab) => void;
};

const YEARS = { one: "سنة واحدة", two: "سنتان", few: "سنوات", many: "سنة" };

function inputProps(field: ProfileField) {
  switch (field.kind) {
    case "email": return { type: "text", inputMode: "email" as const, dir: "ltr" };
    case "phone": return { type: "tel", inputMode: "tel" as const, dir: "ltr" };
    case "number": return { type: "text", inputMode: "numeric" as const };
    // Dates stay plain text: Hijri or Gregorian, whatever she has.
    default: return { type: "text" };
  }
}

const isEssential = (field: ProfileField) => !field.optional && !field.custom && !field.derived;

/** Ids of the essential fields that are empty right now. */
export const emptyEssentialIds = (workspace: Workspace) =>
  workspace.profile.filter(field => isEssential(field) && !field.value.trim()).map(field => field.id);

/** Missing items that are not profile fields (schools, files) and the tab where they are filled. */
function otherMissing(missing: string[], profile: ProfileField[]) {
  const labels = new Set(profile.map(field => field.label));
  return missing.filter(item => !labels.has(item)).map(item => ({ item, tab: (item.includes("مدارس") ? "schools" : "documents") as GoTab }));
}

/** Her profile: essentials first, then a collapsed «بيانات إضافية» (optional + custom fields). */
export function ProfileTab({ workspace, update, onlyIds, onShowAll, onGo }: Props) {
  const [removing, setRemoving] = useState<ProfileField | null>(null);
  const essentials = workspace.profile.filter(isEssential);
  const extras = workspace.profile.filter(field => !isEssential(field) && !field.derived);
  const derived = workspace.profile.filter(field => field.derived && field.value.trim());
  const others = otherMissing(workspace.missing, workspace.profile);

  const setValue = (id: string, value: string) => update(current => ({
    ...current,
    profile: current.profile.map(field => field.id === id ? { ...field, value, updatedAt: new Date().toISOString() } : field),
  }));

  const addField = (label: string, value: string) => update(current => ({
    ...current,
    profile: [...current.profile, { id: newLocalId(), label, value, kind: "text", custom: true, updatedAt: new Date().toISOString() }],
  }));

  const removeField = (id: string) => update(current => ({ ...current, profile: current.profile.filter(field => field.id !== id) }));

  // Derived numbers (years of experience) are one quiet line under the date they come from.
  const noteFor = (field: ProfileField) => {
    if (field.id !== "hire_date") return undefined;
    const years = derived.find(item => item.id === "experience_years");
    const n = years ? toNumber(years.value) : 0;
    return n > 0 ? `≈ ${counted(n, YEARS)} خبرة` : undefined;
  };

  if (onlyIds) {
    const emptyEssentials = essentials.filter(field => onlyIds.includes(field.id));
    return (
      <div className="mp-panel">
        <div className="mp-filter-bar">
          <span>الفارغة فقط</span>
          <button className="btn btn-ghost" onClick={onShowAll}>عرض كل البيانات</button>
        </div>
        {emptyEssentials.length > 0 && (
          <div className="mp-fields">
            {emptyEssentials.map(field => <FieldRow key={field.id} field={field} highlight onChange={value => setValue(field.id, value)} />)}
          </div>
        )}
        {others.length > 0 && (
          <ul className="mp-goto-list">
            {others.map(({ item, tab }) => (
              <li key={item}>
                <button onClick={() => onGo(tab)}><span>{item}</span><ChevronLeft aria-hidden /></button>
              </li>
            ))}
          </ul>
        )}
        {!emptyEssentials.length && !others.length && <p className="mp-note">لا ينقصها شيء الآن.</p>}
      </div>
    );
  }

  return (
    <div className="mp-panel">
      <div className="mp-fields">
        {essentials.map(field => <FieldRow key={field.id} field={field} highlight note={noteFor(field)} onChange={value => setValue(field.id, value)} />)}
        {!essentials.some(field => field.id === "hire_date") && derived.map(field => <p key={field.id} className="mp-note">{field.label}: {field.value}</p>)}
      </div>

      <details className="mp-more-fields">
        <summary>بيانات إضافية <span className="muted">(اختياري)</span></summary>
        <div className="mp-fields">
          {extras.map(field => (
            <FieldRow key={field.id} field={field} onChange={value => setValue(field.id, value)} onRemove={field.custom ? () => setRemoving(field) : undefined} />
          ))}
        </div>
        <AddFieldForm onAdd={addField} />
      </details>

      {removing && (
        <ConfirmDialog
          title="حذف الخانة؟"
          description={<>ستُحذف خانة «{removing.label}» وقيمتها من ملفها.</>}
          confirmLabel="حذف"
          danger
          onConfirm={() => removeField(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

type FieldRowProps = { field: ProfileField; onChange: (value: string) => void; onRemove?: () => void; highlight?: boolean; note?: string };

function FieldRow({ field, onChange, onRemove, highlight, note }: FieldRowProps) {
  const empty = highlight && !field.value.trim();
  const listId = field.options?.length ? `options-${field.id}` : undefined;
  const id = `field-${field.id}`;
  return (
    <div className={`field mp-field ${empty ? "is-empty" : ""}`}>
      <div className="mp-field-label">
        <label className="field-label" htmlFor={id}>{field.label}</label>
        {onRemove && <button className="mp-field-remove" onClick={onRemove} aria-label={`حذف خانة ${field.label}`}><Trash2 /></button>}
      </div>
      <input id={id} className="input" value={field.value} placeholder={field.hint ?? ""} list={listId} onChange={event => onChange(event.target.value)} {...inputProps(field)} />
      {listId && <datalist id={listId}>{field.options!.map(option => <option key={option} value={option} />)}</datalist>}
      {note && <span className="field-hint">{note}</span>}
    </div>
  );
}

function AddFieldForm({ onAdd }: { onAdd: (label: string, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    onAdd(label.trim(), value);
    setLabel("");
    setValue("");
    setOpen(false);
  };

  if (!open) return <button className="mp-add-link" onClick={() => setOpen(true)}><Plus /> خانة غير موجودة؟ أضيفيها</button>;

  return (
    <form className="mp-add-field" onSubmit={submit}>
      <label className="field">
        <span className="field-label">اسم الخانة</span>
        <input className="input" value={label} onChange={event => setLabel(event.target.value)} placeholder="مثال: الدورات التدريبية" autoFocus />
      </label>
      <label className="field">
        <span className="field-label">القيمة</span>
        <input className="input" value={value} onChange={event => setValue(event.target.value)} placeholder="اختياري" />
      </label>
      <div className="mp-add-field-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>إلغاء</button>
        <button type="submit" className="btn btn-primary" disabled={!label.trim()}><Plus /> إضافة</button>
      </div>
    </form>
  );
}
