"use client";

import { X } from "lucide-react";
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
};

/**
 * Modal dialog (a bottom sheet on phones), rendered into <body>. Escape, the X and the scrim close it.
 * Only the middle scrolls, so the footer buttons stay visible above the phone keyboard.
 */
export function Dialog({ title, description, onClose, children, footer }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus the first input, otherwise the first footer button (the safe "back/cancel" one in confirmations).
    const root = panel.current;
    const first = root?.querySelector<HTMLElement>("input, textarea, select") ?? root?.querySelector<HTMLElement>(".d-dialog-foot .btn") ?? root?.querySelector<HTMLElement>("button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("d-no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("d-no-scroll");
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="d-dialog-root">
      <div className="d-scrim" onClick={onClose} />
      <div className="d-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <header className="d-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="إغلاق"><X /></button>
        </header>
        {(description || children) && (
          <div className={`d-dialog-scroll ${footer ? "" : "is-last"}`}>
            {description && <div className="d-dialog-desc">{description}</div>}
            {children && <div className="d-dialog-body">{children}</div>}
          </div>
        )}
        {footer && <footer className="d-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
};

/** Yes/no dialog; the confirm button shows a spinner while the action runs and errors stay visible. */
export function ConfirmDialog({ title, description, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>رجوع</button>
        <button className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} onClick={confirm} disabled={busy}>
          {busy && <span className="spinner spinner-light" />}{confirmLabel}
        </button>
      </>}
    >
      {error && <p className="field-error" role="alert">{error}</p>}
    </Dialog>
  );
}
