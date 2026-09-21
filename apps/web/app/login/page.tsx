"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { accounts } from "../../lib/platform-data";

export default function LoginPage(){
  const router=useRouter();
  const input=useRef<HTMLInputElement>(null);
  const [error,setError]=useState(false);
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const email=String(new FormData(event.currentTarget).get("email")??"").trim().toLowerCase();if(email===accounts.member.email)return router.push("/cluster");if(email===accounts.head.email)return router.push("/district");setError(true);requestAnimationFrame(()=>input.current?.focus())};
  return <main className="login-page">
    <section className="login-form-panel"><div className="login-box"><div className="brand-lockup"><span>ر</span><div><b>رَصد</b><small>منصة متابعة الفريق التنفيذي</small></div></div><div className="login-title"><h1>تسجيل الدخول</h1><p>ادخلي ببريدك الوزاري — يتم توجيهك للوحة المناسبة لدورك تلقائياً.</p></div><form onSubmit={submit}><label><span>البريد الوزاري</span><input ref={input} name="email" type="email" dir="ltr" placeholder="name@moe.gov.sa" onChange={()=>setError(false)} required/></label><label><span>كلمة المرور</span><input name="password" type="password" minLength={6} required/></label><div className="login-options"><label><input type="checkbox"/>تذكّرني على هذا الجهاز</label><a href="#">نسيت كلمة المرور؟</a></div><button className="primary-button login-submit">دخول</button>{error&&<p className="login-error">تأكدي من البريد الوزاري — أو اختاري حساباً من القائمة أدناه.</p>}</form><div className="demo-accounts"><span>حسابات العرض التجريبي</span>{Object.entries(accounts).map(([key,account])=><button key={key} onClick={()=>router.push(key==="head"?"/district":"/cluster")}><i className={`avatar ${key}`}>{account.initials}</i><span><b>{account.name}</b><small>{account.role}</small></span><ChevronLeft/></button>)}</div><p className="legal">الدخول يعني موافقتك على سياسة استخدام بيانات المدارس والالتزام بسريتها.</p></div></section>
    <aside className="login-aside"><div><span className="login-eyebrow">إدارة التعليم · النطاق الإشرافي</span><h2>ملف واحد لكل عنقود، ولوحة واحدة تجمع النطاق كامل.</h2><div className="login-stats"><div><b>٢٥</b><span>عضوة فريق تنفيذي</span></div><div><b>١٥٠</b><span>مدرسة في النطاق</span></div><div><b>٧</b><span>أقسام في ملف العنقود</span></div><div><b>يومي</b><span>تحديث المؤشرات</span></div></div></div><blockquote>«صار عندي صورة كاملة عن كل عنقود بدون ما أجمع التقارير يدوياً.»<small>سارة القحطاني · رئيسة النطاق</small></blockquote></aside>
  </main>
}
