"use client";

import { ArrowRight, Menu, SquarePen, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { ChatProvider, useChat } from "../../lib/chat/chat-context";
import { HeadGuard } from "./session";
import { Sidebar } from "./sidebar";
import { ToastProvider } from "./toast";

/** خلود's workspace: auth guard + chat state + sidebar (fixed on desktop, a drawer on phones). */
export function DistrictShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <HeadGuard>
        <ChatProvider>
          <ShellFrame>{children}</ShellFrame>
        </ChatProvider>
      </HeadGuard>
    </ToastProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const onProfile = pathname.startsWith("/district/team/");
  const onTeam = pathname === "/district/team";

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".d-dialog-root")) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("d-no-scroll");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("d-no-scroll"); };
  }, [open]);

  return (
    <div className={`d-app ${open ? "is-drawer-open" : ""}`}>
      <aside className="d-sidebar" id="d-sidebar" aria-label="القائمة">
        <Sidebar onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
      </aside>
      <div className="d-drawer-scrim" onClick={() => setOpen(false)} aria-hidden />
      <div className="d-main">
        {/* Phones only: [☰ or back] title [team] [new chat] — both main places are one tap away. */}
        <header className="d-topbar">
          {onProfile ? (
            <Link href="/district/team" className="btn btn-ghost btn-icon" aria-label="رجوع إلى الفريق"><ArrowRight /></Link>
          ) : (
            <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="فتح القائمة" aria-expanded={open} aria-controls="d-sidebar">
              <Menu />
            </button>
          )}
          <TopbarTitle pathname={pathname} />
          <Link href="/district/team" className={`btn btn-ghost btn-icon ${onTeam ? "is-current" : ""}`} aria-label="الفريق والأرقام" aria-current={onTeam ? "page" : undefined}>
            <Users />
          </Link>
          <Link href="/district" className="btn btn-ghost btn-icon" aria-label="محادثة جديدة"><SquarePen /></Link>
        </header>
        {children}
      </div>
    </div>
  );
}

function TopbarTitle({ pathname }: { pathname: string }) {
  const { conversations } = useChat();
  let title = "محادثة جديدة";
  if (pathname.startsWith("/district/team/")) title = "ملف المشرفة";
  else if (pathname.startsWith("/district/team")) title = "الفريق والأرقام";
  else if (pathname.startsWith("/district/c/")) {
    const id = decodeURIComponent(pathname.split("/")[3] ?? "");
    title = conversations.find(item => item.id === id)?.title ?? "المحادثة";
  }
  return <span className="d-topbar-title">{title}</span>;
}
