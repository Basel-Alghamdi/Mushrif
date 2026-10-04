"use client";

import type { Visit } from "@rasd/schemas";
import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { ar, counted, relativeTime } from "../../lib/format";
import { absenceDoneToday, FIELD_FORMS, progressOf, riyadhToday, SCHOOL_FORMS, SEP } from "./model";
import { useWorkspace } from "./workspace-context";

/** «جهّزي ملفك ٦١٪» — three one-line rows. Hidden once everything is done. */
export function SetupCard() {
  const { workspace, documents } = useWorkspace();
  const progress = progressOf(workspace, documents.length);
  if (progress.completion >= 100) return null;
  const left = progress.emptyFields.length;
  const schools = workspace.schools.length;
  const rows = [
    { href: "/cluster/profile#next-empty", label: "بياناتي", done: left === 0, status: left ? `باقي ${counted(left, FIELD_FORMS)}` : "مكتملة" },
    { href: "/cluster/schools", label: "مدارسي", done: schools > 0, status: schools ? counted(schools, SCHOOL_FORMS) : "أضيفي مدارسك" },
    { href: "/cluster/reports", label: "تقاريري", done: progress.hasDocuments, status: progress.hasDocuments ? "تم" : "ارفعي أول ملف" },
  ];

  return (
    <section className="card m-setup" aria-labelledby="setup-title">
      <h2 id="setup-title">جهّزي ملفك <span>{ar(progress.completion)}٪</span></h2>
      <ul>
        {rows.map(row => (
          <li key={row.href}>
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
  const { workspace, update } = useWorkspace();
  const schools = workspace.schools;
  if (!schools.length) return null;

  const toggle = (id: string) => {
    const today = riyadhToday();
    update(current => ({
      ...current,
      schools: current.schools.map(school =>
        school.id === id ? { ...school, absence: !absenceDoneToday(school), absenceDate: today, updatedAt: new Date().toISOString() } : school),
    }));
  };

  return (
    <section className="card m-absence" aria-labelledby="absence-title">
      <h2 id="absence-title">هل ثبّتِّ غياب اليوم في نور؟</h2>
      <ul>
        {schools.map(school => {
          const done = absenceDoneToday(school);
          return (
            <li key={school.id}>
              <button type="button" className={`m-absence-row${done ? " is-done" : ""}`} onClick={() => toggle(school.id)} aria-pressed={done}>
                <span className="m-absence-name">{school.name || "مدرسة بدون اسم"}</span>
                <span className="m-absence-btn">{done ? <>تم<Check aria-hidden /></> : "ثبّتُّه"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The last three visits as one-line rows. Nothing at all while there are none. */
export function RecentVisits({ visits }: { visits: Visit[] | null }) {
  if (!visits?.length) return null;
  return (
    <section className="m-recent" aria-labelledby="recent-title">
      <div className="m-recent-head">
        <h2 id="recent-title">آخر زياراتي</h2>
        <Link href="/cluster/reports" className="m-link">كل تقاريري<ChevronLeft aria-hidden /></Link>
      </div>
      <ul className="card m-lines">
        {visits.slice(0, 3).map(visit => (
          <li key={visit.id}>
            <span className="m-line-title">{visit.schoolName || "بدون مدرسة"}{SEP}{visit.type}</span>
            <time dateTime={visit.createdAt}>{relativeTime(visit.createdAt)}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
