"use client";

import { PD_KINDS } from "@rasd/schemas";
import { ChevronDown, Eye, EyeOff, LoaderCircle, LogOut, Plus } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ar } from "../../lib/format";
import { signOut, supabase } from "../../lib/supabase";
import type { ProfileField } from "../../lib/types";
import { useActions } from "./actions";
import { useMember } from "./context";
import { NumberInput } from "./number-input";
import { ConfirmDelete, Field, reveal, revealOnOpen } from "./ui";

const MIN_PASSWORD = 8; // also enforced by the API

// ---------- Custom fields (label + value, deletable) ----------
export function CustomFields({ fields }: { fields: ProfileField[] }) {
  const { setProfileValue, addCustomField, removeCustomField } = useActions();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    if (!(await addCustomField(label, value))) return;
    setLabel("");
    setValue("");
    setAdding(false);
  };

  return (
    <>
      {fields.map(field => (
        <Field key={field.id} label={field.label} htmlFor={`f-${field.id}`}
          tools={<ConfirmDelete label={`حذف خانة ${field.label}`} onConfirm={() => void removeCustomField(field)} />}>
          <input id={`f-${field.id}`} className="input" value={field.value} onChange={event => setProfileValue(field, event.target.value)} />
        </Field>
      ))}
      {adding ? (
        <form className="m-add-row" onSubmit={add}>
          <div className="m-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="new-field-label">اسم الخانة</label>
              <input id="new-field-label" className="input" value={label} autoFocus onChange={event => setLabel(event.target.value)} placeholder="مثال: رقم المكتب" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="new-field-value">القيمة</label>
              <input id="new-field-value" className="input" value={value} onChange={event => setValue(event.target.value)} />
            </div>
          </div>
          <div className="m-actions">
            <button type="submit" className="btn btn-primary" disabled={!label.trim()}><Plus aria-hidden />إضافة</button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>إلغاء</button>
          </div>
        </form>
      ) : (
        <button type="button" className="m-link" onClick={() => setAdding(true)}>تحتاجين خانة غير موجودة؟ أضيفيها</button>
      )}
    </>
  );
}

// ---------- Professional development (main's pd_programs) ----------
const KINDS = Object.entries(PD_KINDS) as [keyof typeof PD_KINDS, string][];

