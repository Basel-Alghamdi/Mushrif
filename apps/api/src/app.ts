import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  Account, acceptInvitation, accountForToken, createInvitation, createSession, createVisit, findAccountByEmail,
  getInvitationById, getWorkspace, invitationForToken, passwordMatches, refreshInvitation,
  revokeInvitation, revokeSession, saveWorkspace, submitWorkspace, teamForHead, updateInvitationDelivery, visitsForUser,
} from "./persistence.js";

type Audit = { id:string; actorId:string; action:string; entity:string; entityId:string; before:unknown; after:unknown; at:string };

const audit:Audit[]=[];
const reminders:{id:string;memberIds:string[];body:string;sentAt:string}[]=[];
const records=new Map<string,Record<string,unknown>[]>();
const bucket=(name:string)=>{if(!records.has(name))records.set(name,[]);return records.get(name)!};

const ok=(data:unknown,meta?:unknown)=>({data,...(meta?{meta}: {})});
const fail=(code:string,message:string,fields?:Record<string,string>)=>({error:{code,message,...(fields?{fields}: {})}});
const log=(action:string,entity:string,entityId:string,before:unknown,after:unknown)=>audit.unshift({id:crypto.randomUUID(),actorId:"authenticated-user",action,entity,entityId,before,after,at:new Date().toISOString()});

type AppEnv={Variables:{authUser:Account;authToken:string}};
export const app=new Hono<AppEnv>();
app.use("*",cors({origin:(origin)=>origin||"http://localhost:3000",allowHeaders:["Content-Type","Authorization"],allowMethods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"]}));
app.get("/health",c=>c.json({status:"ok",service:"rasd-api",version:"v1"}));

const publicApiPaths=new Set(["/api/v1/auth/login","/api/v1/auth/forgot-password"]);
app.use("/api/v1/*",async(c,next)=>{
  if(c.req.method==="OPTIONS"||publicApiPaths.has(c.req.path)||c.req.path.startsWith("/api/v1/public/invitations/"))return next();
  const header=c.req.header("authorization")??"";
  const token=header.startsWith("Bearer ")?header.slice(7):"";
  const user=token?accountForToken(token):null;
  if(!user)return c.json(fail("UNAUTHENTICATED","انتهت الجلسة أو لم يتم تسجيل الدخول"),401);
  c.set("authUser",user);c.set("authToken",token);return next();
});

const publicUser=(user:Account)=>({id:user.id,name:user.name,email:user.email,phone:user.phone,role:user.role,clusterLabel:user.clusterLabel});
const invitationUrl=(token:string)=>`${process.env.APP_URL??"http://localhost:3000"}/invite/${token}`;
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));
async function deliverInvitation(email:string,name:string,link:string){
  const key=process.env.RESEND_API_KEY;const from=process.env.RESEND_FROM;
  if(!key||!from)return "link_ready" as const;
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({from,to:[email],subject:"دعوة للانضمام إلى منصة رَصد",html:`<div dir="rtl" style="font-family:Arial,sans-serif"><h2>مرحباً ${escapeHtml(name)}</h2><p>دعتك رئيسة النطاق للانضمام إلى منصة رَصد وتعبئة ملف عنقودك.</p><p><a href="${escapeHtml(link)}">قبول الدعوة وإنشاء الحساب</a></p><p>تنتهي صلاحية الرابط خلال ٧ أيام.</p></div>`})});
  if(!response.ok)throw new Error(`EMAIL_${response.status}`);return "sent" as const;
}

app.post("/api/v1/auth/login",async c=>{
  const body=await c.req.json<{email?:string;password?:string;remember?:boolean}>();const email=body.email?.trim().toLowerCase()??"";
  const found=findAccountByEmail(email);if(!found||!body.password||!passwordMatches(body.password,found.passwordHash))return c.json(fail("INVALID_CREDENTIALS","البريد أو كلمة المرور غير صحيحة"),401);
  const session=createSession(found.account.id,Boolean(body.remember));return c.json(ok({...session,user:publicUser(found.account)}));
});
app.get("/api/v1/auth/me",c=>c.json(ok({user:publicUser(c.get("authUser"))})));
app.post("/api/v1/auth/logout",c=>{revokeSession(c.get("authToken"));return c.json(ok({loggedOut:true}))});

