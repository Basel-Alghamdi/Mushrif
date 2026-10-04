"use client";

import { Check, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

// Reached from the reset email: either ?token_hash=…&type=recovery (our Resend email) or a #access_token fragment
// (Supabase's built-in mailer, picked up automatically by supabase-js).
export default function ResetPasswordPage(){
  const [state,setState]=useState<"checking"|"ready"|"invalid"|"done">("checking");const [error,setError]=useState("");const [saving,setSaving]=useState(false);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);const tokenHash=params.get("token_hash");
    const verify=tokenHash?supabase.auth.verifyOtp({token_hash:tokenHash,type:"recovery"}).then(({error:verifyError})=>!verifyError):supabase.auth.getSession().then(({data})=>Boolean(data.session));
    verify.then(valid=>setState(valid?"ready":"invalid")).catch(()=>setState("invalid"));
  },[]);
  const save=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError("");const form=new FormData(event.currentTarget);const password=String(form.get("password")??"");
    if(password!==String(form.get("confirm")??"")){setError("كلمتا المرور غير متطابقتين");return}
    setSaving(true);const {error:updateError}=await supabase.auth.updateUser({password});setSaving(false);
    if(updateError){setError(updateError.message.includes("different")?"اختاري كلمة مرور مختلفة عن السابقة":"تعذّر تحديث كلمة المرور — أعيدي المحاولة");return}
    await supabase.auth.signOut();setState("done");
  };
  return <main className="invite-page"><section className="invite-card"><div className="brand-lockup"><span>ر</span><div><b>رَصد</b><small>تعيين كلمة مرور جديدة</small></div></div>
    {state==="checking"&&<p><LoaderCircle className="spin"/> جاري التحقق من الرابط…</p>}
    {state==="invalid"&&<><h1>الرابط غير صالح</h1><p>انتهت صلاحية رابط الاستعادة أو سبق استخدامه. اطلبي رابطاً جديداً من صفحة الدخول.</p><a className="secondary-button" href="/login">صفحة الدخول</a></>}
    {state==="done"&&<><h1>تم تحديث كلمة المرور</h1><p>يمكنك الآن الدخول بكلمة المرور الجديدة.</p><a className="primary-button" href="/login">تسجيل الدخول</a></>}
    {state==="ready"&&<form onSubmit={save}><label><span>كلمة المرور الجديدة</span><input name="password" type="password" minLength={8} required/></label><label><span>تأكيد كلمة المرور</span><input name="confirm" type="password" minLength={8} required/></label><button className="primary-button" disabled={saving}>{saving?<><LoaderCircle className="spin"/>جاري الحفظ…</>:<><Check/>حفظ كلمة المرور</>}</button>{error&&<p className="login-error" role="alert">{error}</p>}</form>}
  </section></main>;
}
