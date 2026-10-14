"use client";

import { VISIT_TYPES } from "@rasd/schemas";
import { Check, LoaderCircle, X } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { errorText } from "../../lib/api";
import { useActions } from "./actions";
import { useMember } from "./context";

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
 * «سجّلي زيارة»: school, type («أخرى» lets her type it), and the purpose of the visit.
 * A school that is not on her list yet («مدرسة أخرى») is added to مدارسي first, because every visit belongs to one of her schools.
 */
export function VisitSheet({ onClose }: { onClose: () => void }) {
  const { ws, notify } = useMember();
  const { addSchool, addVisit } = useActions();
  const schools = ws.schools;
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0].id : schools.length ? "" : OTHER);
  const [schoolName, setSchoolName] = useState("");
  const [type, setType] = useState(VISIT_TYPES[0]);
  const [otherType, setOtherType] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const otherInput = useRef<HTMLInputElement>(null);
  const otherTypeInput = useRef<HTMLInputElement>(null);
  const missingSchool = !schoolId || (schoolId === OTHER && !schoolName.trim());
  const visitType = type === OTHER ? otherType.trim() : type;
  const missing = missingSchool ? (schoolId === OTHER ? "اكتبي اسم المدرسة" : "اختاري المدرسة") : !visitType ? "اكتبي نوع الزيارة" : "";

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (missing) return;
    setError("");
    setSaving(true);
    try {
      const target = schoolId === OTHER ? await addSchool(schoolName) : schoolId;
      if (!target) { setSaving(false); return; }
      await addVisit({ schoolId: target, type: visitType, text: text.trim() });
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
          {missing && <p className="m-sheet-note" role="status">{missing}</p>}
          <button type="submit" form="visit-form" className="btn btn-primary btn-lg btn-block" disabled={saving || Boolean(missing)}>
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
            <button type="button" className={`m-chip${type === OTHER ? " is-on" : ""}`} aria-pressed={type === OTHER}
              onClick={() => { setType(OTHER); window.setTimeout(() => otherTypeInput.current?.focus(), 0); }}>
              أخرى
            </button>
          </div>
          {type === OTHER && (
            <input ref={otherTypeInput} className="input" value={otherType} onChange={event => setOtherType(event.target.value)} maxLength={200}
              placeholder="مثال: زيارة استطلاعية" aria-label="نوع الزيارة" />
          )}
        </fieldset>

        <div className="field">
          <label className="field-label" htmlFor="visit-text">الهدف من الزيارة</label>
          <textarea id="visit-text" className="input" rows={3} value={text} onChange={event => setText(event.target.value)}
            placeholder="مثال: متابعة تنفيذ الخطة العلاجية في الرياضيات" />
        </div>

        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
