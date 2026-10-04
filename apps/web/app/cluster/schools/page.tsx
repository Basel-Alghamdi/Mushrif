"use client";

import { ChevronLeft, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useActions } from "../../../components/member/actions";
import { useMember } from "../../../components/member/context";
import { SCHOOL_FORMS, SEP, TEACHERS_TILE, tierPill, tileOf } from "../../../components/member/model";
import { ar, counted } from "../../../lib/format";

export default function SchoolsPage() {
  const { ws } = useMember();
  const { addSchool } = useActions();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const schools = ws.schools;
  const teachersOf = (index: number) => tileOf(schools[index], TEACHERS_TILE)?.value ?? 0;
  const students = schools.reduce((sum, school) => sum + school.students, 0);
  const teachers = schools.reduce((sum, _, index) => sum + teachersOf(index), 0);

  // Only the name is asked here; the school page opens right after.
  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const id = await addSchool(name);
    setBusy(false);
    if (id) router.push(`/cluster/schools/${id}`);
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
          {schools.map((school, index) => (
            <li key={school.id}>
              <Link href={`/cluster/schools/${school.id}`} className="card m-school-card">
                <span className="m-school-main">
                  <b>{school.name || "مدرسة بدون اسم"}</b>
                  <span className="m-school-meta">
                    {[school.stage, `${ar(school.students)} طالبة`, `${ar(teachersOf(index))} معلمة`].filter(Boolean).join(SEP)}
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
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <LoaderCircle className="m-spin" aria-hidden />}إضافة</button>
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
