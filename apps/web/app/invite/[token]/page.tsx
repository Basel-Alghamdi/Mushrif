"use client";

import { Check, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiRead, apiWrite } from "../../../lib/use-persistent-state";

type Invitation={name:string;email:string;clusterLabel:string;status:string;expiresAt:string};

export default function AcceptInvitationPage(){
  const {token}=useParams<{token:string}>();const router=useRouter();
  const [invitation,setInvitation]=useState<Invitation|null>(null);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{apiRead(`/public/invitations/${token}`).then(data=>setInvitation(data as Invitation)).catch(reason=>setError((reason as Error).message)).finally(()=>setLoading(false))},[token]);
  const accept=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const password=String(form.get("password")??"");const confirm=String(form.get("confirm")??"");if(password!==confirm){setError("كلمتا المرور غير متطابقتين");setSaving(false);return}try{const data=await apiWrite(`/public/invitations/${token}/accept`,{method:"POST",body:JSON.stringify({password,phone:String(form.get("phone")??"")})}) as {token:string};localStorage.setItem("rasd:token",data.token);sessionStorage.setItem("rasd:role","member");router.replace("/cluster/file")}catch(reason){setError((reason as Error).message)}finally{setSaving(false)}};
  if(loading)return <main className="invite-page"><div className="invite-card"><LoaderCircle className="spin"/><p>جاري التحقق من الدعوة…</p></div></main>;
  if(error&&!invitation)return <main className="invite-page"><div className="invite-card"><h1>تعذّر فتح الدعوة</h1><p className="login-error">{error}</p><a className="secondary-button" href="/login">العودة لتسجيل الدخول</a></div></main>;
  if(!invitation||invitation.status!=="pending")return <main className="invite-page"><div className="invite-card"><h1>الدعوة غير متاحة</h1><p>انتهت صلاحية هذه الدعوة أو سبق استخدامها.</p><a className="secondary-button" href="/login">تسجيل الدخول</a></div></main>;
  return <main className="invite-page"><section className="invite-card"><div className="brand-lockup"><span>ر</span><div><b>رَصد</b><small>الانضمام إلى الفريق التنفيذي</small></div></div><div><h1>مرحباً {invitation.name}</h1><p>دعتك رئيسة النطاق لإنشاء حسابك وتعبئة ملف {invitation.clusterLabel||"العنقود"}. البريد المرتبط بالدعوة:</p><b dir="ltr">{invitation.email}</b></div><form onSubmit={accept}><label><span>رقم الجوال</span><input name="phone" inputMode="tel" placeholder="05xxxxxxxx" required/></label><label><span>كلمة المرور الجديدة</span><input name="password" type="password" minLength={8} required/></label><label><span>تأكيد كلمة المرور</span><input name="confirm" type="password" minLength={8} required/></label><button className="primary-button" disabled={saving}>{saving?<><LoaderCircle className="spin"/>جاري إنشاء الحساب…</>:<><Check/>قبول الدعوة والدخول</>}</button>{error&&<p className="login-error" role="alert">{error}</p>}</form><small>باستمرارك، سيُربط ملفك برئيسة النطاق التي أرسلت الدعوة، وستظهر لها تحديثاتك بعد حفظها.</small></section></main>;
}
