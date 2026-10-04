"use client";

import type { Visit, VisitInput } from "@rasd/schemas";
import { Check, LoaderCircle, X } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { NumberInput } from "./number-input";
import { useWorkspace } from "./workspace-context";

const VISIT_TYPES = ["زيارة صفية", "زيارة إشرافية", "متابعة خطة", "ورشة عمل"];
const OTHER = "__other";

/** Her visits, newest first, with add/remove that keep the list in sync. */
export function useVisits() {
  const { notify } = useWorkspace();
  const [visits, setVisits] = useState<Visit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Visit[]>("/member/visits")
      .then(list => !cancelled && setVisits([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
      .catch(() => !cancelled && setVisits([]));
    return () => { cancelled = true; };
  }, []);

  const add = useCallback((visit: Visit) => setVisits(list => [visit, ...(list ?? [])]), []);

  const remove = useCallback(async (visit: Visit) => {
    setVisits(list => (list ?? []).filter(item => item.id !== visit.id));
    try {
      await api.del(`/member/visits/${visit.id}`);
      notify("حُذفت الزيارة");
    } catch (error) {
      setVisits(list => [visit, ...(list ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      notify((error as Error).message, "error");
    }
  }, [notify]);

  return { visits, add, remove };
}

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

/** «سجّلي زيارة»: school, type, what happened — the rest is optional and folded away. */
export function VisitSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (visit: Visit) => void }) {
  const { workspace, notify } = useWorkspace();
  const schools = workspace.schools;
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

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    setSaving(true);
    const input: VisitInput = {
      type,
      text: text.trim(),
      beneficiaries,
      sessions,
      blockers: blockers.trim(),
      ...(schoolId === OTHER || !schoolId ? { schoolName: schoolName.trim() } : { schoolId }),
    };
    try {
      const visit = await api.post<Visit>("/member/visits", input);
      onSaved(visit);
      onClose();
      notify("حُفظت الزيارة");
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
    }
  };

  return (
    <Sheet title="سجّلي زيارة" onClose={onClose}
      footer={(
        <>
          {!schoolId && <p className="m-sheet-note" role="status">لم تختاري مدرسة بعد</p>}
          <button type="submit" form="visit-form" className="btn btn-primary btn-lg btn-block" disabled={saving}>
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
            <input ref={otherInput} className="input" value={schoolName} onChange={event => setSchoolName(event.target.value)}
              placeholder="مثال: الابتدائية ١٢٠" aria-label="اسم المدرسة" />
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
