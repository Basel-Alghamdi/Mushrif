"use client";

import type { PublicUser } from "@rasd/schemas";
import { useRouter } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, ApiRequestError, getToken, goToLogin } from "../../lib/api";

const SessionContext = createContext<PublicUser | null>(null);

/** The signed-in head (خلود). Only available inside <HeadGuard>. */
export function useHead() {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useHead must be used inside <HeadGuard>");
  return user;
}

/** Loads /auth/me and only renders children for the head; members go to /cluster, guests to /login. */
export function HeadGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) { goToLogin(); return; }
    let cancelled = false;
    api.get<{ user: PublicUser }>("/auth/me")
      .then(({ user }) => {
        if (cancelled) return;
        if (user.role !== "head") router.replace("/cluster");
        else setUser(user);
      })
      .catch((reason: ApiRequestError) => { if (!cancelled && reason.status !== 401) setError(reason.message); });
    return () => { cancelled = true; };
  }, [router]);

  if (error) {
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
