"use client";

import { ArrowLeft, Building2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Brand } from "../../components/brand";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    setTimeout(() => router.push(email.includes("head") ? "/district" : "/cluster"), 450);
  }
  return <main className="login-page">
    <section className="login-art">
      <div className="art-grid" />
      <div className="art-copy">
        <Brand />
        <h1>كل بيانات الإشراف.<br/>في مكان واحد.</h1>
        <p>منصة ذكية تساعد فرق الإشراف على متابعة المدارس، رصد المؤشرات، واتخاذ القرار بثقة.</p>
        <div className="quote">رؤية أوضح، متابعة أسرع، أثر أكبر</div>
      </div>
    </section>
    <section className="login-panel">
      <form className="login-box" onSubmit={submit}>
        <div className="eyebrow">تسجيل الدخول إلى المنصة</div>
        <h2>مرحباً بعودتك</h2>
        <p className="lede">أدخل بيانات حسابك للوصول إلى مساحة العمل.</p>
        <div className="field"><label htmlFor="email">البريد الإلكتروني</label><div className="input-wrap"><Mail size={18}/><input id="email" name="email" type="email" defaultValue="member@moe.gov.sa" required /></div></div>
        <div className="field"><label htmlFor="password">كلمة المرور</label><div className="input-wrap"><LockKeyhole size={18}/><input id="password" name="password" type="password" defaultValue="demo1234" required minLength={6}/></div></div>
        <div className="form-row"><label className="check"><input type="checkbox"/> تذكرني</label><a className="text-link" href="#">نسيت كلمة المرور؟</a></div>
        <button className="primary-btn" disabled={loading}>{loading ? "جارٍ الدخول..." : "تسجيل الدخول"}<ArrowLeft size={17}/></button>
        <div className="demo-label">دخول سريع للعرض التجريبي</div>
        <div className="demo-grid">
          <button type="button" className="demo-card" onClick={() => router.push("/cluster")}><span className="demo-icon"><UserRound size={18}/></span><span><b>عضو الإشراف</b><span>مساحة المجموعة</span></span></button>
          <button type="button" className="demo-card" onClick={() => router.push("/district")}><span className="demo-icon"><Building2 size={18}/></span><span><b>رئيس القسم</b><span>لوحة المنطقة</span></span></button>
        </div>
      </form>
    </section>
  </main>;
}
