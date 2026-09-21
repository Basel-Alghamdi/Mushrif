"use client";

import { Bell, ChevronDown, LogOut, Menu, Search, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { accounts } from "../lib/platform-data";

export type NavItem = { key: string; label: string; badge?: string; alert?: boolean };

export function PlatformShell({ role, nav, active, onNavigate, children, asideFooter }: {
  role: "member" | "head";
  nav: NavItem[];
  active: string;
  onNavigate: (key: string) => void;
  children: ReactNode;
  asideFooter?: ReactNode;
}) {
  const user = accounts[role];
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<"notifications" | "profile" | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!popupRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setDrawer(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  const notifications = role === "head"
    ? ["٣ عضوات لم يحدّثن بياناتهن اليوم", "عنقود ٢ انخفض انضباطه إلى ٦٤٪", "وصل ملف عنقود ٤ محدّثاً من هند الشمري"]
    : ["لم تُثبّتي الغياب في ٣ مدارس اليوم", "باقي رفع استمارة تنفيذ الخطة ٣", "تم استيراد تصنيف نافس لمدارسك"];

  return <div className="rs-app">
    <header className="rs-header">
      <div className="header-brand"><button className="drawer-button" onClick={() => setDrawer(true)} aria-label="فتح القائمة"><Menu/></button><span className="brand-tile">ر</span><strong>رَصد</strong><span className={`role-pill ${role}`}>{user.role}</span></div>
      <label className="global-search"><Search size={17}/><input aria-label="البحث العام" placeholder="ابحثي عن مدرسة، عضوة، أو مؤشر…"/></label>
      <div className="header-actions" ref={popupRef}>
        {role === "member" && <Link className="field-link" href="/field"><Smartphone size={16}/>عرض الجوال الميداني</Link>}
        <button className="square-button" aria-label="التنبيهات" aria-expanded={menu === "notifications"} onClick={() => setMenu(menu === "notifications" ? null : "notifications")}><Bell size={18}/><i>{role === "head" ? "٧" : "٣"}</i></button>
        <button className="profile-trigger" aria-expanded={menu === "profile"} onClick={() => setMenu(menu === "profile" ? null : "profile")}><span className={`avatar ${role}`}>{user.initials}</span><span><b>{user.name}</b><small>{user.role}</small></span><ChevronDown size={15}/></button>
        {menu === "notifications" && <div className="header-popup notifications"><div className="popup-title">التنبيهات <span>{notifications.length}</span></div>{notifications.map((item, index) => <div className="notification" key={item}><i className={index === 2 ? "info" : "attention"}/><span>{item}<small>{index === 0 ? "منذ ١٠ دقائق" : "اليوم"}</small></span></div>)}</div>}
        {menu === "profile" && <div className="header-popup profile-popup"><div><b>{user.name}</b><span dir="ltr">{user.email}</span></div><button>الملف الشخصي</button><button>الإعدادات والصلاحيات</button><Link href="/login"><LogOut size={15}/>تسجيل الخروج</Link></div>}
      </div>
    </header>
    {drawer && <button className="drawer-scrim" aria-label="إغلاق القائمة" onClick={() => setDrawer(false)}/>} 
    <div className="rs-body">
      <aside className={`rs-sidebar ${drawer ? "open" : ""}`}>
        <button className="drawer-close" onClick={() => setDrawer(false)} aria-label="إغلاق القائمة"><X/></button>
        {role === "member" && <div className="completion-card"><div><span>اكتمال ملف العنقود</span><b>٧٨٪</b></div><div className="progress"><i style={{width:"78%"}}/></div></div>}
        <nav className="side-nav">{nav.map((item) => <button key={item.key} className={active === item.key ? "active" : ""} onClick={() => {onNavigate(item.key); setDrawer(false); window.scrollTo({top:0, behavior:"smooth"});}}><i className={item.alert ? "alert" : ""}/><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}</button>)}</nav>
        {asideFooter}
      </aside>
      <main className="rs-main">{children}</main>
    </div>
  </div>;
}

export function PageTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-title"><div><span>{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function StatusPill({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return <div className="progress"><i style={{width:`${value}%`, background:color}}/></div>;
}
