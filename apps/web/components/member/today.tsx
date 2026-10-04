"use client";

import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { ar, counted, relativeTime } from "../../lib/format";
import type { VisitReport } from "../../lib/types";
import { useActions } from "./actions";
import { useMember } from "./context";
import { FIELD_FORMS, PLAN_FORMS, progressOf, SCHOOL_FORMS, SEP } from "./model";

/** «جهّزي ملفك ٦١٪» — one row per part of her file that is still missing something. Hidden once they are all done. */
export function SetupCard() {
  const { ws } = useMember();
  const progress = progressOf(ws);
  const schools = ws.schools.length;
  const rows = [
    { href: "/cluster/profile#next-empty", label: "بياناتي", done: progress.fields.length === 0,
      status: progress.fields.length ? `باقي ${counted(progress.fields.length, FIELD_FORMS)}` : "مكتملة" },
    { href: progress.firstIncomplete ? `/cluster/schools/${progress.firstIncomplete.id}` : "/cluster/schools", label: "مدارسي",
      done: schools > 0 && progress.gaps === 0,
      status: !schools ? "أضيفي مدارسك" : progress.gaps ? `باقي ${counted(progress.gaps, FIELD_FORMS)}` : counted(schools, SCHOOL_FORMS) },
    { href: "/cluster/reports#plans", label: "الخطط", done: progress.plansLeft === 0,
      status: progress.plansLeft ? `باقي ${counted(progress.plansLeft, PLAN_FORMS)}` : "مرفوعة" },
  ];
  if (rows.every(row => row.done)) return null;

  return (
    <section className="card m-setup" aria-labelledby="setup-title">
      <h2 id="setup-title">جهّزي ملفك <span>{ar(progress.completion)}٪</span></h2>
      <ul>
        {rows.map(row => (
          <li key={row.label}>
            <Link href={row.href} className={`m-setup-row${row.done ? " is-done" : ""}`}>
              <span className="m-setup-mark" aria-hidden>{row.done && <Check />}</span>
              <b>{row.label}</b>
              <span className="m-setup-status">{row.done && <span className="sr-only">تم — </span>}{row.status}</span>
              <ChevronLeft className="m-chev" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One row per school: «ثبّتُّه» becomes «تم ✓»; tapping again undoes it. */
export function AbsenceCard() {
  const { ws } = useMember();
  const { toggleAbsence } = useActions();
  if (!ws.schools.length) return null;

  return (
    <section className="card m-absence" aria-labelledby="absence-title">
      <h2 id="absence-title">هل ثبّتِّ غياب اليوم في نور؟</h2>
      <ul>
        {ws.schools.map(school => (
          <li key={school.id}>
            <button type="button" className={`m-absence-row${school.absenceToday ? " is-done" : ""}`} onClick={() => toggleAbsence(school)}
              aria-pressed={school.absenceToday}>
              <span className="m-absence-name">{school.name || "مدرسة بدون اسم"}</span>
              <span className="m-absence-btn">{school.absenceToday ? <>تم<Check aria-hidden /></> : "ثبّتُّه"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const useSchoolName = () => {
  const { ws } = useMember();
  return (visit: VisitReport) => ws.schools.find(school => school.id === visit.schoolId)?.name || "مدرسة محذوفة";
};

/** The last three visits as one-line rows. Nothing at all while there are none. */
export function RecentVisits() {
  const { visits } = useMember();
  const schoolName = useSchoolName();
  if (!visits.length) return null;
  return (
    <section className="m-recent" aria-labelledby="recent-title">
      <div className="m-recent-head">
        <h2 id="recent-title">آخر زياراتي</h2>
        <Link href="/cluster/reports" className="m-link">كل تقاريري<ChevronLeft aria-hidden /></Link>
      </div>
      <ul className="card m-lines">
        {visits.slice(0, 3).map(visit => (
          <li key={visit.id}>
            <span className="m-line-title">{schoolName(visit)}{SEP}{visit.type}</span>
            <time dateTime={visit.createdAt}>{relativeTime(visit.createdAt)}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
