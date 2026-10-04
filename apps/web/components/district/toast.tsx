"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type Action = { label: string; run: () => void };
type Toast = { id: number; text: string; action?: Action };
type Show = (text: string, action?: Action) => void;
const ToastContext = createContext<Show>(() => {});

/** Shows a short message at the bottom of the screen: `toast("تم الحفظ")`, or with one action: `toast("حُذفت", { label: "تراجع", run })`. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<Show>((text, action) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    timer.current = window.setTimeout(() => setToast(null), action ? 8000 : 3800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">{toast?.text}</div>
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action
            ? <button onClick={() => { setToast(null); toast.action!.run(); }}>{toast.action.label}</button>
            : <button onClick={() => setToast(null)}>حسناً</button>}
        </div>
      )}
    </ToastContext.Provider>
  );
}
