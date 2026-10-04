"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ar } from "@rasd/i18n";
import { api } from "../../lib/api";
import type { CustomSection, LabelValue } from "../../lib/types";
import { PageTitle } from "../platform-shell";
import { EditableInput, Empty, LabelText, useMember } from "./context";
import { withVersion } from "./file-page";
import { replaceById, useCreate, useRemove } from "./mutations";

type Row = LabelValue & Record<string, unknown>;

export function CustomSectionPage({ id }: { id: string }) {
  const router = useRouter();
  const { ws, setWs, labelMode } = useMember();
  const create = useCreate();
  const remove = useRemove();
  const section = ws.sections.find(item => item.id === id);
  if (!section) return <Empty title="هذا القسم غير موجود أو حُذف" action="العودة إلى ملف العنقود" onAction={() => router.push("/cluster/file")}/>;

  const setSection = (patch: Partial<CustomSection> | ((item: CustomSection) => CustomSection)) => setWs(current => ({ ...current, sections: replaceById(current.sections, section.id, patch) }));
  const rename = async (label: string, force: boolean) => {
    const row = await api<Row>(`/sections/${section.id}`, { method: "PATCH", body: withVersion({ label }, section.updatedAt, force) });
    setSection({ label: row.label, updatedAt: row.updatedAt });
  };
  const addField = () => {
    const fieldId = crypto.randomUUID();
    create<Row>({ path: `/sections/${section.id}/fields`, body: { id: fieldId, label: "حقل جديد" },
      apply: () => setSection(item => ({ ...item, fields: [...item.fields, { id: fieldId, label: "حقل جديد", value: "", updatedAt: "" }] })),
      rollback: () => setSection(item => ({ ...item, fields: item.fields.filter(field => field.id !== fieldId) })),
      then: row => setSection(item => ({ ...item, fields: replaceById(item.fields, fieldId, { updatedAt: row.updatedAt }) })) });
  };
  const deleteSection = () => {
    if (!window.confirm(`حذف ${section.label}؟ سيتم حذف ${ar(section.fields.length)} حقول مرتبطة به.`)) return;
    const sections = ws.sections;
    remove({ text: "حُذف القسم", path: `/sections/${section.id}`,
      apply: () => { setWs(current => ({ ...current, sections: current.sections.filter(item => item.id !== section.id) })); router.push("/cluster/file"); },
      rollback: () => setWs(current => ({ ...current, sections })) });
  };

  return <div className="page-stack">
    <PageTitle title={section.label} description="قسم مخصص ضمن ملف العنقود، يظهر لرئيسة النطاق وفي التقرير المجمّع." actions={<>
      <button className="secondary-button" onClick={addField}><Plus/>إضافة حقل</button>
      <button className="danger-button" onClick={deleteSection}><Trash2/>حذف القسم</button>
    </>}/>
    <section className="card">
      {labelMode && <EditableInput className="section-title-input label-input" aria-label="اسم القسم" value={section.label} validate={value => (value.trim() ? null : "اسم القسم مطلوب")} save={(value, force) => rename(value.trim(), force)}/>}
      {section.fields.length === 0 ? <Empty title="لا توجد حقول في هذا القسم" action="إضافة حقل" onAction={addField}/> : <div className="form-grid">{section.fields.map(field => {
        const path = `/sections/${section.id}/fields/${field.id}`;
        const save = async (patch: Record<string, unknown>, force: boolean) => {
          const row = await api<Row>(path, { method: "PATCH", body: withVersion(patch, field.updatedAt, force) });
          setSection(item => ({ ...item, fields: replaceById(item.fields, field.id, { label: row.label, value: row.value, updatedAt: row.updatedAt }) }));
        };
        return <label key={field.id}>
          <LabelText label={field.label} save={label => save({ label }, true)}/>
          <div className="field-with-action">
            <EditableInput aria-label={field.label} value={field.value} save={(value, force) => save({ value }, force)}/>
            <button type="button" aria-label={`حذف حقل ${field.label}`} onClick={() => remove({ text: "حُذف الحقل", path,
              apply: () => setSection(item => ({ ...item, fields: item.fields.filter(value => value.id !== field.id) })),
              rollback: () => setSection(item => ({ ...item, fields: section.fields })) })}><X/></button>
          </div>
        </label>;
      })}</div>}
    </section>
  </div>;
}
