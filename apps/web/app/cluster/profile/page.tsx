"use client";

import { yearsSinceHijri } from "@rasd/schemas";
import { useEffect, useRef } from "react";
import { useActions } from "../../../components/member/actions";
import { useMember } from "../../../components/member/context";
import { emptyFields, FIELD_FORMS, splitProfile, YEAR_FORMS } from "../../../components/member/model";
import { Account, CustomFields, Programs } from "../../../components/member/profile-extras";
import { ProfileFieldInput } from "../../../components/member/profile-input";
import { Expander } from "../../../components/member/ui";
import { ar, counted } from "../../../lib/format";
import type { ProfileField } from "../../../lib/types";

/** Short fields sit two to a row so the page stays short on a phone. */
const HALF = new Set(["phone", "nationalId", "employeeNo", "hireDate", "major", "supervisoryMajor"]);
function pairUp(fields: ProfileField[]) {
  const rows: ProfileField[][] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const next = fields[index + 1];
    if (next && HALF.has(field.key ?? "") && HALF.has(next.key ?? "")) {
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
  const { ws } = useMember();
  const { setProfileValue } = useActions();
  const { essentials, extras, custom } = splitProfile(ws.profile);
  const empty = emptyFields(ws.profile);
  const extrasLeft = emptyFields([...extras, ...custom]).length;
  const hire = ws.profile.find(field => field.key === "hireDate")?.value ?? "";
  const years = yearsSinceHijri(hire);

  // Same order as on screen, so «اذهبي للناقصة» always lands on the next one down.
  const ordered = [...essentials, ...extras, ...custom].filter(field => empty.includes(field));
  const goToEmpty = () => { if (ordered[0]) focusField(`f-${ordered[0].id}`); };

  // Links like /cluster/profile#next-empty or #account land on the right spot.
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

  const renderField = (field: ProfileField) => (
    <ProfileFieldInput key={field.id} field={field} empty onChange={(value, typed) => setProfileValue(field, value, typed ? undefined : 0)}
      note={field.key === "hireDate" && years !== ""
        ? <p className="m-note">≈ {years === "0" ? "أقل من سنة" : counted(Number(years), YEAR_FORMS)} خبرة</p>
        : undefined} />
  );
  const render = (fields: ProfileField[]) => pairUp(fields).map(row => (row.length === 2
    ? <div key={row[0].id} className="m-grid-2 m-pair">{row.map(renderField)}</div>
    : renderField(row[0])));

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
        {render(essentials)}
      </section>

      <div className="m-exp-group">
        <Expander id="extra" title={<>بيانات إضافية {extrasLeft > 0 && <span className="m-count">(باقي {ar(extrasLeft)})</span>}</>}>
          {render(extras)}
          <CustomFields fields={custom} />
        </Expander>
        <Expander id="programs" title={<>التطوير المهني <span className="m-count">({ar(ws.programs.length)})</span></>}>
          <Programs />
        </Expander>
        <Expander id="account" title="الحساب">
          <Account />
        </Expander>
      </div>
    </div>
  );
}

