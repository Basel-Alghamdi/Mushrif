"use client";

import type { School, SchoolLeader } from "@rasd/schemas";
import { Plus } from "lucide-react";
import {
  DISCIPLINE_LABELS, EDUCATION_TYPES, LEADER_ROLES, leaderValue, MADRASATI_LABELS, newLeader, PRINCIPAL_ROLE, setLeaderValue, STAGES, TIERS,
} from "./model";
import { NumberInput } from "./number-input";
import { AutoGrow, ChoiceChips, ConfirmDelete, Expander, Field } from "./ui";

type Patch = (patch: Partial<School>) => void;
type NumberKey = "students" | "teachers" | "classes" | "admin" | "deputies" | "giftedClasses" | "giftedStudents";
type TextKey = "area" | "ministryNo" | "email" | "support" | "nafes";

const COUNTS: { key: NumberKey; label: string }[] = [
  { key: "students", label: "عدد الطالبات" },
  { key: "teachers", label: "عدد المعلمات" },
  { key: "classes", label: "عدد الفصول" },
];

const EXTRA_COUNTS: { key: NumberKey; label: string }[] = [
  { key: "admin", label: "عدد الإداريات" },
  { key: "deputies", label: "عدد الوكيلات" },
  { key: "giftedClasses", label: "فصول الموهوبات" },
  { key: "giftedStudents", label: "الطالبات الموهوبات" },
];

