"use client";

import { VISIT_TYPES } from "@rasd/schemas";
import { Check, LoaderCircle, X } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { errorText } from "../../lib/api";
import { useActions } from "./actions";
import { useMember } from "./context";
import { NumberInput } from "./number-input";

const OTHER = "__other";

/** A bottom sheet on phones and a centred dialog on wider screens. Escape, the scrim and X close it. */
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="m-sheet" aria-labelledby="sheet-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="m-sheet-inner">
        <header className="m-sheet-head">
          <h2 id="sheet-title">{title}</h2>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="إغلاق"><X aria-hidden /></button>
        </header>
        <div className="m-sheet-body">{children}</div>
        <footer className="m-sheet-foot">{footer}</footer>
      </div>
    </dialog>
  );
}

/**
 * «سجّلي زيارة»: school, type, what happened — the rest is optional and folded away.
 * A school that is not on her list yet («مدرسة أخرى») is added to مدارسي first, because every visit belongs to one of her schools.
 */
export function VisitSheet({ onClose }: { onClose: () => void }) {
  const { ws, notify } = useMember();
  const { addSchool, addVisit } = useActions();
  const schools = ws.schools;
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0].id : schools.length ? "" : OTHER);
  const [schoolName, setSchoolName] = useState("");
  const [type, setType] = useState(VISIT_TYPES[0]);
  const [text, setText] = useState("");
  const [beneficiaries, setBeneficiaries] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [blockers, setBlockers] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const otherInput = useRef<HTMLInputElement>(null);
  const missingSchool = !schoolId || (schoolId === OTHER && !schoolName.trim());

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (missingSchool) return;
    setError("");
    setSaving(true);
    try {
      const target = schoolId === OTHER ? await addSchool(schoolName) : schoolId;
      if (!target) { setSaving(false); return; }
      await addVisit({ schoolId: target, type, text: text.trim(), beneficiaries, sessions, blockers: blockers.trim() });
      onClose();
      notify("حُفظت الزيارة");
    } catch (reason) {
      setError(errorText(reason));
      setSaving(false);
    }
  };

  return (
    <Sheet title="سجّلي زيارة" onClose={onClose}
      footer={(
        <>
          {missingSchool && <p className="m-sheet-note" role="status">{schoolId === OTHER ? "اكتبي اسم المدرسة" : "اختاري المدرسة"}</p>}
          <button type="submit" form="visit-form" className="btn btn-primary btn-lg btn-block" disabled={saving || missingSchool}>
            {saving ? <LoaderCircle className="m-spin" aria-hidden /> : <Check aria-hidden />}
            {saving ? "جارٍ الحفظ…" : "حفظ الزيارة"}
          </button>
        </>
      )}>
      <form id="visit-form" className="m-visit-form" onSubmit={submit}>
        <fieldset className="m-choice">
          <legend className="field-label">المدرسة</legend>
          {schools.length > 0 && (
            <div className="m-chips">
              {schools.map(school => (
                <button key={school.id} type="button" className={`m-chip${schoolId === school.id ? " is-on" : ""}`} aria-pressed={schoolId === school.id}
                  onClick={() => setSchoolId(school.id)}>
                  {school.name || "مدرسة بدون اسم"}
                </button>
              ))}
              <button type="button" className={`m-chip${schoolId === OTHER ? " is-on" : ""}`} aria-pressed={schoolId === OTHER}
                onClick={() => { setSchoolId(OTHER); window.setTimeout(() => otherInput.current?.focus(), 0); }}>
                مدرسة أخرى
              </button>
            </div>
          )}
          {schoolId === OTHER && (
            <>
              <input ref={otherInput} className="input" value={schoolName} onChange={event => setSchoolName(event.target.value)}
                placeholder="مثال: الابتدائية ١٢٠" aria-label="اسم المدرسة" />
              <p className="m-muted">تُضاف إلى مدارسي.</p>
            </>
          )}
        </fieldset>

        <fieldset className="m-choice">
          <legend className="field-label">نوع الزيارة</legend>
          <div className="m-chips">
            {VISIT_TYPES.map(item => (
              <button key={item} type="button" className={`m-chip${type === item ? " is-on" : ""}`} aria-pressed={type === item} onClick={() => setType(item)}>
                {item}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label className="field-label" htmlFor="visit-text">ماذا حدث؟</label>
          <textarea id="visit-text" className="input" rows={3} value={text} onChange={event => setText(event.target.value)}
            placeholder="مثال: حضرت حصة رياضيات واتفقنا على خطة علاجية" />
        </div>

        <details className="m-more">
          <summary>تفاصيل إضافية (اختياري)</summary>
          <div className="m-more-body">
            <div className="m-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="visit-beneficiaries">المستفيدات</label>
                <NumberInput id="visit-beneficiaries" value={beneficiaries} onChange={setBeneficiaries} placeholder="العدد" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="visit-sessions">الجلسات</label>
                <NumberInput id="visit-sessions" value={sessions} onChange={setSessions} placeholder="العدد" />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="visit-blockers">المعوقات</label>
              <input id="visit-blockers" className="input" value={blockers} onChange={event => setBlockers(event.target.value)}
                placeholder="مثال: نقص في أجهزة العرض" />
            </div>
          </div>
        </details>

        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
