"use client";

import { Bell, ChevronDown, LogOut, Menu, Search, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { apiRead, apiWrite } from "../lib/use-persistent-state";

export type NavItem = { key: string; label: string; badge?: string };

export function PlatformShell({ role, nav, active, onNavigate, children, asideFooter, completion = 78, searchItems = [] }: {
  role: "member" | "head";
  nav: NavItem[];
  active: string;
  onNavigate: (key: string) => void;
  children: ReactNode;
  asideFooter?: ReactNode;
  completion?: number;
  searchItems?: {id:string;title:string;meta:string;target:string}[];
}) {
  const fallback=role==="head"?{name:"رئيسة النطاق",email:"",initials:"رن",role:"رئيسة النطاق"}:{name:"عضوة الفريق",email:"",initials:"عف",role:"عضوة الفريق التنفيذي"};
  const [user,setUser]=useState(fallback);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<"notifications" | "profile" | null>(null);
  const [query, setQuery] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!popupRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setDrawer(false); setQuery(""); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  useEffect(()=>{apiRead("/auth/me").then(data=>{const account=(data as {user:{name:string;email:string;role:"head"|"member"}}).user;if(account.role!==role){window.location.replace(account.role==="head"?"/district":"/cluster/today");return}setUser({name:account.name,email:account.email,initials:account.name.split(/\s+/).map(part=>part[0]).join("").slice(0,2),role:account.role==="head"?"رئيسة النطاق":"عضوة الفريق التنفيذي"})}).catch(()=>{localStorage.removeItem("rasd:token");window.location.replace("/login")})},[role]);

  const notifications:string[]=[];

  const results = useMemo(() => {
    const normalized = query.trim();
    if (normalized.length < 2) return [];
    return searchItems.filter(item=>item.title.includes(normalized)||item.meta.includes(normalized)).slice(0,7);
  }, [query, searchItems]);

  const chooseResult = (target:string) => { onNavigate(target); setQuery(""); window.scrollTo({top:0,behavior:"smooth"}); };

  return <div className="rs-app">
    <header className="rs-header">
      <div className="header-brand">
        <button className="drawer-button" onClick={() => setDrawer(true)} aria-label="فتح القائمة"><Menu/></button>
        <span className="brand-tile">ر</span><strong>رَصد</strong><span className={`role-pill ${role}`}>{user.role}</span>
      </div>
      <div className="search-wrap">
        <label className="global-search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} aria-label="البحث العام" placeholder="ابحثي عن مدرسة، عضوة، أو مؤشر…"/></label>
        {query.trim().length >= 2 && <div className="search-results" role="listbox">{results.length ? results.map(item=><button key={item.id} onClick={()=>chooseResult(item.target)}><span><b>{item.title}</b><small>{item.meta}</small></span><span>فتح</span></button>) : <p>لا توجد نتائج مطابقة</p>}</div>}
      </div>
      <div className="header-actions" ref={popupRef}>
        {role === "member" && <Link className="field-link" href="/field" aria-label="عرض الجوال الميداني"><Smartphone/><span>عرض الجوال الميداني</span></Link>}
        <button className="square-button" aria-label="التنبيهات" aria-expanded={menu === "notifications"} onClick={() => setMenu(menu === "notifications" ? null : "notifications")}><Bell/>{notifications.length>0&&<i>{notifications.length}</i>}</button>
        <button className="profile-trigger" aria-expanded={menu === "profile"} onClick={() => setMenu(menu === "profile" ? null : "profile")}><span className={`avatar ${role}`}>{user.initials}</span><span><b>{user.name}</b><small>{user.role}</small></span><ChevronDown/></button>
        {menu === "notifications" && <div className="header-popup notifications" role="dialog" aria-label="التنبيهات"><div className="popup-title">التنبيهات <span>{notifications.length}</span></div>{notifications.length?notifications.map((item, index) => <div className="notification" key={item}><i className={index === 2 ? "info" : "attention"}/><span>{item}<small>اليوم</small></span></div>):<div className="notification"><span>لا توجد تنبيهات جديدة</span></div>}</div>}
        {menu === "profile" && <div className="header-popup profile-popup" role="dialog" aria-label="قائمة الحساب"><div><b>{user.name}</b><span dir="ltr">{user.email}</span></div><button>الملف الشخصي</button><button>الإعدادات والصلاحيات</button><button onClick={async()=>{try{await apiWrite("/auth/logout",{method:"POST",body:"{}"})}finally{localStorage.removeItem("rasd:token");sessionStorage.removeItem("rasd:role");window.location.replace("/login")}}}><LogOut/>تسجيل الخروج</button></div>}
      </div>
    </header>
    {drawer && <button className="drawer-scrim" aria-label="إغلاق القائمة" onClick={() => setDrawer(false)}/>} 
    <div className="rs-body">
      <aside className={`rs-sidebar ${drawer ? "open" : ""}`}>
        <button className="drawer-close" onClick={() => setDrawer(false)} aria-label="إغلاق القائمة"><X/></button>
        {role === "member" && <div className="completion-card"><div><span>اكتمال أقسام الملف</span><b>{toArabic(completion)}٪</b></div><Progress value={completion}/></div>}
        <nav className="side-nav" aria-label="التنقل الرئيسي">{nav.map(item => <button key={item.key} className={active === item.key ? "active" : ""} onClick={() => {onNavigate(item.key); setDrawer(false); window.scrollTo({top:0, behavior:"smooth"});}}><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}</button>)}</nav>
        {asideFooter}
      </aside>
      <main className="rs-main">{children}</main>
    </div>
  </div>;
}

export function PageTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function SectionTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="section-title"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</div>;
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warning" | "alert" | "ok" | "warn" | "bad" }) {
  const normalized = tone === "ok" ? "accent" : tone === "warn" ? "warning" : tone === "bad" ? "alert" : tone;
  return <span className={`status-pill ${normalized}`}>{children}</span>;
}

export function Progress({ value, tone }: { value: number; tone?: "accent" | "alert" }) {
  const safe = Math.min(100, Math.max(0, value || 0));
  const color = tone === "accent" ? "#009688" : tone === "alert" || safe < 75 ? "#dc2626" : "#009688";
  return <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safe)}><i style={{width:`${safe}%`, background:color}}/></div>;
}

function toArabic(value:number){return new Intl.NumberFormat("ar-SA").format(value)}
