"use client";

import { Check, ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ar } from "@rasd/i18n";
import {
  LEADERSHIP_STATES, SCHOOL_BASE_FIELDS, TIERS, toWesternDigits, validateProfileValue, validators, yearsSinceHijri,
} from "@rasd/schemas";
import { api } from "../../lib/api";
import type { LabelValue, LeadershipRole, ProfileField, School, StaffTile } from "../../lib/types";
import { PageTitle, SectionTitle } from "../platform-shell";
import { digits, EditableInput, EditableSelect, Empty, LabelText, useMember, WorkspaceSection } from "./context";
import { replaceById, useCreate, useRemove } from "./mutations";

type Row = Record<string, unknown> & { updatedAt: string };
// Optimistic rows have no server version yet (updatedAt ""), so they skip the conflict check.
export const withVersion = (body: Record<string, unknown>, updatedAt: string, force: boolean) => (force || !updatedAt ? body : { ...body, expectedUpdatedAt: updatedAt });
const countRule = (value: string) => (/^\d+$/.test(toWesternDigits(value.trim())) ? null : "القيمة يجب أن تكون رقماً");

export function FilePage() {
  return <div className="page-stack">
    <PageTitle title="ملف العنقود" description="بياناتك الأساسية وملفات المدارس والقيادات في مكان واحد."/>
    <WorkspaceSection><ProfileSection/></WorkspaceSection>
    <WorkspaceSection><SchoolsSection/></WorkspaceSection>
  </div>;
}

// ───────────────────────── البيانات الأولية ─────────────────────────
function ProfileSection() {
  const { ws, setWs, fail } = useMember();
  const [saved, setSaved] = useState(false);
  const create = useCreate();
  const remove = useRemove();
  const fields = ws.profile;
  const hireDate = fields.find(field => field.key === "hireDate")?.value ?? "";

  const save = (field: ProfileField) => async (patch: { label?: string; value?: string }, force: boolean) => {
    const row = await api<Row>(`/cluster/me/profile-fields/${field.id}`, { method: "PATCH", body: withVersion(patch, field.updatedAt, force) });
    setWs(current => ({ ...current, profile: replaceById(current.profile, field.id, { label: String(row.label), value: String(row.value), updatedAt: row.updatedAt }) }));
  };
  const add = () => {
    const id = crypto.randomUUID();
    const field: ProfileField = { id, key: null, label: "حقل جديد", value: "", span: 1, type: "text", options: [], updatedAt: "" };
    create<Row>({
      path: "/cluster/me/profile-fields", body: { id, label: field.label },
      apply: () => setWs(current => ({ ...current, profile: [...current.profile, field] })),
      rollback: () => setWs(current => ({ ...current, profile: current.profile.filter(item => item.id !== id) })),
      then: row => setWs(current => ({ ...current, profile: replaceById(current.profile, id, { updatedAt: row.updatedAt }) })),
    });
  };
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    setWs(current => ({ ...current, profile: next }));
    try { await api("/cluster/me/profile-fields/order", { method: "PUT", body: { ids: next.map(item => item.id) } }); }
    catch (error) { setWs(current => ({ ...current, profile: fields })); fail(error); }
  };
  const flush = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  return <>
    <SectionTitle title="البيانات الأولية" description="تُحفظ القيم تلقائياً عند مغادرة الحقل." actions={<>
      <button className="secondary-button" onClick={add}><Plus/>إضافة حقل</button>
      <button className={`secondary-button ${saved ? "active-control" : ""}`} onClick={flush}>{saved ? <><Check/>حُفظت التعديلات</> : "حفظ التعديلات"}</button>
    </>}/>
    {fields.length === 0 ? <Empty title="لا توجد حقول بعد" action="إضافة حقل" onAction={add}/> : <section className="card form-grid">{fields.map((field, index) =>
      <label className={field.span === 2 ? "span-2" : ""} key={field.id}>
        <LabelText label={field.label} save={label => save(field)({ label }, true)}/>
        <div className="field-with-action">
          {field.type === "derived"
            ? <input className="derived-input" value={digits(field.key === "yearsOfExperience" ? yearsSinceHijri(hireDate) : field.value) || "—"} readOnly aria-readonly title="تُحسب تلقائياً"/>
            : field.type === "select"
              ? <EditableSelect ariaLabel={field.label} value={field.value} options={[{ value: "", label: "—" }, ...field.options.map(option => ({ value: option, label: option }))]} save={value => save(field)({ value }, true)}/>
              : <EditableInput value={field.value} dir={field.key === "email" ? "ltr" : undefined} placeholder={field.type === "hijri_date" ? "١٤٤٥/٠١/١٥" : undefined}
                  aria-label={field.label} validate={value => validateProfileValue(field.key, field.type, toWesternDigits(value.trim()))}
                  save={(value, force) => save(field)({ value }, force)}/>}
          <div className="field-actions">
            <button type="button" aria-label={`نقل ${field.label} للأعلى`} disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp/></button>
            <button type="button" aria-label={`نقل ${field.label} للأسفل`} disabled={index === fields.length - 1} onClick={() => move(index, 1)}><ChevronDown/></button>
            <button type="button" aria-label={`حذف حقل ${field.label}`} onClick={() => remove({
              text: "حُذف الحقل", path: `/cluster/me/profile-fields/${field.id}`,
              apply: () => setWs(current => ({ ...current, profile: current.profile.filter(item => item.id !== field.id) })),
              rollback: () => setWs(current => ({ ...current, profile: fields })),
            })}><Trash2/></button>
          </div>
        </div>
        {field.type === "derived" && <small>تُحسب تلقائياً</small>}
      </label>)}
    </section>}
  </>;
}

