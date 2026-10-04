"use client";

import type { ProfileField, Program } from "@rasd/schemas";
import { ChevronDown, Eye, EyeOff, LoaderCircle, LogOut, Plus } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, logout } from "../../lib/api";
import { ar } from "../../lib/format";
import { newCustomField, newId } from "./model";
import { NumberInput } from "./number-input";
import { ConfirmDelete, Field, reveal, revealOnOpen } from "./ui";
import { useWorkspace } from "./workspace-context";

// ---------- Custom fields (label + value, deletable) ----------
export function CustomFields({ fields, onValue }: { fields: ProfileField[]; onValue: (id: string, value: string) => void }) {
  const { update } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const remove = (id: string) => update(current => ({ ...current, profile: current.profile.filter(field => field.id !== id) }));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    update(current => ({ ...current, profile: [...current.profile, newCustomField(label, value)] }));
    setLabel("");
    setValue("");
    setAdding(false);
  };

  return (
    <>
      {fields.map(field => (
        <Field key={field.id} label={field.label} htmlFor={`f-${field.id}`}
          tools={<ConfirmDelete label={`حذف خانة ${field.label}`} onConfirm={() => remove(field.id)} />}>
          <input id={`f-${field.id}`} className="input" value={field.value} onChange={event => onValue(field.id, event.target.value)} />
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

// ---------- Professional development ----------
const PROGRAM_KINDS = ["دورة تدريبية", "ورشة عمل", "برنامج تطويري", "مجتمع تعلم مهني", "لقاء"];

export function Programs() {
  const { workspace, update } = useWorkspace();
  const programs = workspace.programs;
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

  const setPrograms = (change: (programs: Program[]) => Program[]) => update(current => ({ ...current, programs: change(current.programs) }));
  const patch = (id: string, value: Partial<Program>) => setPrograms(list => list.map(item => (item.id === id ? { ...item, ...value } : item)));

  // A program is created only once it has a name.
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const program: Program = { id: newId(), label: name.trim(), kind: "", count: 0, url: "", status: "" };
    setPrograms(list => [...list, program]);
    setOpened(program.id);
    added.current = program.id;
    setName("");
    setAdding(false);
  };

  return (
    <>
      <datalist id="program-kinds">{PROGRAM_KINDS.map(kind => <option key={kind} value={kind} />)}</datalist>
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
                    <input id={`program-label-${program.id}`} className="input" value={program.label} onChange={event => patch(program.id, { label: event.target.value })} />
                  </div>
                  <div className="m-grid-2">
                    <div className="field">
                      <label className="field-label" htmlFor={`program-kind-${program.id}`}>النوع</label>
                      <input id={`program-kind-${program.id}`} className="input" list="program-kinds" value={program.kind} placeholder="مثال: ورشة عمل"
                        onChange={event => patch(program.id, { kind: event.target.value })} />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor={`program-count-${program.id}`}>عدد المستفيدات</label>
                      <NumberInput id={`program-count-${program.id}`} value={Number(program.count) || 0} onChange={count => patch(program.id, { count })} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={`program-url-${program.id}`}>الرابط <span className="m-optional">(اختياري)</span></label>
                    <input id={`program-url-${program.id}`} className="input" type="url" inputMode="url" dir="ltr" value={program.url} placeholder="https://"
                      onChange={event => patch(program.id, { url: event.target.value })} />
                  </div>
                  <ConfirmDelete variant="link" label="حذف البرنامج" onConfirm={() => setPrograms(list => list.filter(item => item.id !== program.id))} />
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
  const { user, flush, notify } = useWorkspace();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < 4) {
      setState({ busy: false, error: "اكتبي ٤ أحرف أو أرقام على الأقل" });
      return;
    }
    setState({ busy: true, error: "" });
    try {
      await api.post("/auth/password", { current, next });
      setCurrent("");
      setNext("");
      setState({ busy: false, error: "" });
      notify("تغيّرت كلمة المرور");
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  const signOut = async () => {
    await flush();
    await logout();
  };

  return (
    <>
      <div className="field">
        <span className="field-label">بريد الدخول</span>
        <span className="m-readonly" dir="ltr">{user.email}</span>
      </div>
      <form className="m-password" onSubmit={changePassword}>
        <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
        <div className="field">
          <label className="field-label" htmlFor="password-current">كلمة المرور الحالية</label>
          <input id="password-current" className="input" type="password" value={current} dir="ltr"
            onChange={event => setCurrent(event.target.value)} autoComplete="current-password" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password-next">كلمة المرور الجديدة</label>
          <div className="m-pass">
            <input id="password-next" className="input" type={show ? "text" : "password"} value={next} dir="ltr"
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
      <button type="button" className="btn btn-danger btn-block" onClick={() => void signOut()}>
        <LogOut aria-hidden />تسجيل الخروج
      </button>
    </>
  );
}
