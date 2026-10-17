"use client";

import { createContext, ReactNode, useContext, useEffect, useLayoutEffect, useState } from "react";
import { errorText, getMe, lastMe, redirectIfSignedOut } from "../../lib/api";
import { enforceSessionOnly } from "../../lib/supabase";
import type { Me } from "../../lib/types";

export type HeadUser = Me["user"];

const SessionContext = createContext<HeadUser | null>(null);

/** The signed-in head (خلود). Only available inside <HeadGuard>. */
export function useHead() {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useHead must be used inside <HeadGuard>");
  return user;
}

/**
 * Supabase session + /auth/me (main's pattern): only the head sees these pages; members go to /cluster, guests to /login.
 * A session that ends later (expired, or signed out in another tab) is caught by the next API call (401 → /login).
 */
export function HeadGuard({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HeadUser | null>(null);
  const [error, setError] = useState("");

  // Seen in this tab before: open her pages before the first paint, while /auth/me confirms in the background.
  useLayoutEffect(() => {
    const cached = lastMe()?.user;
    if (cached?.role === "head") setUser(cached);
  }, []);

  useEffect(() => {
    let cancelled = false;
    enforceSessionOnly()
      .then(() => getMe())
      .then(({ user }) => {
        if (cancelled) return;
        if (user.role !== "head") window.location.replace("/cluster");
        else setUser(user);
      })
      .catch(reason => { if (!cancelled && !redirectIfSignedOut(reason)) setError(errorText(reason)); });
    return () => { cancelled = true; };
  }, []);

  // A failed check only stops the pages when nothing was shown yet; otherwise their own requests report it.
  if (error && !user) {
    return (
      <div className="page-loading">
        <div className="d-load-error">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>
        </div>
      </div>
    );
  }
  if (!user) return <div className="page-loading"><span className="spinner" aria-label="جارٍ التحميل" /></div>;
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}