// ───────────────────────── مدارس العنقود ─────────────────────────
function blankSchool(id: string): School {
  return {
    id, name: "مدرسة جديدة", stage: "", area: "", ministryNo: "", ministryEmail: "", educationType: "حضوري", specialEdProgram: "لا يوجد",
    hasGuard: false, classes: 0, students: 0, giftedClasses: 0, giftedStudents: 0, teachesChinese: false, tier: null, updatedAt: "",
    evaluation: null, madrasati: [0, 0, 0, 0, 0, 0], discipline: { daily: 0, weekly: 0, monthly: 0, planStatus: "missing", planUrl: "" },
    absenceToday: false, visitCount: 0, customFields: [], staffTiles: [], leadership: [],
  };
}

function SchoolsSection() {
  const { ws, setWs, labelMode, reload, fail } = useMember();
  const create = useCreate();
  const remove = useRemove();
  const [selectedId, setSelectedId] = useState(ws.schools[0]?.id ?? "");
  const schools = ws.schools;
  const school = schools.find(item => item.id === selectedId) ?? schools[0];

  const updateSchool = (id: string, patch: Partial<School> | ((item: School) => School)) =>
    setWs(current => ({ ...current, schools: replaceById(current.schools, id, patch) }));
  const addSchool = () => {
    const id = crypto.randomUUID();
    create({
      path: "/cluster/me/schools", body: { id, name: "مدرسة جديدة" },
      apply: () => { setWs(current => ({ ...current, schools: [...current.schools, blankSchool(id)] })); setSelectedId(id); },
      rollback: () => setWs(current => ({ ...current, schools: current.schools.filter(item => item.id !== id) })),
      then: () => { reload(); }, // picks up the seeded leadership role and staff tiles
    });
  };

  if (!school) return <>
    <SectionTitle title="بيانات مدارس العنقود" actions={<button className="secondary-button" onClick={addSchool}><Plus/>إضافة مدرسة</button>}/>
    <Empty title="ما في مدارس بعد" action="إضافة مدرسة" onAction={addSchool}/>
  </>;

  const saveSchool = async (patch: Record<string, unknown>, force = true) => {
    const row = await api<Row>(`/cluster/me/schools/${school.id}`, { method: "PATCH", body: withVersion(patch, school.updatedAt, force) });
    updateSchool(school.id, item => ({ ...item, ...Object.fromEntries(Object.keys(patch).map(key => [key, row[key]])), updatedAt: row.updatedAt } as School));
  };
  const removeSchool = () => {
    const roles = school.leadership.length;
    const tiles = school.staffTiles.length;
    if (!window.confirm(`حذف ${school.name}؟ سيتم حذف ${ar(roles)} أدوار قيادية و${ar(tiles)} مؤشرات وبيانات المؤشرات المرتبطة بها.`)) return;
    const index = schools.findIndex(item => item.id === school.id);
    remove({
      text: "حُذفت المدرسة", path: `/cluster/me/schools/${school.id}`,
      apply: () => { setWs(current => ({ ...current, schools: current.schools.filter(item => item.id !== school.id) })); setSelectedId(schools[index - 1]?.id ?? schools[index + 1]?.id ?? ""); },
      rollback: () => { setWs(current => ({ ...current, schools })); setSelectedId(school.id); },
    });
  };
  const toggleHidden = async (key: string) => {
    const before = ws.hiddenSchoolFields;
    const hidden = before.includes(key) ? before.filter(item => item !== key) : [...before, key];
    setWs(current => ({ ...current, hiddenSchoolFields: hidden }));
    try { await api(`/schools/${school.id}/field-overrides`, { method: "PUT", body: { hidden } }); }
    catch (error) { setWs(current => ({ ...current, hiddenSchoolFields: before })); fail(error); }
  };

  const students = schools.reduce((sum, item) => sum + item.students, 0);
  return <>
    <SectionTitle title="بيانات مدارس العنقود" description={`${ar(schools.length)} مدارس · ${ar(students)} طالبة`} actions={<>
      <button className="secondary-button" onClick={addSchool}><Plus/>إضافة مدرسة</button>
      <button className="danger-button" onClick={removeSchool}><Trash2/>حذف المدرسة</button>
    </>}/>
    <div className="schools-layout">
      <aside className="school-picker">{schools.map(item => <button className={item.id === school.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
        <b>{item.name}</b><span>{item.tier && <Tier tier={item.tier}/>}{[item.stage, `${ar(item.students)} طالبة`].filter(Boolean).join(" · ")}</span>
      </button>)}</aside>
      <div className="detail-stack">
        <section className="card">
          <div className="card-title-row">
            <div>
              {labelMode
                ? <EditableInput className="editable-title label-input" value={school.name} aria-label="اسم المدرسة" validate={value => (value.trim() ? null : "اسم المدرسة مطلوب")} save={value => saveSchool({ name: value.trim() })}/>
                : <h3 className="school-title">{school.name}</h3>}
              <p>{[ws.cluster.label, school.stage, school.area, school.ministryNo && `الرقم الوزاري ${digits(school.ministryNo)}`].filter(Boolean).join(" · ")}</p>
            </div>
            <EditableSelect className="tier-select" ariaLabel="التصنيف" value={school.tier ?? ""} options={[{ value: "", label: "بدون تصنيف" }, ...TIERS.map(tier => ({ value: tier, label: tier }))]}
              save={value => saveSchool({ tier: value || null })}/>
          </div>
          {labelMode && <div className="field-customizer"><b>تخصيص حقول المدرسة (لكل مدارس العنقود)</b>{SCHOOL_BASE_FIELDS.map(field =>
            <button className={!ws.hiddenSchoolFields.includes(field.key) ? "active" : ""} aria-pressed={!ws.hiddenSchoolFields.includes(field.key)} onClick={() => toggleHidden(field.key)} key={field.key}>{field.label}</button>)}</div>}
          <div className="editable-grid">
            {SCHOOL_BASE_FIELDS.filter(field => !ws.hiddenSchoolFields.includes(field.key)).map(field => {
              const value = school[field.key as keyof School];
              return <label key={field.key}><span>{field.label}</span>{
                field.kind === "boolean" ? <EditableSelect ariaLabel={field.label} value={String(value)} options={[{ value: "true", label: field.yes! }, { value: "false", label: field.no! }]} save={next => saveSchool({ [field.key]: next === "true" })}/>
                : field.kind === "select" ? <EditableSelect ariaLabel={field.label} value={String(value)} options={[{ value: "", label: "—" }, ...field.options!.map(option => ({ value: option, label: option }))]} save={next => saveSchool({ [field.key]: next })}/>
                : <EditableInput aria-label={field.label} value={String(value)} dir={field.kind === "email" ? "ltr" : undefined} inputMode={field.kind === "count" || field.kind === "ministryNo" ? "numeric" : undefined}
                    validate={next => field.kind === "count" ? countRule(next) : field.kind === "ministryNo" ? validators.ministryNo(next) : field.kind === "email" ? validators.email(next) : null}
                    save={(next, force) => saveSchool({ [field.key]: field.kind === "count" ? Number(toWesternDigits(next.trim())) : next.trim() }, force)}/>
              }</label>;
            })}
            {school.customFields.map(field => <CustomField key={field.id} school={school} field={field} updateSchool={updateSchool}/>)}
          </div>
          <button className="secondary-button inline" onClick={() => {
            const id = crypto.randomUUID();
            const field: LabelValue = { id, label: "حقل جديد", value: "", updatedAt: "" };
            create({ path: `/schools/${school.id}/custom-fields`, body: { id, label: field.label },
              apply: () => updateSchool(school.id, item => ({ ...item, customFields: [...item.customFields, field] })),
              rollback: () => updateSchool(school.id, item => ({ ...item, customFields: item.customFields.filter(value => value.id !== id) })) });
          }}><Plus/>إضافة حقل للمدرسة</button>
        </section>
        <StaffCard school={school} updateSchool={updateSchool}/>
        <LeadershipCard school={school} updateSchool={updateSchool}/>
      </div>
    </div>
  </>;
}

type UpdateSchool = (id: string, patch: Partial<School> | ((item: School) => School)) => void;

function CustomField({ school, field, updateSchool }: { school: School; field: LabelValue; updateSchool: UpdateSchool }) {
  const remove = useRemove();
  const path = `/schools/${school.id}/custom-fields/${field.id}`;
  const save = async (patch: Record<string, unknown>, force: boolean) => {
    const row = await api<Row>(path, { method: "PATCH", body: withVersion(patch, field.updatedAt, force) });
    updateSchool(school.id, item => ({ ...item, customFields: replaceById(item.customFields, field.id, { label: String(row.label), value: String(row.value), updatedAt: row.updatedAt }) }));
  };
  return <label>
    <LabelText label={field.label} save={label => save({ label }, true)}/>
    <div className="field-with-action">
      <EditableInput aria-label={field.label} value={field.value} save={(value, force) => save({ value }, force)}/>
      <button type="button" aria-label={`حذف حقل ${field.label}`} onClick={() => remove({
        text: "حُذف الحقل", path,
        apply: () => updateSchool(school.id, item => ({ ...item, customFields: item.customFields.filter(value => value.id !== field.id) })),
        rollback: () => updateSchool(school.id, item => ({ ...item, customFields: school.customFields })),
      })}><Trash2/></button>
    </div>
  </label>;
}

function StaffCard({ school, updateSchool }: { school: School; updateSchool: UpdateSchool }) {
  const create = useCreate();
  const remove = useRemove();
  const setTiles = (tiles: StaffTile[] | ((tiles: StaffTile[]) => StaffTile[])) =>
    updateSchool(school.id, item => ({ ...item, staffTiles: typeof tiles === "function" ? tiles(item.staffTiles) : tiles }));
  const add = () => {
    const id = crypto.randomUUID();
    create({ path: `/schools/${school.id}/staff-tiles`, body: { id, label: "مؤشر جديد", value: 0 },
      apply: () => setTiles(tiles => [...tiles, { id, label: "مؤشر جديد", value: 0, updatedAt: "" }]),
      rollback: () => setTiles(tiles => tiles.filter(tile => tile.id !== id)) });
  };
  return <section className="card">
    <div className="card-title-row"><h3>الهيئة التعليمية والإدارية</h3><button className="text-button" onClick={add}><Plus/>إضافة مؤشر</button></div>
    {school.staffTiles.length === 0 ? <Empty title="لا توجد مؤشرات بعد" action="إضافة مؤشر" onAction={add}/> : <div className="staff-grid">{school.staffTiles.map(tile => {
      const path = `/schools/${school.id}/staff-tiles/${tile.id}`;
      const save = async (patch: Record<string, unknown>, force: boolean) => {
        const row = await api<Row>(path, { method: "PATCH", body: withVersion(patch, tile.updatedAt, force) });
        setTiles(tiles => replaceById(tiles, tile.id, { label: String(row.label), value: Number(row.value), updatedAt: row.updatedAt }));
      };
      return <article className="stat-tile editable-tile" key={tile.id}>
        <button className="delete-corner" aria-label={`حذف ${tile.label}`} onClick={() => remove({ text: "حُذف المؤشر", path,
          apply: () => setTiles(tiles => tiles.filter(item => item.id !== tile.id)), rollback: () => setTiles(school.staffTiles) })}><X/></button>
        <LabelText label={tile.label} save={label => save({ label }, true)}/>
        <EditableInput aria-label={tile.label} inputMode="numeric" value={tile.value} validate={countRule} save={(value, force) => save({ value: Number(toWesternDigits(value.trim())) }, force)}/>
      </article>;
    })}</div>}
  </section>;
}

function LeadershipCard({ school, updateSchool }: { school: School; updateSchool: UpdateSchool }) {
  const { reload } = useMember();
  const create = useCreate();
  const remove = useRemove();
  const setRoles = (roles: (roles: LeadershipRole[]) => LeadershipRole[]) => updateSchool(school.id, item => ({ ...item, leadership: roles(item.leadership) }));
  const add = () => {
    const id = crypto.randomUUID();
    create({ path: `/schools/${school.id}/leadership`, body: { id },
      apply: () => setRoles(roles => [...roles, { id, role: "دور جديد", state: "مكلفة", updatedAt: "", fields: [] }]),
      rollback: () => setRoles(roles => roles.filter(role => role.id !== id)),
      then: () => { reload(); } });
  };
  return <section className="card">
    <div className="card-title-row"><h3>القيادة المدرسية</h3><button className="text-button" onClick={add}><Plus/>إضافة دور قيادي</button></div>
    {school.leadership.length === 0 ? <Empty title="لا توجد أدوار قيادية" action="إضافة دور قيادي" onAction={add}/> : <div className="leadership-stack">{school.leadership.map(role => {
      const path = `/schools/${school.id}/leadership/${role.id}`;
      const save = async (patch: Record<string, unknown>, force: boolean) => {
        const row = await api<Row>(path, { method: "PATCH", body: withVersion(patch, role.updatedAt, force) });
        setRoles(roles => replaceById(roles, role.id, { role: String(row.role), state: String(row.state), updatedAt: row.updatedAt }));
      };
      const setFields = (fields: (fields: LabelValue[]) => LabelValue[]) => setRoles(roles => replaceById(roles, role.id, item => ({ ...item, fields: fields(item.fields) })));
      return <article className="leadership-row" key={role.id}>
        <div className="leadership-meta">
          <LabelText as="b" label={role.role} save={value => save({ role: value }, true)}/>
          <EditableSelect className={`role-state ${role.state === "لا يوجد" ? "alert" : ""}`} ariaLabel={`حالة ${role.role}`} value={role.state}
            options={LEADERSHIP_STATES.map(state => ({ value: state, label: state }))} save={value => save({ state: value }, true)}/>
          <button className="danger-link" onClick={() => {
            if (!window.confirm(`حذف دور ${role.role}؟ سيتم حذف ${ar(role.fields.length)} حقول مرتبطة به.`)) return;
            remove({ text: "حُذف الدور", path, apply: () => setRoles(roles => roles.filter(item => item.id !== role.id)), rollback: () => setRoles(() => school.leadership) });
          }}><Trash2/>حذف الدور</button>
        </div>
        <div>
          <div className="editable-grid">{role.fields.map(field => {
            const fieldPath = `/leadership/${role.id}/fields/${field.id}`;
            const saveField = async (patch: Record<string, unknown>, force: boolean) => {
              const row = await api<Row>(fieldPath, { method: "PATCH", body: withVersion(patch, field.updatedAt, force) });
              setFields(fields => replaceById(fields, field.id, { label: String(row.label), value: String(row.value), updatedAt: row.updatedAt }));
            };
            return <label key={field.id}>
              <LabelText label={field.label} save={label => saveField({ label }, true)}/>
              <div className="field-with-action">
                <EditableInput aria-label={field.label} dir={field.label.includes("البريد") ? "ltr" : undefined} value={field.value} save={(value, force) => saveField({ value }, force)}/>
                <button type="button" aria-label={`حذف حقل ${field.label}`} onClick={() => remove({ text: "حُذف الحقل", path: fieldPath,
                  apply: () => setFields(fields => fields.filter(item => item.id !== field.id)), rollback: () => setFields(() => role.fields) })}><X/></button>
              </div>
            </label>;
          })}</div>
          <button className="text-button" onClick={() => {
            const id = crypto.randomUUID();
            create({ path: `/leadership/${role.id}/fields`, body: { id, label: "حقل جديد" },
              apply: () => setFields(fields => [...fields, { id, label: "حقل جديد", value: "", updatedAt: "" }]),
              rollback: () => setFields(fields => fields.filter(item => item.id !== id)) });
          }}><Plus/>حقل</button>
        </div>
      </article>;
    })}</div>}
  </section>;
}

export function Tier({ tier }: { tier: string }) { return <span className={`tier ${tier === "تهيئة" ? "alert" : ""}`}>{tier}</span>; }
