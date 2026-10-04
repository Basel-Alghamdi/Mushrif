"use client";

import { ReactNode } from "react";
import { MemberProvider } from "../../components/member/context";
import { MemberShell } from "../../components/member/member-shell";
import "./member.css";

// The guard lives in MemberProvider: no Supabase session → /login; the head → /district; otherwise her file loads.
export default function ClusterLayout({ children }: { children: ReactNode }) {
  return (
    <MemberProvider>
      <MemberShell>{children}</MemberShell>
    </MemberProvider>
  );
}
