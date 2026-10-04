"use client";

import type { PublicUser } from "@rasd/schemas";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { MemberShell } from "../../components/member/member-shell";
import { WorkspaceProvider } from "../../components/member/workspace-context";
import { api, getToken } from "../../lib/api";
import "./member.css";

export default function ClusterLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api.get<{ user: PublicUser }>("/auth/me")
      .then(({ user: me }) => {
        if (me.role === "head") router.replace("/district");
        else setUser(me);
      })
      .catch(reason => setError((reason as Error).message)); // 401 is redirected to /login by lib/api
  }, [router]);

  if (error) {
    return (
      <div className="m-boot">
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!user) return <div className="m-boot"><span className="spinner" aria-hidden /><p>جارٍ فتح حسابك…</p></div>;

  return (
    <WorkspaceProvider initialUser={user}>
      <MemberShell>{children}</MemberShell>
    </WorkspaceProvider>
  );
}