/** The essentials first (~one screen); additional data and indicators fold away. */
export function SchoolEditor({ school, onPatch }: { school: School; onPatch: Patch }) {
  const madrasati = MADRASATI_LABELS.map((_, index) => Number(school.madrasati?.[index]) || 0);
  const discipline = DISCIPLINE_LABELS.map((_, index) => Number(school.discipline?.[index]) || 0);
  const setListValue = (key: "madrasati" | "discipline", list: number[], index: number, value: number) =>
    onPatch({ [key]: list.map((item, position) => (position === index ? value : item)) });

  const text = (key: TextKey, label: string, placeholder?: string, ltr = false) => (
    <Field key={key} label={label} htmlFor={`school-${key}`}>
      <input id={`school-${key}`} className="input" value={String(school[key] ?? "")} placeholder={placeholder}
        type={ltr ? "email" : "text"} inputMode={ltr ? "email" : key === "ministryNo" ? "numeric" : undefined} dir={ltr ? "ltr" : undefined}
        onChange={event => onPatch({ [key]: event.target.value })} />
    </Field>
  );
  const count = ({ key, label }: { key: NumberKey; label: string }) => (
    <div className="field" key={key}>
      <label className="field-label" htmlFor={`school-${key}`}>{label}</label>
      <NumberInput id={`school-${key}`} value={Number(school[key]) || 0} onChange={value => onPatch({ [key]: value })} />
    </div>
  );

  return (
    <>
      <section className="card m-form">
        <Field label="اسم المدرسة" htmlFor="school-name">
          <input id="school-name" className="input" value={school.name} placeholder="مثال: الابتدائية ١٢٠" onChange={event => onPatch({ name: event.target.value })} />
        </Field>
        <ChoiceChips id="school-stage" label="المرحلة" options={STAGES} value={school.stage} onChange={stage => onPatch({ stage })} placeholder="مثال: رياض أطفال" />
        <div className="m-grid-3">{COUNTS.map(count)}</div>
        <Leadership school={school} onPatch={onPatch} />
        <Field label="ملاحظات" htmlFor="school-notes">
          <AutoGrow id="school-notes" value={school.notes ?? ""} onChange={event => onPatch({ notes: event.target.value })} />
        </Field>
      </section>

      <div className="m-exp-group">
        <Expander title="بيانات إضافية">
          {text("area", "الحي", "مثال: حي النرجس")}
          {text("ministryNo", "الرقم الوزاري")}
          {text("email", "بريد المدرسة", "مثال: school@moe.gov.sa", true)}
          <ChoiceChips id="school-educationType" label="نوع التعليم" options={EDUCATION_TYPES} value={school.educationType}
            onChange={educationType => onPatch({ educationType })} />
          <div className="m-grid-2">{EXTRA_COUNTS.map(count)}</div>
        </Expander>

        <Expander title="المؤشرات (تعبّئها رئيسة النطاق عادةً)">
          <fieldset className="m-choice">
            <legend className="field-label">تصنيف المدرسة</legend>
            <div className="m-chips">
              {TIERS.map(tier => (
                <button type="button" key={tier} className={`m-chip${school.tier === tier ? " is-on" : ""}`} aria-pressed={school.tier === tier}
                  onClick={() => onPatch({ tier: school.tier === tier ? "" : tier })}>
                  {tier}
                </button>
              ))}
            </div>
          </fieldset>
          {text("support", "الدعم المقدّم", "مثال: دعم في التخطيط")}
          {text("nafes", "نتيجة نافس", "مثال: ٧٢٪ أو متقدم")}
          <div className="m-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="school-qudrat">متوسط القدرات</label>
              <NumberInput id="school-qudrat" decimal value={Number(school.qudrat) || 0} onChange={value => onPatch({ qudrat: value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="school-tahsili">متوسط التحصيلي</label>
              <NumberInput id="school-tahsili" decimal value={Number(school.tahsili) || 0} onChange={value => onPatch({ tahsili: value })} />
            </div>
          </div>
          <h3 className="m-sub">منصة مدرستي</h3>
          <div className="m-grid-2">
            {MADRASATI_LABELS.map((label, index) => (
              <div className="field" key={label}>
                <label className="field-label" htmlFor={`madrasati-${index}`}>{label} (٪)</label>
                <NumberInput id={`madrasati-${index}`} decimal value={madrasati[index]} onChange={value => setListValue("madrasati", madrasati, index, value)} />
              </div>
            ))}
          </div>
          <h3 className="m-sub">الانضباط</h3>
          <div className="m-grid-3">
            {DISCIPLINE_LABELS.map((label, index) => (
              <div className="field" key={label}>
                <label className="field-label" htmlFor={`discipline-${index}`}>{label} (٪)</label>
                <NumberInput id={`discipline-${index}`} decimal value={discipline[index]} onChange={value => setListValue("discipline", discipline, index, value)} />
              </div>
            ))}
          </div>
        </Expander>
      </div>
    </>
  );
}

/**
 * «القيادة»: role, name, phone — starting with قائدة المدرسة (shown even before it exists), whose role is the
 * label above her name, so the whole row is one line of inputs. school.principal always mirrors her name.
 */
function Leadership({ school, onPatch }: { school: School; onPatch: Patch }) {
  const leaders = school.leadership ?? [];
  const firstPrincipal = leaders.find(leader => leader.role === PRINCIPAL_ROLE);
  const placeholderId = `${school.id}-principal`;
  const placeholder: SchoolLeader = setLeaderValue({ ...newLeader(PRINCIPAL_ROLE), id: placeholderId }, "name", "الاسم", school.principal ?? "");
  const principal = firstPrincipal ?? placeholder;
  const others = leaders.filter(leader => leader !== firstPrincipal);

  const commit = (next: SchoolLeader[]) => {
    const head = next.find(leader => leader.role === PRINCIPAL_ROLE);
    if (head) onPatch({ leadership: next, principal: leaderValue(head, "name") });
    else onPatch({ leadership: next }); // keep a principal name that only lives in school.principal
  };
  const change = (row: SchoolLeader, apply: (leader: SchoolLeader) => SchoolLeader) => {
    if (row.id === placeholderId && !firstPrincipal) commit([apply(row), ...leaders]);
    else commit(leaders.map(leader => (leader.id === row.id ? apply(leader) : leader)));
  };
  const setName = (row: SchoolLeader, value: string) => change(row, leader => setLeaderValue(leader, "name", "الاسم", value));
  const setPhone = (row: SchoolLeader, value: string) => change(row, leader => setLeaderValue(leader, "phone", "الجوال", value));

  return (
    <section className="m-leaders" aria-labelledby="leaders-title">
      <div className="m-leaders-head">
        <h2 id="leaders-title" className="field-label">القيادة</h2>
        <button type="button" className="m-link" onClick={() => commit([...leaders, newLeader("")])}>
          <Plus aria-hidden />أضيفي قائدة أو وكيلة
        </button>
      </div>
      <datalist id="leader-roles">{LEADER_ROLES.slice(1).map(role => <option key={role} value={role} />)}</datalist>

      <div className="m-grid-2 m-pair">
        <div className="field">
          <label className="field-label m-leader-role" htmlFor="leader-principal-name">{PRINCIPAL_ROLE}</label>
          <input id="leader-principal-name" className="input" value={leaderValue(principal, "name")} placeholder="الاسم"
            onChange={event => setName(principal, event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="leader-principal-phone">الجوال</label>
          <input id="leader-principal-phone" className="input" type="tel" inputMode="tel" dir="ltr" value={leaderValue(principal, "phone")}
            onChange={event => setPhone(principal, event.target.value)} />
        </div>
      </div>

      {others.map(row => {
        const who = row.role || "الوكيلة";
        return (
          <div className="m-leader" key={row.id}>
            <div className="m-inline">
              <input className="input" list="leader-roles" value={row.role} placeholder="الدور — مثال: وكيلة شؤون الطالبات" aria-label="الدور"
                onChange={event => change(row, leader => ({ ...leader, role: event.target.value }))} />
              <ConfirmDelete label={`حذف ${who}`} onConfirm={() => commit(leaders.filter(leader => leader.id !== row.id))} />
            </div>
            <div className="m-grid-2">
              <input className="input" value={leaderValue(row, "name")} placeholder="الاسم" aria-label={`اسم ${who}`}
                onChange={event => setName(row, event.target.value)} />
              <input className="input" type="tel" inputMode="tel" dir="ltr" value={leaderValue(row, "phone")} placeholder="الجوال" aria-label={`جوال ${who}`}
                onChange={event => setPhone(row, event.target.value)} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
