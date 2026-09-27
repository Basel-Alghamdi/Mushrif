"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { apiRead, apiWrite } from "../../lib/use-persistent-state";

type LoginResult={token:string;user:{role:"member"|"head"}};

export default function LoginPage(){
  const router=useRouter();const input=useRef<HTMLInputElement>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  const openRole=(role:"member"|"head")=>{sessionStorage.setItem("rasd:role",role);router.replace(role==="head"?"/district":"/cluster/today")};
  useEffect(()=>{if(!localStorage.getItem("rasd:token"))return;apiRead("/auth/me").then(data=>openRole((data as {user:{role:"member"|"head"}}).user.role)).catch(()=>localStorage.removeItem("rasd:token"))},[]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setLoading(true);setError("");const form=new FormData(event.currentTarget);try{const data=await apiWrite("/auth/login",{method:"POST",body:JSON.stringify({email:String(form.get("email")??"").trim().toLowerCase(),password:String(form.get("password")??""),remember:Boolean(form.get("remember"))})}) as LoginResult;localStorage.setItem("rasd:token",data.token);openRole(data.user.role)}catch(reason){setError((reason as Error).message);requestAnimationFrame(()=>input.current?.focus())}finally{setLoading(false)}};
  return <main className="login-page"><section className="login-form-panel"><div className="login-box"><div className="brand-lockup"><span>ر</span><div><b>رَصد</b><small>منصة متابعة الفريق التنفيذي</small></div></div><div className="login-title"><h1>تسجيل الدخول</h1><p>استخدمي الحساب الذي أنشأتِه من رابط الدعوة. يتم توجيهك إلى مساحة العمل المرتبطة بدورك.</p></div><form onSubmit={submit}><label><span>البريد الوزاري</span><input ref={input} name="email" type="email" dir="ltr" placeholder="name@moe.gov.sa" onChange={()=>setError("")} required/></label><label><span>كلمة المرور</span><input name="password" type="password" minLength={8} required/></label><div className="login-options"><label><input name="remember" type="checkbox"/>تذكّرني على هذا الجهاز</label></div><button className="primary-button login-submit" disabled={loading}>{loading?<><LoaderCircle className="spin"/>جاري الدخول…</>:"دخول"}</button>{error&&<p className="login-error" role="alert">{error}</p>}</form><p className="legal">لا يمكن إنشاء حساب عضو مباشرة. يجب أن تصلك دعوة من رئيسة النطاق أولاً.</p></div></section><aside className="login-aside"><div><span className="login-eyebrow">إدارة التعليم · النطاق الإشرافي</span><h2>كل عضوة تدخل من دعوتها، وتحدّث ملفها، وتصل بياناتها مباشرة إلى رئيسة النطاق.</h2><div className="login-stats"><div><b>دعوة</b><span>برابط فريد وآمن</span></div><div><b>حساب</b><span>مرتبط برئيسة النطاق</span></div><div><b>ملف</b><span>تملؤه العضوة بنفسها</span></div><div><b>تحديث</b><span>يظهر للإدارة مباشرة</span></div></div></div><blockquote>تبدأ دورة العمل بدعوة حقيقية، لا ببيانات افتراضية.</blockquote></aside></main>;
}
