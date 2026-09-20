"use client";

import { Bell, Bot, Building2, ChartNoAxesCombined, ClipboardCheck, FileChartColumn, Gauge, LogOut, Menu, Search, Settings, Sparkles, UserRound, UsersRound } from "lucide-react";
import { ReactNode } from "react";
import { Brand } from "./brand";

const memberNav = [
  ["لوحة المتابعة", Gauge], ["بيانات المجموعة", UsersRound], ["المدارس", Building2], ["الزيارات الميدانية", ClipboardCheck], ["المؤشرات والتقارير", FileChartColumn], ["المساعد الذكي", Bot],
] as const;
const headNav = [
  ["نظرة عامة", Gauge], ["أعضاء الإشراف", UsersRound], ["المدارس", Building2], ["مؤشرات الأداء", ChartNoAxesCombined], ["التقارير", FileChartColumn], ["المساعد الذكي", Sparkles],
] as const;

export function AppShell({ role, children }: { role: "member" | "head"; children: ReactNode }) {
  const nav = role === "head" ? headNav : memberNav;
  const person = role === "head" ? "د. فهد السبيعي" : "أحمد العتيبي";
  const title = role === "head" ? "رئيس قسم الإشراف" : "عضو إشراف تربوي";
  return <div className="app-frame">
    <aside className="sidebar"><Brand/><div className="nav-caption">مساحة العمل</div>
      <nav>{nav.map(([label, Icon], index) => <a className={`nav-link ${index === 0 ? "active" : ""}`} href="#" key={label}><Icon size={18}/>{label}</a>)}</nav>
      <div className="nav-caption">النظام</div><a className="nav-link" href="#"><Settings size={18}/>الإعدادات</a>
      <div className="sidebar-foot"><div className="mini-user"><div className="avatar">{person[0]}</div><div><b>{person}</b><span>{title}</span></div><LogOut size={16} style={{marginInlineStart:"auto",opacity:.5}}/></div></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div className="crumb">الرئيسية&nbsp; / &nbsp;<strong>{role === "head" ? "لوحة المنطقة" : "مجموعة الإشراف"}</strong></div><div className="top-actions"><button className="icon-btn" aria-label="بحث"><Search size={18}/></button><button className="icon-btn" aria-label="الإشعارات"><Bell size={18}/><span className="dot"/></button><button className="icon-btn" aria-label="القائمة"><Menu size={18}/></button></div></header>
      {children}
    </section>
    <nav className="mobile-nav"><a className="active" href="#"><Gauge size={19}/>الرئيسية</a><a href="#"><Building2 size={19}/>المدارس</a><a href="/field"><ClipboardCheck size={19}/>الميدان</a><a href="#"><FileChartColumn size={19}/>التقارير</a><a href="#"><UserRound size={19}/>حسابي</a></nav>
  </div>;
}
