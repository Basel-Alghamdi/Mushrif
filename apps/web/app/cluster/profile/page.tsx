"use client";

import type { ProfileField } from "@rasd/schemas";
import { useEffect, useRef } from "react";
import { ProfileFieldInput } from "../../../components/member/profile-input";
import { Account, CustomFields, Programs } from "../../../components/member/profile-extras";
import { Expander } from "../../../components/member/ui";
import { FIELD_FORMS, isEssential, isFilled, yearsSince, YEAR_FORMS } from "../../../components/member/model";
import { useWorkspace } from "../../../components/member/workspace-context";
import { ar, counted } from "../../../lib/format";

/** Short fields sit two to a row so the page stays short on a phone. */
const HALF = new Set(["phone", "national_id", "employee_no", "cluster", "hire_date", "major", "supervision_major"]);
function pairUp(fields: ProfileField[]) {
  const rows: ProfileField[][] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const next = fields[index + 1];
    if (next && HALF.has(field.id) && HALF.has(next.id)) {
      rows.push([field, next]);
      index += 1;
    } else rows.push([field]);
  }
  return rows;
}

/** Scrolls to a field (opening its section if folded) and focuses it. */
function focusField(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const details = element.closest("details");
  if (details && !details.open) details.open = true;
  element.scrollIntoView({ block: "center" });
  const target = element.matches("input,textarea,select,button") ? element : element.querySelector<HTMLElement>("input,textarea,button");
  target?.focus({ preventScroll: true });
}

export default function ProfilePage() {
  const { workspace, update } = useWorkspace();
  const profile = workspace.profile;
  const essentials = profile.filter(isEssential);
  const optional = profile.filter(field => field.optional && !field.derived && !field.custom);
  const custom = profile.filter(field => field.custom);
  const empty = essentials.filter(field => !isFilled(field.value));
  const hire = profile.find(field => field.id === "hire_date")?.value ?? "";
  const years = yearsSince(hire);

  const setValue = (id: string, value: string) =>
    update(current => ({
      ...current,
      profile: current.profile.map(field => (field.id === id ? { ...field, value, updatedAt: new Date().toISOString() } : field)),
    }));

  const goToEmpty = () => { if (empty[0]) focusField(`f-${empty[0].id}`); };

  // Links like /cluster/profile#f-phone, #next-empty or #account land on the right spot.
  const goToEmptyRef = useRef(goToEmpty);
  goToEmptyRef.current = goToEmpty;
  useEffect(() => {
    let timer: number | undefined;
    const land = () => {
      const target = decodeURIComponent(window.location.hash.slice(1));
      if (!target) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (target === "next-empty") goToEmptyRef.current();
        else if (target.startsWith("f-")) focusField(target);
        else {
          const section = document.getElementById(target);
          if (section instanceof HTMLDetailsElement) section.open = true;
          section?.scrollIntoView({ block: "start" });
        }
      }, 50);
    };
    land();
    window.addEventListener("hashchange", land);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", land);
    };
  }, []);

  const renderField = (field: ProfileField, essential: boolean) => (
    <ProfileFieldInput key={field.id} field={field} essential={essential} onChange={value => setValue(field.id, value)}
      note={field.id === "hire_date" && years !== null
        ? <p className="m-note">≈ {years === 0 ? "أقل من سنة" : counted(years, YEAR_FORMS)} خبرة</p>
        : undefined} />
  );
  const render = (fields: ProfileField[], essential: boolean) => pairUp(fields).map(row => (row.length === 2
    ? <div key={row[0].id} className="m-grid-2 m-pair">{row.map(field => renderField(field, essential))}</div>
    : renderField(row[0], essential)));

  return (
    <div className="m-page">
      <header className="m-head">
        <h1>بياناتي</h1>
        {empty.length > 0 ? (
          <p className="m-status">
            باقي {counted(empty.length, FIELD_FORMS)}،{" "}
            <button type="button" className="m-link" onClick={goToEmpty}>اذهبي للناقصة</button>
          </p>
        ) : (
          <p className="m-status is-done">ملفك مكتمل ✓</p>
        )}
      </header>

      <section className="card m-form" aria-label="البيانات الأساسية">
        {render(essentials, true)}
      </section>

      <div className="m-exp-group">
        <Expander id="extra" title="بيانات إضافية (اختياري)">
          {render(optional, false)}
          <CustomFields fields={custom} onValue={setValue} />
        </Expander>
        <Expander id="programs" title={<>التطوير المهني <span className="m-count">({ar(workspace.programs.length)})</span></>}>
          <Programs />
        </Expander>
        <Expander id="account" title="الحساب">
          <Account />
        </Expander>
      </div>
    </div>
  );
}
