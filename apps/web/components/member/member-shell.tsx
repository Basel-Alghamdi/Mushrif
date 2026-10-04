"use client";

import { ClipboardList, House, School, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { useMember } from "./context";
import { displayName, initialsOf } from "./model";
import { SaveIndicator } from "./ui";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/cluster", label: "اليوم", icon: House },
  { href: "/cluster/schools", label: "مدارسي", icon: School },
  { href: "/cluster/reports", label: "تقاريري", icon: ClipboardList },
  { href: "/cluster/profile", label: "بياناتي", icon: UserRound },
];

const isActive = (pathname: string, href: string) =>
  href === "/cluster" ? pathname === "/cluster" : pathname === href || pathname.startsWith(`${href}/`);

export function MemberShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/cluster";
  const { me, ws, saveState, retry, flush } = useMember();
  const name = displayName(ws, me.name);

  // Leaving a box sends what she typed right away (the pause timer is only for while she is still typing).
  useEffect(() => {
    const send = (event: FocusEvent) => { if ((event.target as Element | null)?.matches?.("input,textarea")) flush(); };
    document.addEventListener("focusout", send);
    return () => document.removeEventListener("focusout", send);
  }, [flush]);

  return (
    <div className="m-shell">
      <header className="m-top">
        <Link href="/cluster" className="m-brand" aria-label="رَصد — اليوم">
          <span className="m-brand-mark" aria-hidden>ر</span>
          <span className="m-brand-name">رَصد</span>
        </Link>
        <SaveIndicator state={saveState} onRetry={retry} />
      </header>

      <aside className="m-side" aria-label="القائمة">
        <nav className="m-side-nav">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className={`m-side-link${isActive(pathname, item.href) ? " is-active" : ""}`}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <item.icon aria-hidden />{item.label}
            </Link>
          ))}
        </nav>
        <div className="m-side-user">
          <i className="avatar avatar-sm" aria-hidden>{initialsOf(name)}</i>
          <span>
            <b>{name}</b>
            <small dir="ltr">{me.email}</small>
          </span>
        </div>
      </aside>

      <main className="m-main" id="main">{children}</main>

      <nav className="m-tabs" aria-label="التنقل">
        {NAV.map(item => (
          <Link key={item.href} href={item.href} className={`m-tab${isActive(pathname, item.href) ? " is-active" : ""}`}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}>
            <item.icon aria-hidden />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
