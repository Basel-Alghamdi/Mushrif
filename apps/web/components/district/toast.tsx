"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type Toast = { id: number; text: string };
const ToastContext = createContext<(text: string) => void>(() => {});

/** Shows a short message at the bottom of the screen: `const toast = useToast(); toast("تم الحفظ")`. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text });
    timer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">{toast?.text}</div>
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)}>حسناً</button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
