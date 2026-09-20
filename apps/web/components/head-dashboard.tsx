import { hijri } from "@rasd/i18n";
import { BellRing, Building2, CheckCircle2, CircleAlert, Download, FileUp, Sparkles, UsersRound } from "lucide-react";
import { members } from "../lib/demo-data";
import { AppShell } from "./app-shell";
import { StatCard } from "./stat-card";

export function HeadDashboard() {
  return <AppShell role="head"><main className="main">
    <div className="page-head"><div><h1>لوحة إدارة المنطقة</h1><p>صورة شاملة لأداء مجموعات الإشراف والمدارس.</p></div><div className="date-chip">{hijri()}</div></div>
    <section className="stats">
      <StatCard label="أعضاء الإشراف" value="٢٥" suffix="عضواً" trend="٢٣ محدثون اليوم" icon={UsersRound}/>
      <StatCard label="إجمالي المدارس" value="١٥٠" suffix="مدرسة" trend="ضمن ١٢ مجموعة" icon={Building2} tone="#5d708e"/>
      <StatCard label="الاكتمال العام" value="٨٨٪" trend="٦٪ عن الشهر الماضي" icon={CheckCircle2} tone="#397a68"/>
      <StatCard label="تحديثات متأخرة" value="٣" suffix="أعضاء" trend="تحتاج متابعة اليوم" icon={CircleAlert} tone="#ad584f"/>
    </section>
    <section className="dashboard-grid">
      <article className="card"><div className="card-head"><div><h2>أداء أعضاء الإشراف</h2><p>مرتب حسب اكتمال التحديثات اليومية</p></div><button className="ghost-btn">كل الأعضاء</button></div><div className="school-list">
        {members.map((member) => <div className="school-row" key={member.name}><div className="school-name"><div className="avatar">{member.name[0]}</div><div><b>{member.name}</b><small>{member.schools} مدارس · {member.visits} زيارة</small></div></div><div><div className="bar-wrap"><div className="bar" style={{width:`${member.completion}%`}}/></div></div><b>{member.completion}٪</b><span className={`pill ${member.completion < 70 ? "bad" : member.completion < 90 ? "warn" : ""}`}>{member.status}</span></div>)}
      </div></article>
      <aside><article className="card ai-card"><div className="ai-title"><span className="ai-badge"><Sparkles size={18}/></span><span>موجز المنطقة الذكي</span></div><p>مؤشرات اليوم مستخرجة من آخر تحديثات أعضاء الإشراف.</p><div className="insight"><i/><span>٢٢ عضواً أكملوا تحديث الغياب قبل الموعد.</span></div><div className="insight"><i/><span>تحسن مؤشر الانضباط في ٤ مجموعات هذا الشهر.</span></div><div className="insight"><i/><span>٣ أعضاء يحتاجون تذكيراً بإغلاق تحديث اليوم.</span></div><button className="ai-action">اطلب تحليلاً تفصيلياً</button></article>
        <article className="card quick-card"><h3>إجراءات الإدارة</h3><div className="quick-list"><button className="quick-action"><BellRing size={17}/>إرسال تذكير للأعضاء</button><button className="quick-action"><FileUp size={17}/>استيراد مؤشرات إكسل</button><button className="quick-action"><Download size={17}/>تصدير التقرير الموحد</button></div></article>
      </aside>
    </section>
  </main></AppShell>;
}
