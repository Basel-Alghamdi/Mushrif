import { hijri } from "@rasd/i18n";
import { Building2, CalendarCheck, ClipboardCheck, FileUp, MessageSquareText, School, Sparkles, UsersRound } from "lucide-react";
import { schools } from "../lib/demo-data";
import { AppShell } from "./app-shell";
import { StatCard } from "./stat-card";

export function MemberDashboard() {
  return <AppShell role="member"><main className="main">
    <div className="page-head"><div><h1>صباح الخير، أحمد</h1><p>إليك ملخص أداء مدارس مجموعتك لهذا اليوم.</p></div><div className="date-chip">{hijri()}</div></div>
    <section className="stats">
      <StatCard label="مدارس المجموعة" value="٦" suffix="مدارس" trend="جميعها نشطة" icon={School}/>
      <StatCard label="نسبة اكتمال البيانات" value="٨٦٪" trend="٤٪ عن الأسبوع الماضي" icon={CalendarCheck} tone="#397a68"/>
      <StatCard label="الزيارات هذا الشهر" value="١٨" suffix="زيارة" trend="٣ زيارات هذا الأسبوع" icon={ClipboardCheck} tone="#b38742"/>
      <StatCard label="الطلاب المستفيدون" value="٢,٤٨٦" trend="بيانات محدثة اليوم" icon={UsersRound} tone="#5d708e"/>
    </section>
    <section className="dashboard-grid">
      <article className="card"><div className="card-head"><div><h2>متابعة اكتمال بيانات المدارس</h2><p>آخر تحديث اليوم، ١٠:٣٠ ص</p></div><button className="ghost-btn">عرض الكل</button></div><div className="school-list">
        {schools.map((school) => <div className="school-row" key={school.name}><div className="school-name"><div className="school-logo">{school.name.at(0)}</div><div><b>{school.name}</b><small>الرقم الوزاري: {school.code}</small></div></div><div><div className="bar-wrap"><div className="bar" style={{width:`${school.progress}%`}}/></div></div><b>{school.progress}٪</b><span className={`pill ${school.tone === "warn" ? "warn" : school.tone === "bad" ? "bad" : ""}`}>{school.status}</span></div>)}
      </div></article>
      <aside><article className="card ai-card"><div className="ai-title"><span className="ai-badge"><Sparkles size={18}/></span><span>ملخص الذكاء الاصطناعي</span></div><p>تحليل سريع لأبرز ما يحتاج انتباهك اليوم بناءً على بيانات المجموعة.</p><div className="insight"><i/><span>ارتفع اكتمال البيانات بنسبة ٤٪ مقارنة بالأسبوع الماضي.</span></div><div className="insight"><i/><span>مدرسة الإمام الشافعي تحتاج تحديث بيانات الحضور.</span></div><div className="insight"><i/><span>لديك زيارتان مخططتان خلال الأيام الثلاثة القادمة.</span></div><button className="ai-action">تحدث مع مساعد رَصد</button></article>
        <article className="card quick-card"><h3>إجراءات سريعة</h3><div className="quick-list"><button className="quick-action"><FileUp size={17}/>رفع تقرير زيارة</button><button className="quick-action"><Building2 size={17}/>تحديث بيانات مدرسة</button><button className="quick-action"><MessageSquareText size={17}/>إضافة ملاحظة</button></div></article>
      </aside>
    </section>
  </main></AppShell>;
}
