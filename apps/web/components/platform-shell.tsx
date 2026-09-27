"use client";

import { Bell, ChevronDown, LogOut, Menu, Search, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ar } from "@rasd/i18n";
import { api, redirectIfSignedOut } from "../lib/api";
import { enforceSessionOnly, signOut } from "../lib/supabase";
import type { Notification } from "../lib/types";

export type NavItem = { key: string; label: string; badge?: string };

export function PlatformShell({ role, nav, active, onNavigate, children, asideFooter, completion, searchItems = [] }: {
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
  const [notifications,setNotifications]=useState<Notification[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!popupRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setDrawer(false); setQuery(""); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  useEffect(()=>{enforceSessionOnly().then(()=>api<{user:{name:string;email:string;role:"head"|"member"}}>("/auth/me")).then(({user:account})=>{if(account.role!==role){window.location.replace(account.role==="head"?"/district":"/cluster/today");return}setUser({name:account.name,email:account.email,initials:account.name.split(/\s+/).map(part=>part[0]).join("").slice(0,2),role:account.role==="head"?"رئيسة النطاق":"عضوة الفريق التنفيذي"})}).catch(error=>{if(!redirectIfSignedOut(error))window.location.replace("/login")})},[role]);

  const loadNotifications=useCallback(()=>{api<Notification[]>("/notifications").then(setNotifications).catch(()=>{})},[]);
  useEffect(()=>{loadNotifications();const timer=window.setInterval(loadNotifications,30000);return()=>window.clearInterval(timer)},[loadNotifications]);
  const unread=notifications.filter(item=>!item.readAt).length;
  const toggleNotifications=()=>{const opening=menu!=="notifications";setMenu(opening?"notifications":null);if(opening&&unread)api("/notifications/read",{method:"POST",body:{}}).then(loadNotifications).catch(()=>{})};

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
        <button className="square-button" aria-label="التنبيهات" aria-expanded={menu === "notifications"} onClick={toggleNotifications}><Bell/>{unread>0&&<i>{ar(unread)}</i>}</button>
        <button className="profile-trigger" aria-expanded={menu === "profile"} onClick={() => setMenu(menu === "profile" ? null : "profile")}><span className={`avatar ${role}`}>{user.initials}</span><span><b>{user.name}</b><small>{user.role}</small></span><ChevronDown/></button>
        {menu === "notifications" && <div className="header-popup notifications" role="dialog" aria-label="التنبيهات"><div className="popup-title">التنبيهات <span>{ar(notifications.length)}</span></div>{notifications.length?notifications.map(item => <div className="notification" key={item.id}><i className={item.level === "info" ? "info" : "attention"}/><span>{item.text}<small>{formatTime(item.createdAt)}</small></span></div>):<div className="notification"><span>لا توجد تنبيهات جديدة</span></div>}</div>}
        {menu === "profile" && <div className="header-popup profile-popup" role="dialog" aria-label="قائمة الحساب"><div><b>{user.name}</b><span dir="ltr">{user.email}</span></div><button onClick={signOut}><LogOut/>تسجيل الخروج</button></div>}
      </div>
    </header>
    {drawer && <button className="drawer-scrim" aria-label="إغلاق القائمة" onClick={() => setDrawer(false)}/>}
    <div className="rs-body">
      <aside className={`rs-sidebar ${drawer ? "open" : ""}`}>
        <button className="drawer-close" onClick={() => setDrawer(false)} aria-label="إغلاق القائمة"><X/></button>
        {role === "member" && completion !== undefined && <div className="completion-card"><div><span>اكتمال أقسام الملف</span><b>{ar(completion)}٪</b></div><Progress value={completion}/></div>}
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

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warning" | "alert" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function Progress({ value }: { value: number }) {
  const safe = Math.min(100, Math.max(0, value || 0));
  return <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safe)}><i style={{width:`${safe}%`, background:safe<75?"var(--danger)":"var(--primary)"}}/></div>;
}

export function formatTime(value:string|null|undefined){if(!value)return "—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Riyadh"}).format(date)}
