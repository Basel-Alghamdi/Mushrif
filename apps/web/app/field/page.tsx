"use client";

import { Check, UploadCloud, WifiOff } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ar, hijri } from "@rasd/i18n";
import { VISIT_TYPES } from "@rasd/schemas";
import { api, ApiError, errorText, redirectIfSignedOut } from "../../lib/api";
import { enqueueMutation, listMutations, replayMutations } from "../../lib/offline-queue";
import { enforceSessionOnly } from "../../lib/supabase";
import type { Workspace } from "../../lib/types";

type Outcome = "sent" | "queued" | "rejected";
const CACHE = "rasd:field-workspace";

export default function FieldPage(){
  const [ws,setWs]=useState<Workspace|null>(null);const [online,setOnline]=useState(true);const [queueCount,setQueueCount]=useState(0);
  const [status,setStatus]=useState<{tone:"ok"|"error";text:string}|null>(null);const [errors,setErrors]=useState<Record<string,string>>({});
  const flash=(tone:"ok"|"error",text:string)=>{setStatus({tone,text});window.setTimeout(()=>setStatus(null),4000)};
  const refreshQueue=useCallback(async()=>setQueueCount((await listMutations()).length),[]);
  // The last loaded file is cached so the page still opens with no signal inside a school.
  const load=useCallback(async()=>{
    try{const fresh=await api<Workspace>("/member/workspace",{source:"mobile"});setWs(fresh);try{localStorage.setItem(CACHE,JSON.stringify(fresh))}catch{/* storage full or blocked */}}
    catch(error){if(!redirectIfSignedOut(error))setWs(current=>{if(!current)flash("error",errorText(error));return current})}
  },[]);

  useEffect(()=>{
    try{const cached=localStorage.getItem(CACHE);if(cached)setWs(JSON.parse(cached) as Workspace)}catch{/* ignore unreadable cache */}
    const sync=async()=>{
      setOnline(navigator.onLine);await refreshQueue();
      if(navigator.onLine){try{const dropped=await replayMutations();if(dropped)flash("error",`رُفض ${ar(dropped)} من التغييرات المحفوظة لعدم صحتها`);await refreshQueue()}catch{setOnline(false);return}}
      await load();
    };
    enforceSessionOnly().then(sync);const retry=window.setInterval(()=>{if(navigator.onLine)sync()},30000);
    window.addEventListener("online",sync);window.addEventListener("offline",sync);window.addEventListener("rasd:queue",refreshQueue);
    return()=>{window.clearInterval(retry);window.removeEventListener("online",sync);window.removeEventListener("offline",sync);window.removeEventListener("rasd:queue",refreshQueue)};
  },[load,refreshQueue]);

  // Offline or server unreachable → queue for replay; a validation error is shown instead of queued.
  const sendOrQueue=async(path:string,method:"POST"|"PUT",body:Record<string,unknown>):Promise<Outcome>=>{
    if(!navigator.onLine){await enqueueMutation({path,method,body});await refreshQueue();return "queued"}
    try{await api(path,{method,body,source:"mobile"});return "sent"}
    catch(error){
      if(redirectIfSignedOut(error))return "rejected";
      if(error instanceof ApiError&&error.status>=400&&error.status<500){if(error.fields)setErrors(error.fields);flash("error",error.message);return "rejected"}
      setOnline(false);await enqueueMutation({path,method,body});await refreshQueue();return "queued";
    }
  };

  const toggle=async(id:string,done:boolean)=>{
    if(!ws)return;const set=(value:boolean)=>setWs(current=>current&&{...current,schools:current.schools.map(school=>school.id===id?{...school,absenceToday:value}:school)});
    set(done);const outcome=await sendOrQueue(`/schools/${id}/absence`,"PUT",{date:ws.cluster.today,done});if(outcome==="rejected")set(!done);
  };
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setErrors({});const formElement=event.currentTarget;const form=new FormData(formElement);const schoolId=String(form.get("schoolId")??"");
    const body={id:crypto.randomUUID(),schoolId,type:String(form.get("type")??""),text:String(form.get("text")??"").trim(),beneficiaries:Number(form.get("beneficiaries")||0),sessions:Number(form.get("sessions")||0),blockers:String(form.get("blockers")??"")};
    if(body.text.length<10){setErrors({text:"أضيفي وصفاً لا يقل عن ١٠ أحرف"});return}
    const outcome=await sendOrQueue("/visits","POST",body);
    if(outcome==="rejected")return;
    setWs(current=>current&&{...current,schools:current.schools.map(school=>school.id===schoolId?{...school,visitCount:school.visitCount+1}:school)});
    formElement.reset();flash("ok",outcome==="sent"?"رُفع التقرير":"حُفظ التقرير وسيُرسل عند عودة الاتصال");
  };

  if(!ws)return <main className="field-page"><div className="workspace-loading">{status?.text??"جاري تحميل مهامك…"}</div></main>;
  const schools=ws.schools;const done=schools.filter(school=>school.absenceToday).length;const initials=ws.cluster.memberName.split(/\s+/).map(part=>part[0]).join("").slice(0,2);
  return <main className="field-page">
    <header className="field-top"><div><span>{ws.cluster.label||"ملف العنقود"} · {hijri()}</span><h1>مهام اليوم</h1></div><Link href="/cluster/today" className="avatar member" aria-label="العودة إلى ملف العنقود">{initials}</Link></header>
    {(!online||queueCount>0)&&<div className="offline-banner" role="status"><WifiOff/><span>{online?`جاري إرسال ${ar(queueCount)} تغييرات محفوظة`:`في انتظار الاتصال — ${ar(queueCount)} تغييرات`}<small>ستُرسل تلقائياً عند عودة الاتصال.</small></span></div>}
    <div className="field-content">
      {status&&<p className={status.tone==="ok"?"login-success":"login-error"} role="status">{status.text}</p>}
      <section className="card"><div className="card-title-row"><div><h2>تثبيت الغياب</h2><p>{ar(done)} من {ar(schools.length)} مثبتة</p></div></div>
        {schools.length?<div className="mobile-absence">{schools.map(school=><div key={school.id}><span>{school.name}</span><button className={school.absenceToday?"on":""} aria-pressed={school.absenceToday} onClick={()=>toggle(school.id,!school.absenceToday)}>{school.absenceToday?"تم":"لم يتم"}</button></div>)}</div>
        :<div className="empty-state"><b>أضيفي مدارس العنقود من ملفك أولاً</b><Link className="secondary-button" href="/cluster/file">فتح ملف العنقود</Link></div>}
      </section>
      <form className="card quick-visit" onSubmit={submit}>
        <div><h2>تقرير زيارة سريع</h2><p>يُحفظ التقرير حتى بدون اتصال ويُرسل تلقائياً.</p></div>
        <label><span>المدرسة</span><select name="schoolId" required defaultValue=""><option value="" disabled>اختاري المدرسة</option>{schools.map(school=><option value={school.id} key={school.id}>{school.name}</option>)}</select>{errors.schoolId&&<small className="field-error">{errors.schoolId}</small>}</label>
        <div className="activity-chips">{VISIT_TYPES.map((type,index)=><label key={type}><input type="radio" name="type" value={type} defaultChecked={index===0}/><span>{type}</span></label>)}</div>
        <label><span>وصف الزيارة</span><textarea name="text" required minLength={10} placeholder="وصف مختصر للزيارة وأبرز الملاحظات…"/>{errors.text&&<small className="field-error">{errors.text}</small>}</label>
        <div className="field-numbers"><label><span>عدد المستفيدات</span><input name="beneficiaries" type="number" min="0" inputMode="numeric" defaultValue="0"/></label><label><span>عدد الجلسات</span><input name="sessions" type="number" min="0" inputMode="numeric" defaultValue="1"/></label></div>
        <label><span>المعوقات أو الاحتياج</span><textarea name="blockers" placeholder="اختياري"/></label>
        <div className="field-alert"><span>المرفقات والملاحظات الصوتية</span><p>إرفاق الصور والملفات والتسجيلات يُفعّل مع خدمة التخزين قريباً.</p></div>
        <button className="primary-button login-submit" disabled={!schools.length}>{status?.tone==="ok"?<><Check/>{status.text}</>:<><UploadCloud/>رفع التقرير</>}</button>
      </form>
    </div>
  </main>;
}