app.get("/api/v1/public/invitations/:token",c=>{
  const invitation=invitationForToken(c.req.param("token"));if(!invitation)return c.json(fail("NOT_FOUND","رابط الدعوة غير صحيح"),404);
  return c.json(ok({name:invitation.name,email:invitation.email,clusterLabel:invitation.clusterLabel,status:invitation.status,expiresAt:invitation.expiresAt}));
});
app.post("/api/v1/public/invitations/:token/accept",async c=>{
  const body=await c.req.json<{password?:string;phone?:string}>();if(!body.password||body.password.length<8)return c.json(fail("VALIDATION_ERROR","كلمة المرور يجب ألا تقل عن ٨ أحرف"),422);
  try{const user=acceptInvitation(c.req.param("token"),{password:body.password,phone:body.phone});const session=createSession(user.id,true);return c.json(ok({...session,user:publicUser(user)}),201)}
  catch(error){if((error as Error).message==="INVITATION_INVALID")return c.json(fail("INVITATION_INVALID","الدعوة منتهية أو سبق استخدامها"),410);throw error}
});

app.get("/api/v1/district/team",c=>{const user=c.get("authUser");if(user.role!=="head")return c.json(fail("FORBIDDEN","هذه الصفحة لرئيسة النطاق"),403);return c.json(ok(teamForHead(user.id)))});
app.post("/api/v1/district/invitations",async c=>{
  const user=c.get("authUser");if(user.role!=="head")return c.json(fail("FORBIDDEN","لا تملكين صلاحية إرسال الدعوات"),403);
  const body=await c.req.json<{name?:string;email?:string;clusterLabel?:string}>();const fields:Record<string,string>={};
  if(!body.name?.trim())fields.name="اسم العضوة مطلوب";if(!body.email?.trim().toLowerCase().endsWith("@moe.gov.sa"))fields.email="استخدمي البريد الوزاري المنتهي بـ moe.gov.sa";
  if(Object.keys(fields).length)return c.json(fail("VALIDATION_ERROR","أكملي بيانات الدعوة",fields),422);
  try{const created=createInvitation(user.id,{name:body.name!,email:body.email!,clusterLabel:body.clusterLabel});const link=invitationUrl(created.token);let deliveryStatus:"sent"|"link_ready"|"failed"="link_ready";
    try{deliveryStatus=await deliverInvitation(created.invitation.email,created.invitation.name,link)}catch{deliveryStatus="failed"}updateInvitationDelivery(created.invitation.id,deliveryStatus);
    return c.json(ok({invitation:getInvitationById(created.invitation.id),inviteUrl:link}),201)}
  catch(error){const code=(error as Error).message;if(code==="ACCOUNT_EXISTS")return c.json(fail(code,"يوجد حساب بهذا البريد بالفعل"),409);if(code==="INVITATION_EXISTS")return c.json(fail(code,"هناك دعوة معلقة لهذا البريد"),409);throw error}
});
app.post("/api/v1/district/invitations/:id/resend",async c=>{
  const user=c.get("authUser");if(user.role!=="head")return c.json(fail("FORBIDDEN","غير مصرح"),403);const refreshed=refreshInvitation(c.req.param("id"),user.id);if(!refreshed)return c.json(fail("NOT_FOUND","الدعوة غير موجودة"),404);
  const link=invitationUrl(refreshed.token);let deliveryStatus:"sent"|"link_ready"|"failed"="link_ready";try{deliveryStatus=await deliverInvitation(refreshed.invitation.email,refreshed.invitation.name,link)}catch{deliveryStatus="failed"}updateInvitationDelivery(refreshed.invitation.id,deliveryStatus);
  return c.json(ok({invitation:getInvitationById(refreshed.invitation.id),inviteUrl:link}));
});
app.delete("/api/v1/district/invitations/:id",c=>{const user=c.get("authUser");if(user.role!=="head")return c.json(fail("FORBIDDEN","غير مصرح"),403);return revokeInvitation(c.req.param("id"),user.id)?c.json(ok({revoked:true})):c.json(fail("NOT_FOUND","الدعوة غير موجودة"),404)});