export function Programs() {
  const { ws } = useMember();
  const { addProgram, setProgram, removeProgram } = useActions();
  const programs = ws.programs;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const added = useRef<string | null>(null);

  // A new program opens with its fields in view, not under the tab bar.
  useEffect(() => {
    if (!added.current) return;
    reveal(document.getElementById(`program-${added.current}`));
    added.current = null;
  }, [programs]);

  // A program is created only once it has a name.
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const id = await addProgram(name);
    if (!id) return;
    setOpened(id);
    added.current = id;
    setName("");
    setAdding(false);
  };

  return (
    <>
      {programs.length > 0 && (
        <ul className="m-programs">
          {programs.map(program => (
            <li key={program.id}>
              <details className="m-program" id={`program-${program.id}`} open={opened === program.id || undefined}>
                <summary onClick={revealOnOpen}>
                  <b>{program.label || "برنامج بدون اسم"}</b>
                  {program.count > 0 && <span>{ar(program.count)} مستفيدة</span>}
                  <ChevronDown className="m-exp-chev" aria-hidden />
                </summary>
                <div className="m-program-body">
                  <div className="field">
                    <label className="field-label" htmlFor={`program-label-${program.id}`}>اسم البرنامج</label>
                    <input id={`program-label-${program.id}`} className="input" value={program.label} onChange={event => setProgram(program, "label", event.target.value)} />
                  </div>
                  <fieldset className="m-choice">
                    <legend className="field-label">النوع</legend>
                    <div className="m-chips">
                      {KINDS.map(([kind, label]) => (
                        <button key={kind} type="button" className={`m-chip${program.kind === kind ? " is-on" : ""}`} aria-pressed={program.kind === kind}
                          onClick={() => setProgram(program, "kind", kind, 0)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="field">
                    <label className="field-label" htmlFor={`program-count-${program.id}`}>عدد المستفيدات</label>
                    <NumberInput id={`program-count-${program.id}`} value={program.count} onChange={count => setProgram(program, "count", count)} />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={`program-url-${program.id}`}>رابط التقارير <span className="m-optional">(اختياري)</span></label>
                    <input id={`program-url-${program.id}`} className="input" type="url" inputMode="url" dir="ltr" value={program.reportsUrl} placeholder="https://"
                      onChange={event => setProgram(program, "reportsUrl", event.target.value)} />
                  </div>
                  <ConfirmDelete variant="link" label="حذف البرنامج" onConfirm={() => void removeProgram(program)} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form className="m-add-row" onSubmit={add}>
          <label className="field-label" htmlFor="new-program">اسم البرنامج</label>
          <div className="m-inline">
            <input id="new-program" className="input" value={name} autoFocus onChange={event => setName(event.target.value)} placeholder="مثال: التعلم النشط" />
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>إضافة</button>
          </div>
          <button type="button" className="btn btn-ghost m-cancel" onClick={() => { setAdding(false); setName(""); }}>إلغاء</button>
        </form>
      ) : (
        <button type="button" className="btn btn-add btn-block" onClick={() => setAdding(true)}><Plus aria-hidden />أضيفي برنامجاً</button>
      )}
    </>
  );
}

// ---------- Account: login email, password, sign out ----------
export function Account() {
  const { me, settle, notify } = useMember();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });

  // Supabase changes the password of the signed-in session; the current one is checked first by signing in with it.
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD) {
      setState({ busy: false, error: `اكتبي ${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل` });
      return;
    }
    setState({ busy: true, error: "" });
    const { error: wrong } = await supabase.auth.signInWithPassword({ email: me.email, password: current });
    if (wrong) {
      setState({ busy: false, error: "كلمة المرور الحالية غير صحيحة" });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      setState({ busy: false, error: error.message.includes("different") ? "اختاري كلمة مرور مختلفة عن الحالية" : "تعذّر تغيير كلمة المرور — أعيدي المحاولة" });
      return;
    }
    setCurrent("");
    setNext("");
    setState({ busy: false, error: "" });
    notify("تغيّرت كلمة المرور");
  };

  const leave = async () => {
    await settle();
    await signOut();
  };

  return (
    <>
      <div className="field">
        <span className="field-label">بريد الدخول</span>
        <span className="m-readonly" dir="ltr">{me.email}</span>
      </div>
      <form className="m-password" onSubmit={changePassword}>
        <input type="text" name="username" autoComplete="username" value={me.email} readOnly hidden />
        <div className="field">
          <label className="field-label" htmlFor="password-current">كلمة المرور الحالية</label>
          <input id="password-current" className="input" type="password" value={current}
            onChange={event => { setCurrent(event.target.value); setState(value => ({ ...value, error: "" })); }} autoComplete="current-password" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password-next">كلمة المرور الجديدة</label>
          <div className="m-pass">
            <input id="password-next" className="input" type={show ? "text" : "password"} value={next}
              onChange={event => { setNext(event.target.value); setState(value => ({ ...value, error: "" })); }} autoComplete="new-password" />
            <button type="button" className="m-eye" onClick={() => setShow(value => !value)} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={show}>
              {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </button>
          </div>
        </div>
        {state.error && <p className="field-error" role="alert">{state.error}</p>}
        <button type="submit" className="btn btn-secondary" disabled={state.busy || !current || !next}>
          {state.busy && <LoaderCircle className="m-spin" aria-hidden />}تغيير كلمة المرور
        </button>
      </form>
      <button type="button" className="btn btn-danger btn-block" onClick={() => void leave()}>
        <LogOut aria-hidden />تسجيل الخروج
      </button>
    </>
  );
}
