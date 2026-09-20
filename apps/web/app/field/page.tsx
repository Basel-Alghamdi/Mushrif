"use client";

import { ArrowRight, Camera, Check, ClipboardCheck, CloudUpload, Home, MapPin, RefreshCw, School, UserRound } from "lucide-react";
import { useState } from "react";

const initial = [
  { id: 1, name: "ابتدائية ابن خلدون", done: true },
  { id: 2, name: "متوسطة الأندلس", done: true },
  { id: 3, name: "ثانوية الفاروق", done: false },
  { id: 4, name: "ابتدائية الإمام الشافعي", done: false },
];

export default function FieldPage() {
  const [schools, setSchools] = useState(initial);
  const [sent, setSent] = useState(false);
  const toggle = (id: number) => setSchools((items) => items.map((item) => item.id === id ? {...item, done: !item.done} : item));
  return <main className="field-page">
    <header className="field-header"><div className="field-header-top"><a href="/cluster"><ArrowRight size={20}/></a><b>رَصد الميداني</b><span className="sync-badge"><RefreshCw size={12}/> متصل ومزامن</span></div><h1>صباح الخير، أحمد</h1><p>الأحد، ٨ ربيع الثاني ١٤٤٨ هـ · لديك زيارتان اليوم</p></header>
    <section className="field-content">
      <article className="task-card"><h2>تأكيد متابعة الغياب</h2><p>حدّث حالة المدارس لهذا اليوم. تحفظ التغييرات تلقائياً.</p><div className="absence-list">{schools.map((item) => <div className="absence-item" key={item.id}><span>{item.name}</span><button aria-label={`تحديث ${item.name}`} className={`toggle ${item.done ? "on" : ""}`} onClick={() => toggle(item.id)}/></div>)}</div></article>
      <article className="task-card"><h2>تقرير زيارة سريع</h2><p><MapPin size={12} style={{verticalAlign:"middle"}}/> اختر المدرسة وأضف ملخص الزيارة.</p><div className="field"><select aria-label="اختر المدرسة"><option>اختر المدرسة</option>{schools.map(s => <option key={s.id}>{s.name}</option>)}</select></div><div className="field"><textarea placeholder="اكتب أبرز الملاحظات والتوصيات..."/></div><label className="upload-zone"><Camera size={23}/>إرفاق صور أو ملفات الزيارة<input type="file" multiple hidden/></label><button className="primary-btn" style={{marginTop:12}} onClick={() => {setSent(true); setTimeout(() => setSent(false), 2200)}}>{sent ? <><Check size={17}/> تم حفظ التقرير</> : <><CloudUpload size={17}/> حفظ تقرير الزيارة</>}</button></article>
    </section>
    <nav className="mobile-nav" style={{display:"flex",maxWidth:520,margin:"auto"}}><a className="active" href="/field"><Home size={19}/>اليوم</a><a href="#"><School size={19}/>مدارسي</a><a href="#"><ClipboardCheck size={19}/>زياراتي</a><a href="#"><UserRound size={19}/>حسابي</a></nav>
  </main>;
}