app.get("/api/v1/member/workspace",c=>{const user=c.get("authUser");if(user.role!=="member")return c.json(fail("FORBIDDEN","هذه الصفحة لعضوة الفريق"),403);return c.json(ok(getWorkspace(user.id)))});
app.put("/api/v1/member/workspace",async c=>{const user=c.get("authUser");if(user.role!=="member")return c.json(fail("FORBIDDEN","غير مصرح"),403);const body=await c.req.json();return c.json(ok(saveWorkspace(user.id,body)))});
app.post("/api/v1/cluster/me/submit",c=>{const user=c.get("authUser");if(user.role!=="member")return c.json(fail("FORBIDDEN","غير مصرح"),403);return c.json(ok(submitWorkspace(user.id)),201)});

app.post("/api/v1/auth/forgot-password",c=>c.json(fail("NOT_IMPLEMENTED","استعادة كلمة المرور غير مفعّلة بعد؛ تواصلي مع مسؤولة النظام"),501));

app.get("/api/v1/cluster/me",c=>{const user=c.get("authUser");const workspace=getWorkspace(user.id);return c.json(ok({id:user.id,label:user.clusterLabel,schoolCount:workspace.schools.length,submittedAt:workspace.submittedAt,updatedAt:workspace.updatedAt}))});
app.get("/api/v1/cluster/me/schools",c=>c.json(ok(getWorkspace(c.get("authUser").id).schools)));
app.post("/api/v1/cluster/me/schools",async c=>{const body=await c.req.json<Record<string,unknown>>();if(!String(body.name??"").trim())return c.json(fail("VALIDATION_ERROR","اسم المدرسة مطلوب",{name:"اسم المدرسة مطلوب"}),422);const user=c.get("authUser");const workspace=getWorkspace(user.id);const item={id:body.id??crypto.randomUUID(),...body};saveWorkspace(user.id,{schools:[...workspace.schools,item]});log("create","school",String(item.id),null,item);return c.json(ok(item),201)});
app.patch("/api/v1/cluster/me/schools/:id",async c=>{const body=await c.req.json<Record<string,unknown>>();const user=c.get("authUser");const workspace=getWorkspace(user.id);let found=false;const schools=workspace.schools.map(school=>{if(String(school.id)!==c.req.param("id"))return school;found=true;return{...school,...body}});if(!found)return c.json(fail("NOT_FOUND","المدرسة غير موجودة"),404);saveWorkspace(user.id,{schools});log("update","school",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
app.delete("/api/v1/cluster/me/schools/:id",c=>{const user=c.get("authUser");const workspace=getWorkspace(user.id);const schools=workspace.schools.filter(school=>String(school.id)!==c.req.param("id"));if(schools.length===workspace.schools.length)return c.json(fail("NOT_FOUND","المدرسة غير موجودة"),404);saveWorkspace(user.id,{schools});log("delete","school",c.req.param("id"),null,null);return c.json(ok({deleted:true}))});

app.get("/api/v1/cluster/me/profile-fields",c=>c.json(ok(getWorkspace(c.get("authUser").id).profile)));
app.post("/api/v1/cluster/me/profile-fields",async c=>{const body=await c.req.json<{id?:string;label?:string;value?:string}>();if(!body.label?.trim())return c.json(fail("VALIDATION_ERROR","اسم الحقل مطلوب",{label:"اسم الحقل مطلوب"}),422);const user=c.get("authUser");const workspace=getWorkspace(user.id);const item={id:body.id??crypto.randomUUID(),label:body.label,value:body.value??""};saveWorkspace(user.id,{profile:[...workspace.profile,item]});log("create","profile_field",item.id,null,item);return c.json(ok(item),201)});
app.patch("/api/v1/cluster/me/profile-fields/:id",async c=>{const body=await c.req.json<{label?:string;value?:string;updatedAt?:string}>();const user=c.get("authUser");const workspace=getWorkspace(user.id);let found=false;const profile=workspace.profile.map(field=>{if(field.id!==c.req.param("id"))return field;found=true;return{...field,...body,updatedAt:new Date().toISOString()}});if(!found)return c.json(fail("NOT_FOUND","الحقل غير موجود"),404);saveWorkspace(user.id,{profile});return c.json(ok(profile.find(field=>field.id===c.req.param("id"))))});
app.delete("/api/v1/cluster/me/profile-fields/:id",c=>{const user=c.get("authUser");const workspace=getWorkspace(user.id);const profile=workspace.profile.filter(field=>field.id!==c.req.param("id"));if(profile.length===workspace.profile.length)return c.json(fail("NOT_FOUND","الحقل غير موجود"),404);saveWorkspace(user.id,{profile});return c.json(ok({deleted:true,undoUntil:new Date(Date.now()+8000).toISOString()}))});
app.put("/api/v1/cluster/me/profile-fields/order",async c=>{const body=await c.req.json<{ids?:string[]}>();if(!Array.isArray(body.ids))return c.json(fail("VALIDATION_ERROR","ترتيب الحقول غير صحيح"),422);const user=c.get("authUser");const workspace=getWorkspace(user.id);const byId=new Map(workspace.profile.map(field=>[field.id,field]));const profile=body.ids.map(id=>byId.get(id)).filter((field):field is NonNullable<typeof field>=>Boolean(field));saveWorkspace(user.id,{profile});return c.json(ok({ids:profile.map(field=>field.id)}))});

registerCrud("/api/v1/cluster/me/sections","section","اسم القسم مطلوب");
registerCrud("/api/v1/sections/:parent/fields","section_field","اسم الحقل مطلوب");
registerCrud("/api/v1/schools/:parent/custom-fields","school_field","اسم الحقل مطلوب");
registerCrud("/api/v1/schools/:parent/staff-tiles","staff_tile","اسم المؤشر مطلوب");
registerCrud("/api/v1/schools/:parent/leadership","leadership","اسم الدور مطلوب");
registerCrud("/api/v1/leadership/:parent/fields","leadership_field","اسم الحقل مطلوب");
app.get("/api/v1/schools/:id/field-overrides",c=>c.json(ok({schoolId:c.req.param("id"),hidden:[]})));
app.put("/api/v1/schools/:id/field-overrides",async c=>{const body=await c.req.json<{hidden?:string[]}>();const item={schoolId:c.req.param("id"),hidden:body.hidden??[]};log("update","field_overrides",c.req.param("id"),null,item);return c.json(ok(item))});

app.get("/api/v1/cluster/me/absence",c=>{const date=c.req.query("date")??new Date().toISOString().slice(0,10);return c.json(ok(getWorkspace(c.get("authUser").id).schools.map(school=>({schoolId:String(school.id),date,done:Boolean(school.absence)}))))});
app.put("/api/v1/schools/:id/absence",async c=>{const body=await c.req.json<{date?:string;done?:boolean}>();if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date??"")||typeof body.done!=="boolean")return c.json(fail("VALIDATION_ERROR","بيانات التحديث غير مكتملة",{date:"التاريخ غير صحيح",done:"الحالة مطلوبة"}),422);const user=c.get("authUser");const workspace=getWorkspace(user.id);let found=false;const schools=workspace.schools.map(school=>{if(String(school.id)!==c.req.param("id"))return school;found=true;return{...school,absence:body.done,updatedAt:new Date().toISOString()}});if(!found)return c.json(fail("NOT_FOUND","المدرسة غير موجودة"),404);saveWorkspace(user.id,{schools});const item={schoolId:c.req.param("id"),date:body.date!,done:body.done,confirmedAt:new Date().toISOString(),confirmedBy:user.id};log("absence_toggle","absence_confirmation",`${c.req.param("id")}:${body.date}`,null,item);return c.json(ok(item))});

app.get("/api/v1/cluster/me/visits",c=>c.json(ok(visitsForUser(c.get("authUser").id))));
app.post("/api/v1/visits",async c=>{const body=await c.req.json<{schoolId?:string;type?:string;text?:string;attachments?:string[]}>();const fields:Record<string,string>={};if(!body.schoolId)fields.schoolId="اختاري المدرسة";if(!body.type)fields.type="نوع الزيارة مطلوب";if((body.text?.trim().length??0)<10)fields.text="أضيفي وصفاً لا يقل عن ١٠ أحرف";if(Object.keys(fields).length)return c.json(fail("VALIDATION_ERROR","أكملي بيانات تقرير الزيارة",fields),422);const user=c.get("authUser");const item=createVisit(user.id,{schoolId:body.schoolId!,type:body.type!,text:body.text!,attachments:body.attachments});log("create","visit_report",item.id,null,item);return c.json(ok(item),201)});

app.get("/api/v1/cluster/me/indicators/evaluation",c=>c.json(ok({source:"نافِس",readOnly:true,importedAt:"2026-09-20T09:00:00Z"})));
app.put("/api/v1/cluster/me/indicators/evaluation",async c=>{const body=await c.req.json<{folder?:string;reports?:unknown}>();if(body.folder){try{new URL(body.folder)}catch{return c.json(fail("VALIDATION_ERROR","الرابط غير صحيح",{folder:"الرابط غير صحيح"}),422)}}log("update","evaluation_links","cluster-4",null,body);return c.json(ok(body))});
app.get("/api/v1/cluster/me/indicators/madrasati",c=>c.json(ok(getWorkspace(c.get("authUser").id).schools.map(school=>({schoolId:school.id,metrics:school.madrasati??[]})))));
app.get("/api/v1/cluster/me/indicators/discipline",c=>c.json(ok(getWorkspace(c.get("authUser").id).schools.map(school=>({schoolId:school.id,values:school.discipline??[]})))));
app.get("/api/v1/cluster/me/plans",c=>c.json(ok([])));
app.get("/api/v1/cluster/me/pd",c=>c.json(ok(getWorkspace(c.get("authUser").id).programs)));
app.put("/api/v1/cluster/me/indicators/madrasati",async c=>{const body=await c.req.json();log("update","madrasati","cluster-4",null,body);return c.json(ok({...body,syncedAt:new Date().toISOString()}))});
app.put("/api/v1/cluster/me/indicators/discipline",async c=>{const body=await c.req.json();log("update","discipline","cluster-4",null,body);return c.json(ok({...body,importedAt:new Date().toISOString()}))});
app.get("/api/v1/cluster/me/discipline-support-plan",c=>c.json(ok({text:"",fileUrl:null})));
app.put("/api/v1/cluster/me/discipline-support-plan",async c=>{const body=await c.req.json();log("update","discipline_support_plan","cluster-4",null,body);return c.json(ok(body))});
app.patch("/api/v1/plans/:id",async c=>{const body=await c.req.json();log("update","plan",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
registerCrud("/api/v1/pd","pd_program","اسم البرنامج مطلوب");

app.post("/api/v1/ingest/upload",async c=>{const job={id:crypto.randomUUID(),clusterId:"cluster-4",status:"processing",progressPct:15,createdAt:new Date().toISOString()};bucket("ingest_job").push(job);log("upload","ingest_job",String(job.id),null,job);return c.json(ok([job]),202)});
app.get("/api/v1/ingest/jobs",c=>c.json(ok(bucket("ingest_job"))));
app.delete("/api/v1/ingest/jobs/:id",c=>{const items=bucket("ingest_job");const index=items.findIndex(item=>item.id===c.req.param("id"));if(index>=0)items.splice(index,1);log("delete","ingest_job",c.req.param("id"),null,{deleted:true});return c.json(ok({deleted:true}))});
app.get("/api/v1/ingest/jobs/:id/fields",c=>c.json(ok([{id:"extracted-1",ingestJobId:c.req.param("id"),label:"نتيجة نافس — ابتدائية الأندلس",value:"٨٤٪",confidence:"high",sourceRef:"تقرير نافس.pdf · ص ٢",status:"pending"},{id:"extracted-2",ingestJobId:c.req.param("id"),label:"الانضباط اليومي",value:"٩٦٪",confidence:"medium",sourceRef:"الانضباط اليومي.xlsx · الصف ٧",status:"pending"}])));
app.patch("/api/v1/ingest/fields/:id",async c=>{const body=await c.req.json();log("review","extracted_field",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
app.post("/api/v1/ingest/apply",async c=>{const body=await c.req.json<{fieldIds?:string[]}>();const count=body.fieldIds?.length??0;log("apply","extracted_fields","cluster-4",null,body);return c.json(ok({appliedCount:count}))});

app.get("/api/v1/district/overview",c=>{const team=teamForHead(c.get("authUser").id);const submitted=team.members.filter(member=>member.status==="submitted").length;const schools=team.members.reduce((sum,member)=>sum+member.schoolCount,0);return c.json(ok({kpis:{updated:submitted,members:team.members.length,pendingInvitations:team.invitations.length,schools},source:"persisted_team"}))});
app.get("/api/v1/district/members",c=>{const team=teamForHead(c.get("authUser").id);return c.json(ok(team.members,{total:team.members.length}))});
app.get("/api/v1/district/submissions",c=>{const team=teamForHead(c.get("authUser").id);const submitted=team.members.filter(member=>member.status==="submitted").length;return c.json(ok({submitted,missing:team.members.length-submitted,date:c.req.query("date")??new Date().toISOString().slice(0,10)}))});
app.get("/api/v1/district/members/:id",c=>{const member=teamForHead(c.get("authUser").id).members.find(item=>item.id===c.req.param("id"));return member?c.json(ok(member)):c.json(fail("NOT_FOUND","العضوة غير موجودة"),404)});
app.get("/api/v1/district/members/:id/timeline",c=>{const member=teamForHead(c.get("authUser").id).members.find(item=>item.id===c.req.param("id"));if(!member)return c.json(fail("NOT_FOUND","العضوة غير موجودة"),404);const events=[{id:`workspace-${member.id}`,kind:"workspace",title:"تحديث الملف",body:`${member.schoolCount} مدارس مسجلة · اكتمال ${member.completion}%`,at:member.workspaceUpdatedAt,flagged:false},...(member.submittedAt?[{id:`submission-${member.id}`,kind:"submission",title:"إرسال تحديث اليوم",body:"أرسلت العضوة تحديث ملفها إلى رئيسة النطاق",at:member.submittedAt,flagged:false}]:[])];return c.json(ok(events))});
app.get("/api/v1/district/members/:id/attachments",c=>{const member=teamForHead(c.get("authUser").id).members.find(item=>item.id===c.req.param("id"));return member?c.json(ok([])):c.json(fail("NOT_FOUND","العضوة غير موجودة"),404)});
app.patch("/api/v1/district/members/:id/contact",async c=>{const body=await c.req.json<{email?:string;phone?:string}>();if(body.email&&!body.email.endsWith("@moe.gov.sa"))return c.json(fail("VALIDATION_ERROR","البريد يجب أن ينتهي بـ moe.gov.sa"),422);if(body.phone&&!/^05\d{8}$/.test(body.phone))return c.json(fail("VALIDATION_ERROR","رقم الجوال يبدأ بـ ٠٥ ويكون ١٠ أرقام"),422);log("update","member_contact",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
app.post("/api/v1/district/reminders",async c=>{const body=await c.req.json<{memberIds?:string[];body?:string}>();if(!body.memberIds?.length)return c.json(fail("VALIDATION_ERROR","اختاري عضوة واحدة على الأقل"),422);const item={id:crypto.randomUUID(),memberIds:body.memberIds,body:body.body??"يرجى استكمال تحديث اليوم.",sentAt:new Date().toISOString()};reminders.unshift(item);log("send","reminder",item.id,null,item);return c.json(ok({sent:item.memberIds.length,reminder:item}),201)});
for(const kind of ["nafes","discipline","madrasati"])app.post(`/api/v1/district/imports/${kind}`,c=>{const item={id:crypto.randomUUID(),kind,status:"queued",createdAt:new Date().toISOString()};log("import","district_indicator",String(item.id),null,item);return c.json(ok(item),202)});

app.post("/api/v1/ai/chat",async c=>{const body=await c.req.json<{message?:string}>();if(!body.message?.trim())return c.json(fail("VALIDATION_ERROR","اكتبي سؤالك"),422);const team=teamForHead(c.get("authUser").id);const submitted=team.members.filter(member=>member.status==="submitted").length;return c.json(ok({text:`لديك ${team.members.length} حسابات مفعلة و${team.invitations.length} دعوات معلقة. أرسلت ${submitted} عضوات تحديث اليوم.`,citations:[{entity:"persisted_team",date:new Date().toISOString().slice(0,10)}],grounded:true}))});
app.get("/api/v1/ai/summary",c=>{const team=teamForHead(c.get("authUser").id);return c.json(ok({text:`${team.members.length} حسابات مفعلة، و${team.invitations.length} دعوات معلقة.`,generatedAt:new Date().toISOString(),grounded:true}))});
app.post("/api/v1/ai/agent/propose",async c=>{const body=await c.req.json<{action?:string}>();return c.json(ok({id:crypto.randomUUID(),action:body.action,status:"proposed",plan:["تحديد المتأخرات","جمع النواقص","صياغة الرسائل","بانتظار الموافقة"]}),201)});
app.post("/api/v1/ai/agent/:id/approve",c=>{log("approve","agent_run",c.req.param("id"),"proposed","executed");return c.json(ok({id:c.req.param("id"),status:"executed",resultSummary:"تم اعتماد الإجراء دون إنشاء بيانات افتراضية"}))});
app.post("/api/v1/ai/agent/:id/reject",c=>{log("reject","agent_run",c.req.param("id"),"proposed","rejected");return c.json(ok({id:c.req.param("id"),status:"rejected"}))});

app.get("/api/v1/district/report",c=>c.json(ok(report(c.get("authUser").id,c.req.query("date")))));
app.post("/api/v1/district/report/generate",async c=>{const body=await c.req.json<{date?:string;format?:string}>();const item={...report(c.get("authUser").id,body.date),format:body.format??"text",generatedAt:new Date().toISOString()};log("export","consolidated_report",item.id,null,item);return c.json(ok(item),201)});
app.get("/api/v1/attachments/:id/preview",c=>c.json(fail("NOT_FOUND","لا يوجد مرفق بهذا المعرّف"),404));
app.get("/api/v1/attachments/:id/download",c=>c.json(fail("NOT_FOUND","لا يوجد مرفق بهذا المعرّف"),404));
app.get("/api/v1/clusters/:id/attachments.zip",c=>c.json(fail("NOT_FOUND","لا توجد مرفقات للتنزيل"),404));
app.get("/api/v1/audit",c=>c.json(ok(audit,{total:audit.length})));

function report(headId:string,date?:string){const team=teamForHead(headId);const schools=team.members.reduce((sum,member)=>sum+member.schoolCount,0);const submitted=team.members.filter(member=>member.status==="submitted").length;const average=team.members.length?Math.round(team.members.reduce((sum,member)=>sum+member.completion,0)/team.members.length):0;return{id:"report-today",date:date??new Date().toISOString().slice(0,10),memberCount:team.members.length,schoolCount:schools,summaryText:`يضم النطاق ${team.members.length} عضوات مفعلات و${schools} مدارس مسجلة. أرسلت ${submitted} عضوات تحديث اليوم، ومتوسط اكتمال الملفات ${average}%.`,stats:[{label:"عضوة مفعلة",value:team.members.length},{label:"دعوة معلقة",value:team.invitations.length},{label:"مدرسة",value:schools},{label:"أرسلت اليوم",value:submitted},{label:"متوسط الاكتمال",value:`${average}%`}],citations:["persisted-team","member-workspaces"]}}

function registerCrud(base:string,entity:string,requiredMessage:string){
  app.get(base,c=>c.json(ok(bucket(entity).filter(item=>!c.req.param("parent")||item.parentId===c.req.param("parent")))));
  app.post(base,async c=>{const body=await c.req.json<Record<string,unknown>>();const label=String(body.label??body.name??"");if(!label.trim())return c.json(fail("VALIDATION_ERROR",requiredMessage,{label:requiredMessage}),422);const item={id:body.id??crypto.randomUUID(),parentId:c.req.param("parent"),...body};bucket(entity).push(item);log("create",entity,String(item.id),null,item);return c.json(ok(item),201)});
  app.patch(`${base}/:id`,async c=>{const body=await c.req.json<Record<string,unknown>>();const item=bucket(entity).find(row=>row.id===c.req.param("id"));if(!item)return c.json(fail("NOT_FOUND","العنصر غير موجود"),404);const before={...item};Object.assign(item,body);log("update",entity,String(item.id),before,item);return c.json(ok(item))});
  app.delete(`${base}/:id`,c=>{const items=bucket(entity);const index=items.findIndex(row=>row.id===c.req.param("id"));if(index<0)return c.json(fail("NOT_FOUND","العنصر غير موجود"),404);const [item]=items.splice(index,1);log("delete",entity,String(item.id),item,null);return c.json(ok({deleted:true}))});
}
