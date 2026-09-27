"use client";

import { X } from "lucide-react";
import { createContext, Dispatch, InputHTMLAttributes, ReactNode, SetStateAction, useCallback, useContext, useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { ApiError, errorText, redirectIfSignedOut } from "../../lib/api";
import type { Workspace } from "../../lib/types";

export type ToastAction = { label: string; run: () => void };
export type Toast = { text: string; actions?: ToastAction[] };

type MemberContextValue = {
  ws: Workspace;
  setWs: Dispatch<SetStateAction<Workspace>>;
  reload: () => Promise<void>;
  labelMode: boolean;
  notify: (text: string, actions?: ToastAction[]) => void;
  /** Reports a failed save: session expiry → login; conflict → choice toast; otherwise error toast with retry. */
  fail: (error: unknown, retry?: () => void, forceSave?: () => void) => void;
};

export const MemberContext = createContext<MemberContextValue | null>(null);

export function useMember() {
  const value = useContext(MemberContext);
  if (!value) throw new Error("useMember must be used inside the member workspace");
  return value;
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((text: string, actions?: ToastAction[]) => {
    window.clearTimeout(timer.current);
    setToast({ text, actions });
    timer.current = window.setTimeout(() => setToast(null), 8000);
  }, []);
  const view = toast && <div className="action-toast" role="status"><span>{toast.text}</span>{toast.actions?.map(action => <button key={action.label} onClick={() => { setToast(null); action.run(); }}>{action.label}</button>)}<button aria-label="إغلاق التنبيه" onClick={() => setToast(null)}><X/></button></div>;
  return { notify, view };
}

export function makeFail(notify: MemberContextValue["notify"], reload: () => Promise<void>): MemberContextValue["fail"] {
  return (error, retry, forceSave) => {
    if (redirectIfSignedOut(error)) return;
    if (error instanceof ApiError && error.status === 409 && error.code === "CONFLICT") {
      notify("تم تعديل هذا الحقل من جهاز آخر", [
        ...(forceSave ? [{ label: "استخدام قيمتي", run: forceSave }] : []),
        { label: "استخدام القيمة الجديدة", run: () => { reload(); } },
      ]);
      return;
    }
    notify(errorText(error) || "تعذّر الحفظ — أعيدي المحاولة", retry ? [{ label: "إعادة المحاولة", run: retry }] : undefined);
  };
}

const fieldMessage = (error: unknown) => (error instanceof ApiError && error.fields ? Object.values(error.fields)[0] : error instanceof ApiError && error.status === 409 ? "" : errorText(error));

type EditableInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur"> & {
  value: string | number;
  /** Persist `next`; `force` skips the optimistic-concurrency check (after the user chose "use my value"). */
  save: (next: string, force: boolean) => Promise<unknown>;
  validate?: (next: string) => string | null;
};

/** Auto-saves on blur/Enter, Esc cancels. On failure the value reverts and the error shows under the field (EDITABILITY §1.1–1.3). */
export function EditableInput({ value, save, validate, className = "", ...rest }: EditableInputProps) {
  const { fail } = useMember();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");
  const editing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const commit = async (next: string, force = false) => {
    editing.current = false;
    if (cancelled.current) { cancelled.current = false; return; }
    if (next === String(value) && !force) { setError(""); return; }
    const message = validate?.(next) ?? null;
    if (message) { setError(message); return; }
    setError("");
    try {
      await save(next, force);
    } catch (reason) {
      setDraft(String(value));
      setError(fieldMessage(reason));
      fail(reason, () => { setDraft(next); commit(next, force); }, () => { setDraft(next); commit(next, true); });
    }
  };
  return <>
    <input {...rest} className={`${className} ${error ? "invalid" : ""}`} value={draft} aria-invalid={Boolean(error)}
      onFocus={() => { editing.current = true; }}
      onChange={event => { setDraft(event.target.value); if (error) setError(""); }}
      onBlur={() => commit(draft)}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { cancelled.current = true; setDraft(String(value)); setError(""); event.currentTarget.blur(); }
      }}/>
    {error && <small className="field-error">{error}</small>}
  </>;
}

/** A select that saves immediately on change, reverting if the server rejects it. */
export function EditableSelect({ value, options, save, className, ariaLabel }: { value: string; options: { value: string; label: string }[]; save: (next: string) => Promise<unknown>; className?: string; ariaLabel?: string }) {
  const { fail } = useMember();
  const [current, setCurrent] = useState(value);
  useEffect(() => setCurrent(value), [value]);
  const list = options.some(option => option.value === current) ? options : [{ value: current, label: current || "—" }, ...options];
  const change = async (next: string) => {
    setCurrent(next);
    try { await save(next); } catch (reason) { setCurrent(value); fail(reason, () => change(next)); }
  };
  return <select className={className} aria-label={ariaLabel} value={current} onChange={event => change(event.target.value)}>{list.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

/** A label that becomes a dashed rename input in label-edit mode (EDITABILITY Part 3). */
export function LabelText({ label, save, as = "span", className }: { label: string; save: (next: string) => Promise<unknown>; as?: "span" | "b" | "h3"; className?: string }) {
  const { labelMode } = useMember();
  if (!labelMode) { const Tag = as; return <Tag className={className}>{label}</Tag>; }
  return <EditableInput className="label-input" value={label} aria-label={`تعديل مسمى ${label}`} save={next => save(next.trim())}
    validate={next => (next.trim().length >= 1 && next.trim().length <= 60 ? null : "اسم الحقل مطلوب")}/>;
}

export function Empty({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><UploadCloud/><b>{title}</b>{action && <button className="secondary-button" onClick={onAction}>{action}</button>}</div>;
}

export function WorkspaceSection({ children }: { children: ReactNode }) { return <section className="workspace-section">{children}</section>; }

/** Converts Western digits to Arabic-Indic for display. */
export const digits = (value: string) => value.replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
