"use client";

import { EDUCATION_TYPES, EVALUATION_DOMAINS, MADRASATI_METRICS, NAFES_GRADES, STAGES, SUPPORT_TYPES, TIERS } from "@rasd/schemas";
import { LoaderCircle, Plus } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { LeadershipRole, School } from "../../lib/types";
import { useActions } from "./actions";
import { useMember } from "./context";
import {
  ADMIN_TILE, isCoreFilled, LEADER_ROLES, NAME_FIELD, notesOf, NOTES_FIELD, PHONE_FIELD, principalOf, PRINCIPAL_ROLES, roleValue, TEACHERS_TILE, tileOf, toNumber,
} from "./model";
import { replaceById } from "./mutations";
import { NumberInput } from "./number-input";
import { AutoGrow, ChoiceChips, ConfirmDelete, Expander, Field } from "./ui";

const DISCIPLINE: { key: "daily" | "weekly" | "monthly"; label: string }[] = [
  { key: "daily", label: "يومي" },
  { key: "weekly", label: "أسبوعي" },
  { key: "monthly", label: "شهري" },
];

/** The values the server counts first (~one screen); additional data and indicators fold away. */
export function SchoolEditor({ school }: { school: School }) {
  const { update } = useMember();
  const actions = useActions();
  const { setSchool, setTile } = actions;
  const lastName = useRef(school.name);
  useEffect(() => { if (school.name.trim()) lastName.current = school.name; }, [school.name]);

  const empty = (key: Parameters<typeof isCoreFilled>[1]) => !isCoreFilled(school, key);
  const setName = (value: string) => {
    if (value.trim()) setSchool(school.id, "name", value);
    else update(ws => ({ ...ws, schools: replaceById(ws.schools, school.id, { name: value }) })); // a school needs a name: nothing is sent while the box is empty
  };
  const text = (key: "ministryNo" | "area", label: string, placeholder?: string) => (
    <Field label={label} htmlFor={`school-${key}`} empty={empty(key)}>
      <input id={`school-${key}`} className="input" value={school[key]} placeholder={placeholder} inputMode={key === "ministryNo" ? "numeric" : undefined}
        onChange={event => setSchool(school.id, key, event.target.value)} />
    </Field>
  );
  const count = (key: "students" | "classes", label: string) => (
    <div className={`field m-field${empty(key) ? " is-empty" : ""}`}>
      <label className="field-label" htmlFor={`school-${key}`}>{label}</label>
      <NumberInput id={`school-${key}`} value={school[key]} onChange={value => setSchool(school.id, key, value)} />
    </div>
  );

  return (
    <>
      <section className="card m-form">
        <Field label="اسم المدرسة" htmlFor="school-name" empty={!school.name.trim()}>
          <input id="school-name" className="input" value={school.name} placeholder="مثال: الابتدائية ١٢٠" onChange={event => setName(event.target.value)}
            onBlur={() => { if (!school.name.trim()) setSchool(school.id, "name", lastName.current, 0); }} />
        </Field>
        <ChoiceChips id="school-stage" label="المرحلة" options={STAGES} value={school.stage} empty={empty("stage")} placeholder="مثال: رياض أطفال"
          onChange={(stage, typed) => setSchool(school.id, "stage", stage, typed ? undefined : 0)} />
        <div className="m-grid-3">
          {count("students", "عدد الطالبات")}
          <div className="field">
            <label className="field-label" htmlFor="school-teachers">عدد المعلمات</label>
            <NumberInput id="school-teachers" value={tileOf(school, TEACHERS_TILE)?.value ?? 0} onChange={value => setTile(school.id, TEACHERS_TILE, value)} />
          </div>
          {count("classes", "عدد الفصول")}
        </div>
        <div className="m-grid-2 m-pair">
          {text("ministryNo", "الرقم الوزاري")}
          {text("area", "الحي", "مثال: حي النرجس")}
        </div>
        <Leadership school={school} />
        <Field label="ملاحظات" htmlFor="school-notes">
          <AutoGrow id="school-notes" value={notesOf(school)?.value ?? ""} onChange={event => actions.setNotes(school.id, event.target.value)} />
        </Field>
      </section>

      <div className="m-exp-group">
        <Expander title="بيانات إضافية"><Extras school={school} /></Expander>
        <Expander title="مؤشرات التقويم المدرسي"><Indicators school={school} /></Expander>
      </div>
    </>
  );
}

