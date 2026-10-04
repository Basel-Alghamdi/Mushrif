"use client";

import { ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ar, counted } from "../../../lib/format";
import { newSchool, SCHOOL_FORMS, SEP, tierPill } from "../../../components/member/model";
import { useWorkspace } from "../../../components/member/workspace-context";

export default function SchoolsPage() {
  const { workspace, update } = useWorkspace();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const schools = workspace.schools;
  const students = schools.reduce((sum, school) => sum + (Number(school.students) || 0), 0);
  const teachers = schools.reduce((sum, school) => sum + (Number(school.teachers) || 0), 0);

  // Only the name is asked here; the school page opens right after.
  const add = (event: FormEvent) => {
    event.preventDefault();
    const school = newSchool(name || "مدرسة جديدة");
    update(current => ({ ...current, schools: [...current.schools, school] }));
    router.push(`/cluster/schools/${school.id}`);
  };

  return (
    <div className="m-page">
      <header className="m-head">
        <h1>مدارسي</h1>
        {schools.length >= 2 && (
          <p className="m-status">{[counted(schools.length, SCHOOL_FORMS), `${ar(students)} طالبة`, `${ar(teachers)} معلمة`].join(SEP)}</p>
        )}
      </header>

      {schools.length === 0 && !adding && <p className="m-lead">أضيفي مدارس عنقودك لتثبّتي غيابها وتسجّلي زياراتك.</p>}

      {schools.length > 0 && (
        <ul className="m-school-list">
          {schools.map(school => (
            <li key={school.id}>
              <Link href={`/cluster/schools/${school.id}`} className="card m-school-card">
                <span className="m-school-main">
                  <b>{school.name || "مدرسة بدون اسم"}</b>
                  <span className="m-school-meta">
                    {[school.stage, `${ar(Number(school.students) || 0)} طالبة`, `${ar(Number(school.teachers) || 0)} معلمة`].filter(Boolean).join(SEP)}
                  </span>
                </span>
                {school.tier && <span className={`pill ${tierPill(school.tier)}`}>{school.tier}</span>}
                <ChevronLeft className="m-chev" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="card m-add-row" onSubmit={add}>
          <label className="field-label" htmlFor="new-school">اسم المدرسة</label>
          <div className="m-inline">
            <input id="new-school" className="input" value={name} onChange={event => setName(event.target.value)} autoFocus placeholder="مثال: الابتدائية ١٢٠" />
            <button type="submit" className="btn btn-primary">إضافة</button>
          </div>
          <button type="button" className="btn btn-ghost m-cancel" onClick={() => { setAdding(false); setName(""); }}>إلغاء</button>
        </form>
      ) : (
        <button type="button" className={`btn btn-lg btn-block ${schools.length ? "btn-add" : "btn-primary"}`} onClick={() => setAdding(true)}>
          <Plus aria-hidden />أضيفي مدرسة
        </button>
      )}
    </div>
  );
}
