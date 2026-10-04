"use client";

import { Check, ChevronDown, CloudOff, LoaderCircle, Trash2 } from "lucide-react";
import { MouseEvent, ReactNode, TextareaHTMLAttributes, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SaveState } from "./context";

/** Shows «جارٍ الحفظ…», then «حُفظ ✓» for two seconds, then nothing. Errors stay until she retries. */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const [showSaved, setShowSaved] = useState(false);
  const previous = useRef(state);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (state !== "saved" || was === "saved") {
      if (state !== "saved") setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === "saving") {
    return <span className="m-save is-saving" role="status"><LoaderCircle className="m-spin" aria-hidden />جارٍ الحفظ…</span>;
  }
  if (state === "error") {
    return (
      <button type="button" className="m-save is-error" onClick={onRetry}>
        <CloudOff aria-hidden />لم يُحفظ — إعادة المحاولة
      </button>
    );
  }
  return (
    <span className="m-save" role="status" aria-live="polite">
      {showSaved && <><Check aria-hidden />حُفظ</>}
    </span>
  );
}

/** Two-tap delete: the first tap asks, the second confirms. */
export function ConfirmDelete({ onConfirm, label, confirmLabel = "نعم، احذفي", variant = "icon" }: {
  onConfirm: () => void;
  label: string;
  confirmLabel?: string;
  variant?: "icon" | "link";
}) {
  const [asking, setAsking] = useState(false);
  const confirm = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!asking) return;
    reveal(confirm.current); // near the bottom, the question could otherwise sit under the tab bar
    const timer = window.setTimeout(() => setAsking(false), 6000);
    return () => window.clearTimeout(timer);
  }, [asking]);

  if (asking) {
    return (
      <span className="m-confirm" ref={confirm}>
        <button type="button" className="btn m-confirm-yes" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>إلغاء</button>
      </span>
    );
  }
  if (variant === "link") {
    return <button type="button" className="m-link is-danger" onClick={() => setAsking(true)}>{label}</button>;
  }
  return (
    <button type="button" className="btn btn-icon btn-ghost m-icon-danger" onClick={() => setAsking(true)} aria-label={label} title={label}>
      <Trash2 aria-hidden />
    </button>
  );
}

/** A label + input pair. An empty essential field gets a soft amber border, nothing more. */
export function Field({ label, htmlFor, children, empty, note, tools }: {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  empty?: boolean;
  note?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <div className={`field m-field${empty ? " is-empty" : ""}`}>
      <div className="m-field-head">
        <label className="field-label" htmlFor={htmlFor}>{label}</label>
        {tools}
      </div>
      {children}
      {note}
    </div>
  );
}

/**
 * Single choice as tap chips, with «أخرى» revealing a free-text box. Tapping the chosen chip again clears it.
 * When a listed option is already chosen as the page opens, only that chip shows, with «تغيير» to see the others.
 * Picking a chip never collapses the list under her finger; it stays open until she leaves the page.
 */
export function ChoiceChips({ id, label, options, value, onChange, placeholder = "اكتبي هنا", empty }: {
  id: string;
  label: string;
  options: string[];
  value: string;
  /** `typed` is true while she writes in «أخرى» (saved after a pause); taps save at once. */
  onChange: (value: string, typed?: boolean) => void;
  placeholder?: string;
  empty?: boolean;
}) {
  const isCustom = value.trim() !== "" && !options.includes(value);
  const [other, setOther] = useState(isCustom);
  const [expanded, setExpanded] = useState(() => !options.includes(value));
  const otherInput = useRef<HTMLInputElement>(null);
  const group = useRef<HTMLFieldSetElement>(null);
  const showOther = other || isCustom;

  useEffect(() => { if (isCustom) setOther(true); }, [isCustom]);

  if (!expanded && options.includes(value)) {
    return (
      <fieldset className="m-choice" id={id} ref={group}>
        <legend className="field-label">{label}</legend>
        <button type="button" className="m-chosen" aria-label={`${label}: ${value} — تغيير`}
          onClick={() => {
            setExpanded(true);
            requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(".m-chip.is-on")?.focus());
          }}>
          <span className="m-chip is-on">{value}</span>
          <span className="m-chosen-change">تغيير</span>
        </button>
      </fieldset>
    );
  }

  return (
    <fieldset className={`m-choice${empty ? " is-empty" : ""}`} id={id} ref={group}>
      <legend className="field-label">{label}</legend>
      <div className="m-chips">
        {options.map(option => (
          <button key={option} type="button" className={`m-chip${value === option ? " is-on" : ""}`} aria-pressed={value === option}
            onClick={() => { setOther(false); onChange(value === option ? "" : option); }}>
            {option}
          </button>
        ))}
        <button type="button" className={`m-chip${showOther ? " is-on" : ""}`} aria-pressed={showOther}
          onClick={() => {
            if (showOther) { setOther(false); if (isCustom) onChange(""); return; }
            setOther(true);
            if (options.includes(value)) onChange("");
            window.setTimeout(() => otherInput.current?.focus(), 0);
          }}>
          أخرى
        </button>
      </div>
      {showOther && (
        <input ref={otherInput} id={`${id}-other`} className="input" value={isCustom ? value : ""} placeholder={placeholder}
          aria-label={`${label} — أخرى`} onChange={event => onChange(event.target.value, true)} />
      )}
    </fieldset>
  );
}

/**
 * Brings a fold that just opened fully into view, scrolling as little as possible: it stops above the
 * bottom tab bar and below the header (see scroll-margin in member.css). A tall fold lands with its title at the top.
 */
export function reveal(element: Element | null) {
  if (!element) return;
  requestAnimationFrame(() => {
    if (element instanceof HTMLDetailsElement && !element.open) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  });
}

/** For a <summary>: when her tap opens the fold, show what opened. */
export const revealOnOpen = (event: MouseEvent<HTMLElement>) => {
  const details = event.currentTarget.parentElement;
  if (details instanceof HTMLDetailsElement && !details.open) reveal(details);
};

/** A collapsed row that opens in place and scrolls what it reveals into view. */
export function Expander({ id, title, children }: { id?: string; title: ReactNode; children: ReactNode }) {
  return (
    <details className="card m-exp" id={id}>
      <summary onClick={revealOnOpen}>
        <span className="m-exp-title">{title}</span>
        <ChevronDown className="m-exp-chev" aria-hidden />
      </summary>
      <div className="m-exp-body">{children}</div>
    </details>
  );
}

/** A one-line textarea that grows with what she writes. */
export function AutoGrow({ className = "", value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className={`input m-grow ${className}`} value={value} {...props} />;
}