function YesNo({ id, label, value, yes, no, onChange }: { id: string; label: string; value: boolean; yes: string; no: string; onChange: (value: boolean) => void }) {
  return (
    <fieldset className="m-choice" id={id}>
      <legend className="field-label">{label}</legend>
      <div className="m-chips">
        {[true, false].map(option => (
          <button key={String(option)} type="button" className={`m-chip${value === option ? " is-on" : ""}`} aria-pressed={value === option} onClick={() => onChange(option)}>
            {option ? yes : no}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Extras({ school }: { school: School }) {
  const { setSchool, setTile, setCustom, addCustom, removeCustom } = useActions();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const custom = school.customFields.filter(field => field.label !== NOTES_FIELD);
  const otherTiles = school.staffTiles.filter(tile => tile.label !== TEACHERS_TILE && tile.label !== ADMIN_TILE);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    if (await addCustom(school.id, label)) { setLabel(""); setAdding(false); }
  };

  return (
    <>
      <Field label="بريد المدرسة" htmlFor="school-email">
        <input id="school-email" className="input" type="email" inputMode="email" dir="ltr" value={school.ministryEmail} placeholder="مثال: school@moe.gov.sa"
          onChange={event => setSchool(school.id, "ministryEmail", event.target.value)} />
      </Field>
      <ChoiceChips id="school-education" label="نوع التعليم" options={EDUCATION_TYPES} value={school.educationType}
        onChange={(value, typed) => setSchool(school.id, "educationType", value, typed ? undefined : 0)} />
      <Field label="برامج التربية الخاصة" htmlFor="school-special">
        <input id="school-special" className="input" value={school.specialEdProgram} placeholder="مثال: صعوبات التعلم"
          onChange={event => setSchool(school.id, "specialEdProgram", event.target.value)} />
      </Field>
      <div className="m-grid-3">
        <div className="field">
          <label className="field-label" htmlFor="school-admin">عدد الإداريات</label>
          <NumberInput id="school-admin" value={tileOf(school, ADMIN_TILE)?.value ?? 0} onChange={value => setTile(school.id, ADMIN_TILE, value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="school-gifted-classes">عدد فصول موهبة</label>
          <NumberInput id="school-gifted-classes" value={school.giftedClasses} onChange={value => setSchool(school.id, "giftedClasses", value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="school-gifted-students">عدد طالبات موهبة</label>
          <NumberInput id="school-gifted-students" value={school.giftedStudents} onChange={value => setSchool(school.id, "giftedStudents", value)} />
        </div>
        {otherTiles.map(tile => (
          <div className="field" key={tile.id}>
            <label className="field-label" htmlFor={`tile-${tile.id}`}>{tile.label}</label>
            <NumberInput id={`tile-${tile.id}`} value={tile.value} onChange={value => setTile(school.id, tile.label, value)} />
          </div>
        ))}
      </div>
      <YesNo id="school-guard" label="الحارس" value={school.hasGuard} yes="يوجد" no="لا يوجد" onChange={value => setSchool(school.id, "hasGuard", value, 0)} />
      <YesNo id="school-chinese" label="تطبيق اللغة الصينية" value={school.teachesChinese} yes="نعم" no="لا" onChange={value => setSchool(school.id, "teachesChinese", value, 0)} />
      {custom.map(field => (
        <Field key={field.id} label={field.label} htmlFor={`custom-${field.id}`}
          tools={<ConfirmDelete label={`حذف خانة ${field.label}`} onConfirm={() => void removeCustom(school.id, field)} />}>
          <input id={`custom-${field.id}`} className="input" value={field.value} onChange={event => setCustom(school.id, field.id, event.target.value)} />
        </Field>
      ))}
      {adding ? (
        <form className="m-add-row" onSubmit={add}>
          <label className="field-label" htmlFor="new-school-field">اسم الخانة</label>
          <div className="m-inline">
            <input id="new-school-field" className="input" value={label} autoFocus onChange={event => setLabel(event.target.value)} placeholder="مثال: عدد المباني" />
            <button type="submit" className="btn btn-primary" disabled={!label.trim()}>إضافة</button>
          </div>
          <button type="button" className="btn btn-ghost m-cancel" onClick={() => { setAdding(false); setLabel(""); }}>إلغاء</button>
        </form>
      ) : (
        <button type="button" className="m-link" onClick={() => setAdding(true)}>تحتاجين خانة غير موجودة؟ أضيفيها</button>
      )}
    </>
  );
}

/** A percentage 0–100 that may stay empty (null = not known yet, unlike 0). */
function PercentInput({ id, value, onChange, label }: { id: string; value: number | null; onChange: (value: number | null) => void; label?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  // Follow changes that come from elsewhere (another device, رئيسة النطاق).
  useEffect(() => {
    setText(current => ((current.trim() ? toNumber(current) : null) === value ? current : value === null ? "" : String(value)));
  }, [value]);
  return (
    <input id={id} className="input m-num" inputMode="numeric" value={text} placeholder="٪" aria-label={label}
      onChange={event => {
        const typed = event.target.value;
        if (!typed.trim()) { setText(typed); onChange(null); return; }
        const number = toNumber(typed);
        const capped = Math.min(100, number);
        setText(capped === number ? typed : String(capped));
        onChange(capped);
      }} />
  );
}

/** Level chips (tap the chosen one again to clear) for a set value, e.g. تصنيف المدرسة or a domain's level. */
function LevelChips({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="m-chips">
      {TIERS.map(tier => (
        <button type="button" key={tier} className={`m-chip${value === tier ? " is-on" : ""}`} aria-pressed={value === tier}
          onClick={() => onChange(value === tier ? "" : tier)}>
          {tier}
        </button>
      ))}
    </div>
  );
}

/** مؤشرات التقويم المدرسي — she fills them all now (رئيسة النطاق sees and can edit the same values). */
function Indicators({ school }: { school: School }) {
  const { setSchool, setMadrasati, setDiscipline, setEvaluation } = useActions();
  const evaluation = school.evaluation;
  const set = (change: Parameters<typeof setEvaluation>[1]) => setEvaluation(school.id, change);

  return (
    <>
      <fieldset className="m-choice">
        <legend className="field-label">تصنيف المدرسة</legend>
        <LevelChips value={school.tier ?? ""} onChange={tier => setSchool(school.id, "tier", tier || null, 0)} />
      </fieldset>
      <ChoiceChips id="school-support" label="نوع الدعم" options={SUPPORT_TYPES} value={evaluation?.supportType ?? ""} placeholder="مثال: دعم مكثف"
        onChange={supportType => set({ supportType })} />

      <h3 className="m-sub">مجالات التقويم المدرسي</h3>
      {EVALUATION_DOMAINS.map(domain => {
        const current = evaluation?.domains[domain.key] ?? { level: "", percent: null };
        return (
          <fieldset className="m-choice m-domain" key={domain.key}>
            <legend className="field-label">{domain.label}</legend>
            <div className="m-domain-row">
              <LevelChips value={current.level} onChange={level => set({ domains: { [domain.key]: { ...current, level } } })} />
              <PercentInput id={`domain-${domain.key}`} value={current.percent} label={`نسبة ${domain.label}`}
                onChange={percent => set({ domains: { [domain.key]: { ...current, percent } } })} />
            </div>
          </fieldset>
        );
      })}

      <h3 className="m-sub">نافس (٪)</h3>
      <div className="m-grid-3">
        {NAFES_GRADES.map(grade => (
          <div className="field" key={grade.key}>
            <label className="field-label" htmlFor={`nafes-${grade.key}`}>{grade.label}</label>
            <PercentInput id={`nafes-${grade.key}`} value={evaluation?.[grade.key] ?? null} onChange={value => set({ [grade.key]: value })} />
          </div>
        ))}
      </div>
      <div className="m-grid-2">
        <div className="field">
          <label className="field-label" htmlFor="school-qudrat">القدرات (٪)</label>
          <PercentInput id="school-qudrat" value={evaluation?.qudrat ?? null} onChange={qudrat => set({ qudrat })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="school-tahsili">التحصيلي (٪)</label>
          <PercentInput id="school-tahsili" value={evaluation?.tahsili ?? null} onChange={tahsili => set({ tahsili })} />
        </div>
      </div>

      <Field label="رابط التقرير الخارجي" htmlFor="school-report">
        <input id="school-report" className="input" type="url" inputMode="url" dir="ltr" value={evaluation?.externalReportUrl ?? ""} placeholder="https://"
          onChange={event => set({ externalReportUrl: event.target.value })} />
      </Field>
      <Field label="رابط التقرير الذاتي" htmlFor="school-self-report">
        <input id="school-self-report" className="input" type="url" inputMode="url" dir="ltr" value={evaluation?.selfReportUrl ?? ""} placeholder="https://"
          onChange={event => set({ selfReportUrl: event.target.value })} />
      </Field>

      <h3 className="m-sub">مؤشرات منصة مدرستي</h3>
      <div className="m-grid-2">
        {MADRASATI_METRICS.map((metric, index) => (
          <div className="field" key={metric.key}>
            <label className="field-label" htmlFor={`madrasati-${index}`}>{metric.label} (٪)</label>
            <NumberInput id={`madrasati-${index}`} max={100} value={school.madrasati[index] ?? 0} onChange={value => setMadrasati(school.id, index, value)} />
          </div>
        ))}
      </div>
      <h3 className="m-sub">مؤشر الانضباط</h3>
      <div className="m-grid-3">
        {DISCIPLINE.map(({ key, label }) => (
          <div className="field" key={key}>
            <label className="field-label" htmlFor={`discipline-${key}`}>{label} (٪)</label>
            <NumberInput id={`discipline-${key}`} max={100} value={school.discipline[key]} onChange={value => setDiscipline(school.id, key, value)} />
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * «القيادة»: role, name, phone — starting with the school's head (main's «مديرة المدرسة» role), whose role is the label
 * above her name, so her row is one line of inputs. Others: a role box with suggestions, then name and phone.
 */
function Leadership({ school }: { school: School }) {
  const { setRoleField, setRoleName, addRole, removeRole } = useActions();
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const principal = principalOf(school);
  const others = school.leadership.filter(role => role !== principal);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`role-${focusId}`)?.focus();
    setFocusId(null);
  }, [focusId, school.leadership]);

  const add = async () => {
    setBusy(true);
    const id = await addRole(school.id, principal ? "وكيلة" : PRINCIPAL_ROLES[0]);
    setBusy(false);
    if (id && principal) setFocusId(id);
  };
  const inputs = (role: LeadershipRole, nameLabel: string, labelled: boolean) => (
    <div className="m-grid-2 m-pair">
      <div className="field">
        {labelled && <label className="field-label m-leader-role" htmlFor={`leader-name-${role.id}`}>{nameLabel}</label>}
        <input id={`leader-name-${role.id}`} className="input" value={roleValue(role, NAME_FIELD)} placeholder="الاسم"
          aria-label={labelled ? undefined : `اسم ${nameLabel}`} onChange={event => setRoleField(school.id, role.id, NAME_FIELD, event.target.value)} />
      </div>
      <div className="field">
        {labelled && <label className="field-label" htmlFor={`leader-phone-${role.id}`}>الجوال</label>}
        <input id={`leader-phone-${role.id}`} className="input" type="tel" inputMode="tel" dir="ltr" value={roleValue(role, PHONE_FIELD)}
          placeholder={labelled ? undefined : "الجوال"} aria-label={labelled ? undefined : `جوال ${nameLabel}`}
          onChange={event => setRoleField(school.id, role.id, PHONE_FIELD, event.target.value)} />
      </div>
    </div>
  );

  return (
    <section className="m-leaders" aria-labelledby="leaders-title">
      <div className="m-leaders-head">
        <h2 id="leaders-title" className="field-label">القيادة</h2>
        <button type="button" className="m-link" onClick={() => void add()} disabled={busy}>
          {busy ? <LoaderCircle className="m-spin" aria-hidden /> : <Plus aria-hidden />}أضيفي قائدة أو وكيلة
        </button>
      </div>
      <datalist id="leader-roles">{LEADER_ROLES.map(role => <option key={role} value={role} />)}</datalist>

      {principal && inputs(principal, principal.role, true)}

      {others.map(role => {
        const who = role.role.trim() || "الوكيلة";
        return (
          <div className="m-leader" key={role.id}>
            <div className="m-inline">
              <input id={`role-${role.id}`} className="input" list="leader-roles" value={role.role} placeholder="الدور — مثال: وكيلة شؤون الطالبات" aria-label="الدور"
                onChange={event => setRoleName(school.id, role.id, event.target.value)} />
              <ConfirmDelete label={`حذف ${who}`} onConfirm={() => void removeRole(school.id, role)} />
            </div>
            {inputs(role, who, false)}
          </div>
        );
      })}
    </section>
  );
}
