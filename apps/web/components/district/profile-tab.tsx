"use client";

import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { counted } from "../../lib/format";
import type { ProfileField } from "../../lib/types";
import { ConfirmDialog } from "./dialog";
import { fieldInput, isDerived, isEssential, type MissingItem } from "./model";
import { useToast } from "./toast";
import type { MemberFile } from "./use-member-file";

type GoTab = "schools";
type Props = {
  file: MemberFile;
  missing: MissingItem[];
  /** «الفارغة فقط»: the fields that were empty when she opened the filter (frozen, so a field stays while she types in it). */
  onlyIds: string[] | null;
  onShowAll: () => void;
  onGo: (tab: GoTab) => void;
};

const YEARS = { one: "سنة واحدة", two: "سنتان", few: "سنوات", many: "سنة" };

/** Her profile: essentials first, then a collapsed «بيانات إضافية» (the other built-ins and custom fields). */
export function ProfileTab({ file, missing, onlyIds, onShowAll, onGo }: Props) {
  const toast = useToast();
  const { workspace, setField, addField, removeField } = file;
  const [removing, setRemoving] = useState<ProfileField | null>(null);
  const essentials = workspace.profile.filter(isEssential);
  const extras = workspace.profile.filter(field => !isEssential(field) && !isDerived(field));
  const years = workspace.profile.find(field => field.key === "yearsOfExperience")?.value ?? "";

  // Years of experience are one quiet line under the date they come from.
  const noteFor = (field: ProfileField) => field.key === "hireDate" && Number(years) > 0 ? `≈ ${counted(Number(years), YEARS)} خبرة` : undefined;

  if (onlyIds) {
    const empty = workspace.profile.filter(field => onlyIds.includes(field.id));
    const others = missing.filter(item => item.tab !== "profile");
    return (
      <div className="mp-panel">
        <div className="mp-filter-bar">
          <span>الفارغة فقط</span>
          <button className="btn btn-ghost" onClick={onShowAll}>عرض كل البيانات</button>
        </div>
        {empty.length > 0 && (
          <div className="mp-fields">
            {empty.map(field => <FieldRow key={field.id} field={field} highlight onChange={value => setField(field.id, value)} />)}
          </div>
        )}
        {others.length > 0 && (
          <ul className="mp-goto-list">
            {others.map(item => (
              <li key={item.label}>
                {item.tab
                  ? <button onClick={() => onGo(item.tab as GoTab)}><span>{item.label}</span><ChevronLeft aria-hidden /></button>
                  : <div className="mp-goto-static"><span>{item.label}</span><small>تكمله هي من حسابها</small></div>}
              </li>
            ))}
          </ul>
        )}
        {!empty.length && !others.length && <p className="mp-note">لا ينقصها شيء الآن.</p>}
      </div>
    );
  }

  return (
    <div className="mp-panel">
      <div className="mp-fields">
        {essentials.map(field => <FieldRow key={field.id} field={field} highlight note={noteFor(field)} onChange={value => setField(field.id, value)} />)}
      </div>

      <details className="mp-more-fields">
        <summary>بيانات إضافية</summary>
        <div className="mp-fields">
          {extras.map(field => (
            <FieldRow key={field.id} field={field} onChange={value => setField(field.id, value)} onRemove={field.key ? undefined : () => setRemoving(field)} />
          ))}
        </div>
        <AddFieldForm onAdd={(label, value) => addField(label, value).catch(reason => toast((reason as Error).message))} />
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
  const { options, ...input } = fieldInput(field);
  const listId = options?.length ? `options-${field.id}` : undefined;
  const id = `field-${field.id}`;
  return (
    <div className={`field mp-field ${empty ? "is-empty" : ""}`}>
      <div className="mp-field-label">
        <label className="field-label" htmlFor={id}>{field.label}</label>
        {onRemove && <button className="mp-field-remove" onClick={onRemove} aria-label={`حذف خانة ${field.label}`}><Trash2 /></button>}
      </div>
      <input id={id} className="input" value={field.value} list={listId} onChange={event => onChange(event.target.value)} {...input} />
      {listId && <datalist id={listId}>{options!.map(option => <option key={option} value={option} />)}</datalist>}
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
        <input className="input" value={label} onChange={event => setLabel(event.target.value)} placeholder="مثال: الدورات التدريبية" maxLength={200} autoFocus />
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
