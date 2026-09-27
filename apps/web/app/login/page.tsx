"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { enforceSessionOnly, rememberDevice, supabase, supabaseConfigured } from "../../lib/supabase";

type Me = { user: { role: "member" | "head" } };

export default function LoginPage(){
  const router=useRouter();const input=useRef<HTMLInputElement>(null);
  const [mode,setMode]=useState<"login"|"forgot">("login");const [error,setError]=useState("");const [notice,setNotice]=useState("");const [loading,setLoading]=useState(false);
  const openWorkspace=async()=>{const me=await api<Me>("/auth/me");router.replace(me.user.role==="head"?"/district":"/cluster/today")};
  useEffect(()=>{enforceSessionOnly().then(()=>supabase.auth.getSession()).then(({data})=>{if(data.session)openWorkspace().catch(()=>supabase.auth.signOut())})},[]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setLoading(true);setError("");setNotice("");const form=new FormData(event.currentTarget);const email=String(form.get("email")??"").trim().toLowerCase();
    try{
      if(mode==="forgot"){await api("/public/auth/forgot-password",{method:"POST",body:{email},auth:false});setNotice("إن كان البريد مسجلاً فستصلك رسالة لإعادة تعيين كلمة المرور خلال دقائق.");return}
      const {error:signInError}=await supabase.auth.signInWithPassword({email,password:String(form.get("password")??"")});
      if(signInError)throw new Error(signInError.message.includes("Invalid login")?"البريد أو كلمة المرور غير صحيحة":"تعذّر تسجيل الدخول — أعيدي المحاولة");
      rememberDevice(Boolean(form.get("remember")));
      await openWorkspace();
    }catch(reason){setError(errorText(reason));await supabase.auth.signOut().catch(()=>{});requestAnimationFrame(()=>input.current?.focus())}finally{setLoading(false)}
  };
  return <main className="login-page"><section className="login-form-panel"><div className="login-box"><div className="brand-lockup"><span>ر</span><div><b>رَصد</b><small>منصة متابعة الفريق التنفيذي</small></div></div><div className="login-title"><h1>{mode==="login"?"تسجيل الدخول":"استعادة كلمة المرور"}</h1><p>{mode==="login"?"استخدمي الحساب الذي أنشأتِه من رابط الدعوة. يتم توجيهك إلى مساحة العمل المرتبطة بدورك.":"أدخلي بريدك الوزاري وسنرسل لك رابطاً لتعيين كلمة مرور جديدة."}</p></div>{!supabaseConfigured&&<p className="login-error" role="alert">لم تُضبط مفاتيح Supabase في البيئة (NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).</p>}<form onSubmit={submit}><label><span>البريد الوزاري</span><input ref={input} name="email" type="email" dir="ltr" placeholder="name@moe.gov.sa" onChange={()=>setError("")} required/></label>{mode==="login"&&<><label><span>كلمة المرور</span><input name="password" type="password" minLength={8} required/></label><div className="login-options"><label><input name="remember" type="checkbox" defaultChecked/>تذكّرني على هذا الجهاز</label><button type="button" onClick={()=>{setMode("forgot");setError("")}}>نسيت كلمة المرور؟</button></div></>}<button className="primary-button login-submit" disabled={loading||!supabaseConfigured}>{loading?<><LoaderCircle className="spin"/>جاري المعالجة…</>:mode==="login"?"دخول":"إرسال رابط الاستعادة"}</button>{error&&<p className="login-error" role="alert">{error}</p>}{notice&&<p className="login-success" role="status">{notice}</p>}{mode==="forgot"&&<button type="button" className="text-button" onClick={()=>{setMode("login");setNotice("")}}>العودة لتسجيل الدخول</button>}</form><p className="legal">لا يمكن إنشاء حساب عضو مباشرة. يجب أن تصلك دعوة من رئيسة النطاق أولاً.</p></div></section><aside className="login-aside"><div><span className="login-eyebrow">إدارة التعليم · النطاق الإشرافي</span><h2>ملف واحد لكل عنقود، ولوحة واحدة تجمع النطاق كامل.</h2><div className="login-stats"><div><b>دعوة</b><span>برابط فريد وآمن</span></div><div><b>٦ مدارس</b><span>لكل عنقود</span></div><div><b>ملف</b><span>تملؤه العضوة بنفسها</span></div><div><b>يومي</b><span>تحديث يصل للإدارة مباشرة</span></div></div></div><blockquote>تبدأ دورة العمل بدعوة حقيقية، لا ببيانات افتراضية.</blockquote></aside></main>;
}
