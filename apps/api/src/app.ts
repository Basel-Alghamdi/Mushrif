import { Hono } from "hono";
import { cors } from "hono/cors";

type Audit = { id:string; actorId:string; action:string; entity:string; entityId:string; before:unknown; after:unknown; at:string };
type Absence = { schoolId:string; date:string; done:boolean; confirmedAt:string; confirmedBy:string };
type Visit = { id:string; schoolId:string; memberId:string; type:string; text:string; attachments:string[]; createdAt:string };

const schoolNames=["ابتدائية الأندلس","متوسطة النهضة","ثانوية الرواد","ابتدائية الفيصلية","متوسطة الخنساء","ابتدائية الروضة"];
const absence=new Map<string,Absence>();
const visits:Visit[]=[];
const audit:Audit[]=[];
const submissions:Record<string,{status:string;submittedAt?:string}>={};
const reminders:{id:string;memberIds:string[];body:string;sentAt:string}[]=[];
const customFields:{id:string;label:string;value:string;owner:string}[]=[];
const records=new Map<string,Record<string,unknown>[]>();
const bucket=(name:string)=>{if(!records.has(name))records.set(name,[]);return records.get(name)!};

const ok=(data:unknown,meta?:unknown)=>({data,...(meta?{meta}: {})});
const fail=(code:string,message:string,fields?:Record<string,string>)=>({error:{code,message,...(fields?{fields}: {})}});
const log=(action:string,entity:string,entityId:string,before:unknown,after:unknown)=>audit.unshift({id:crypto.randomUUID(),actorId:"demo-user",action,entity,entityId,before,after,at:new Date().toISOString()});

export const app=new Hono();
app.use("*",cors({origin:(origin)=>origin||"http://localhost:3000",allowHeaders:["Content-Type","Authorization"],allowMethods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"]}));
app.get("/health",c=>c.json({status:"ok",service:"rasd-api",version:"v1"}));

app.post("/api/v1/auth/login",async c=>{const body=await c.req.json<{email?:string;password?:string}>();if(!body.email?.endsWith("@moe.gov.sa"))return c.json(fail("INVALID_EMAIL","البريد يجب أن ينتهي بـ moe.gov.sa",{email:"البريد الوزاري غير صحيح"}),422);const head=body.email==="s.alqahtani@moe.gov.sa";return c.json(ok({token:"demo-token",user:{id:head?"head-1":"member-1",name:head?"سارة القحطاني":"هند الشمري",email:body.email,role:head?"head":"member",clusterId:head?null:"cluster-4"}}));});
app.get("/api/v1/auth/me",c=>c.json(ok({user:{id:"member-1",name:"هند الشمري",role:"member",clusterId:"cluster-4"},permissions:["cluster:read","cluster:write","pii:own","ai:cluster"]})));
app.post("/api/v1/auth/logout",c=>c.json(ok({loggedOut:true})));
app.post("/api/v1/auth/forgot-password",async c=>{const body=await c.req.json<{email?:string}>();if(!body.email?.endsWith("@moe.gov.sa"))return c.json(fail("INVALID_EMAIL","البريد يجب أن ينتهي بـ moe.gov.sa"),422);return c.json(ok({sent:true,message:"أُرسلت تعليمات الاستعادة إلى بريدك الوزاري"}))});

app.get("/api/v1/cluster/me",c=>c.json(ok({id:"cluster-4",number:4,completion:78,schoolCount:6,sections:[100,92,100,84,79,50,72,65]})));
app.get("/api/v1/cluster/me/schools",c=>c.json(ok(schoolNames.map((name,index)=>({id:`school-${index+1}`,name,clusterId:"cluster-4"})))));
app.post("/api/v1/cluster/me/schools",async c=>{const body=await c.req.json<{name?:string}>();if(!body.name?.trim())return c.json(fail("VALIDATION_ERROR","اسم المدرسة مطلوب",{name:"اسم المدرسة مطلوب"}),422);const item={id:crypto.randomUUID(),name:body.name,clusterId:"cluster-4"};log("create","school",item.id,null,item);return c.json(ok(item),201)});
app.patch("/api/v1/cluster/me/schools/:id",async c=>{const body=await c.req.json();log("update","school",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
app.delete("/api/v1/cluster/me/schools/:id",c=>{log("delete","school",c.req.param("id"),null,null);return c.json(ok({deleted:true}))});

app.get("/api/v1/cluster/me/profile-fields",c=>c.json(ok(customFields.filter(item=>item.owner==="profile"))));
app.post("/api/v1/cluster/me/profile-fields",async c=>{const body=await c.req.json<{id?:string;label?:string;value?:string}>();if(!body.label?.trim())return c.json(fail("VALIDATION_ERROR","اسم الحقل مطلوب",{label:"اسم الحقل مطلوب"}),422);const item={id:body.id??crypto.randomUUID(),label:body.label,value:body.value??"",owner:"profile"};customFields.push(item);log("create","profile_field",item.id,null,item);return c.json(ok(item),201)});
app.patch("/api/v1/cluster/me/profile-fields/:id",async c=>{const body=await c.req.json<{label?:string;value?:string}>();let item=customFields.find(field=>field.id===c.req.param("id"));if(!item){item={id:c.req.param("id"),label:body.label??"حقل",value:body.value??"",owner:"profile"};customFields.push(item)}const before={...item};Object.assign(item,body);log("update","profile_field",item.id,before,item);return c.json(ok(item))});
app.delete("/api/v1/cluster/me/profile-fields/:id",c=>{const index=customFields.findIndex(field=>field.id===c.req.param("id"));const item=index>=0?customFields.splice(index,1)[0]:{id:c.req.param("id"),label:"built-in",value:"",owner:"profile"};log("delete","profile_field",item.id,item,{deletedAt:new Date().toISOString()});return c.json(ok({deleted:true,undoUntil:new Date(Date.now()+8000).toISOString()}))});

registerCrud("/api/v1/cluster/me/sections","section","اسم القسم مطلوب");
registerCrud("/api/v1/sections/:parent/fields","section_field","اسم الحقل مطلوب");
registerCrud("/api/v1/schools/:parent/custom-fields","school_field","اسم الحقل مطلوب");
registerCrud("/api/v1/schools/:parent/staff-tiles","staff_tile","اسم المؤشر مطلوب");
registerCrud("/api/v1/schools/:parent/leadership","leadership","اسم الدور مطلوب");
registerCrud("/api/v1/leadership/:parent/fields","leadership_field","اسم الحقل مطلوب");
app.get("/api/v1/schools/:id/field-overrides",c=>c.json(ok({schoolId:c.req.param("id"),hidden:[]})));
app.put("/api/v1/schools/:id/field-overrides",async c=>{const body=await c.req.json<{hidden?:string[]}>();const item={schoolId:c.req.param("id"),hidden:body.hidden??[]};log("update","field_overrides",c.req.param("id"),null,item);return c.json(ok(item))});

app.get("/api/v1/cluster/me/absence",c=>{const date=c.req.query("date")??new Date().toISOString().slice(0,10);return c.json(ok(schoolNames.map((name,index)=>absence.get(`school-${index+1}:${date}`)??{schoolId:`school-${index+1}`,date,done:index<3}))) });
app.put("/api/v1/schools/:id/absence",async c=>{const body=await c.req.json<{date?:string;done?:boolean}>();if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date??"")||typeof body.done!=="boolean")return c.json(fail("VALIDATION_ERROR","بيانات التحديث غير مكتملة",{date:"التاريخ غير صحيح",done:"الحالة مطلوبة"}),422);const key=`${c.req.param("id")}:${body.date}`;const before=absence.get(key)??null;const item={schoolId:c.req.param("id"),date:body.date!,done:body.done,confirmedAt:new Date().toISOString(),confirmedBy:"member-1"};absence.set(key,item);log("absence_toggle","absence_confirmation",key,before,item);return c.json(ok(item))});

app.get("/api/v1/cluster/me/visits",c=>c.json(ok(visits)));
app.post("/api/v1/visits",async c=>{const body=await c.req.json<{schoolId?:string;type?:string;text?:string;attachments?:string[]}>();const fields:Record<string,string>={};if(!body.schoolId)fields.schoolId="اختاري المدرسة";if(!body.type)fields.type="نوع الزيارة مطلوب";if((body.text?.trim().length??0)<10)fields.text="أضيفي وصفاً لا يقل عن ١٠ أحرف";if(Object.keys(fields).length)return c.json(fail("VALIDATION_ERROR","أكملي بيانات تقرير الزيارة",fields),422);const item={id:crypto.randomUUID(),schoolId:body.schoolId!,memberId:"member-1",type:body.type!,text:body.text!,attachments:body.attachments??[],createdAt:new Date().toISOString()};visits.unshift(item);log("create","visit_report",item.id,null,item);return c.json(ok(item),201)});
app.post("/api/v1/cluster/me/submit",c=>{const date=new Date().toISOString().slice(0,10);const item={status:"submitted",submittedAt:new Date().toISOString()};submissions["member-1"]=item;log("submit","daily_submission",`member-1:${date}`,null,item);return c.json(ok(item),201)});

app.get("/api/v1/cluster/me/indicators/evaluation",c=>c.json(ok({source:"نافِس",readOnly:true,importedAt:"2026-09-20T09:00:00Z"})));
app.get("/api/v1/cluster/me/indicators/madrasati",c=>c.json(ok({source:"sync",metrics:[94,88,97,82,76,80]})));
app.get("/api/v1/cluster/me/indicators/discipline",c=>c.json(ok({source:"upload",daily:92,weekly:90,monthly:91})));
app.get("/api/v1/cluster/me/plans",c=>c.json(ok(["realityAnalysis","improvement","execution1","execution2","execution3"].map((kind,index)=>({id:`plan-${index+1}`,kind,status:index===4?"missing":"uploaded"})))));
app.get("/api/v1/cluster/me/pd",c=>c.json(ok([4,12,6,2].map((count,index)=>({id:`pd-${index+1}`,kind:["plc","workshop","appliedLesson","other"][index],count,status:index===3?"missing":"uploaded"})))));
app.put("/api/v1/cluster/me/indicators/madrasati",async c=>{const body=await c.req.json();log("update","madrasati","cluster-4",null,body);return c.json(ok({...body,syncedAt:new Date().toISOString()}))});
app.put("/api/v1/cluster/me/indicators/discipline",async c=>{const body=await c.req.json();log("update","discipline","cluster-4",null,body);return c.json(ok({...body,importedAt:new Date().toISOString()}))});
app.get("/api/v1/cluster/me/discipline-support-plan",c=>c.json(ok({text:"متابعة المدارس الأقل من ٨٥٪ أسبوعياً",fileUrl:"demo://support-plan.pdf"})));
app.put("/api/v1/cluster/me/discipline-support-plan",async c=>{const body=await c.req.json();log("update","discipline_support_plan","cluster-4",null,body);return c.json(ok(body))});
app.patch("/api/v1/plans/:id",async c=>{const body=await c.req.json();log("update","plan",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
registerCrud("/api/v1/pd","pd_program","اسم البرنامج مطلوب");

app.post("/api/v1/ingest/upload",async c=>{const job={id:crypto.randomUUID(),clusterId:"cluster-4",status:"processing",progressPct:15,createdAt:new Date().toISOString()};bucket("ingest_job").push(job);log("upload","ingest_job",String(job.id),null,job);return c.json(ok([job]),202)});
app.get("/api/v1/ingest/jobs",c=>c.json(ok(bucket("ingest_job"))));
app.get("/api/v1/ingest/jobs/:id/fields",c=>c.json(ok([{id:"extracted-1",ingestJobId:c.req.param("id"),label:"نتيجة نافس — ابتدائية الأندلس",value:"٨٤٪",confidence:"high",sourceRef:"تقرير نافس.pdf · ص ٢",status:"pending"},{id:"extracted-2",ingestJobId:c.req.param("id"),label:"الانضباط اليومي",value:"٩٦٪",confidence:"medium",sourceRef:"الانضباط اليومي.xlsx · الصف ٧",status:"pending"}])));
app.patch("/api/v1/ingest/fields/:id",async c=>{const body=await c.req.json();log("review","extracted_field",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
app.post("/api/v1/ingest/apply",async c=>{const body=await c.req.json<{fieldIds?:string[]}>();const count=body.fieldIds?.length??0;log("apply","extracted_fields","cluster-4",null,body);return c.json(ok({appliedCount:count}))});

app.get("/api/v1/district/overview",c=>c.json(ok({kpis:{updated:18,members:25,absence:124,schools:150,discipline:94,visits:47},week:[142,148,131,124,0],tiers:{"تميز":21,"تقدم":68,"انطلاق":52,"تهيئة":9}})));
app.get("/api/v1/district/members",c=>c.json(ok(Array.from({length:25},(_,index)=>({id:`member-${index+1}`,cluster:index+1,status:index<18?"submitted":index<22?"late":"missing"})),{total:25})));
app.get("/api/v1/district/submissions",c=>c.json(ok({submitted:18,late:4,missing:3,date:c.req.query("date")??new Date().toISOString().slice(0,10)})));
app.get("/api/v1/district/members/:id",c=>c.json(ok({id:c.req.param("id"),name:"هند الشمري",cluster:"عنقود ٤",completion:92,absence:6,visits:9,discipline:96,email:"h.alshammari@moe.gov.sa",phone:"٠٥٥٤٢٣٨٨١٠"})));
app.get("/api/v1/district/members/:id/timeline",c=>c.json(ok([{id:"event-1",kind:"غياب",title:"تثبيت الغياب",body:"ثبّتت الغياب في ٦ من ٦ مدارس",at:new Date().toISOString(),flagged:false},{id:"event-2",kind:"زيارة",title:"تقرير زيارة صفية",body:"ابتدائية الأندلس · تقرير موثّق مع ٣ مرفقات",at:new Date().toISOString(),flagged:false}])));
app.get("/api/v1/district/members/:id/attachments",c=>c.json(ok([{id:"attachment-1",name:"خطة التحسين.pdf",kind:"PDF",sizeBytes:1468006,pages:12,status:"uploaded"},{id:"attachment-2",name:"استمارة تنفيذ الخطة ٣.docx",kind:"Word",status:"missing"}])));
app.patch("/api/v1/district/members/:id/contact",async c=>{const body=await c.req.json<{email?:string;phone?:string}>();if(body.email&&!body.email.endsWith("@moe.gov.sa"))return c.json(fail("VALIDATION_ERROR","البريد يجب أن ينتهي بـ moe.gov.sa"),422);if(body.phone&&!/^05\d{8}$/.test(body.phone))return c.json(fail("VALIDATION_ERROR","رقم الجوال يبدأ بـ ٠٥ ويكون ١٠ أرقام"),422);log("update","member_contact",c.req.param("id"),null,body);return c.json(ok({id:c.req.param("id"),...body}))});
app.post("/api/v1/district/reminders",async c=>{const body=await c.req.json<{memberIds?:string[];body?:string}>();if(!body.memberIds?.length)return c.json(fail("VALIDATION_ERROR","اختاري عضوة واحدة على الأقل"),422);const item={id:crypto.randomUUID(),memberIds:body.memberIds,body:body.body??"يرجى استكمال تحديث اليوم.",sentAt:new Date().toISOString()};reminders.unshift(item);log("send","reminder",item.id,null,item);return c.json(ok({sent:item.memberIds.length,reminder:item}),201)});
for(const kind of ["nafes","discipline","madrasati"])app.post(`/api/v1/district/imports/${kind}`,c=>{const item={id:crypto.randomUUID(),kind,status:"queued",createdAt:new Date().toISOString()};log("import","district_indicator",String(item.id),null,item);return c.json(ok(item),202)});

app.post("/api/v1/ai/chat",async c=>{const body=await c.req.json<{message?:string}>();if(!body.message?.trim())return c.json(fail("VALIDATION_ERROR","اكتبي سؤالك"),422);return c.json(ok({text:"١٢٤ من ١٥٠ مدرسة ثبّتت الغياب بنسبة ٨٣٪، وبلغ متوسط الانضباط ٩٤٪.",citations:[{entity:"daily_submission",id:"district-today",date:new Date().toISOString().slice(0,10)}],grounded:true}))});
app.get("/api/v1/ai/summary",c=>c.json(ok({text:"اكتمل تحديث ١٨ عضوة اليوم، وثلاثة عناقيد تحتاج متابعة مباشرة.",generatedAt:new Date().toISOString(),grounded:true})));
app.post("/api/v1/ai/agent/propose",async c=>{const body=await c.req.json<{action?:string}>();return c.json(ok({id:crypto.randomUUID(),action:body.action,status:"proposed",plan:["تحديد المتأخرات","جمع النواقص","صياغة الرسائل","بانتظار الموافقة"]}),201)});
app.post("/api/v1/ai/agent/:id/approve",c=>{log("approve","agent_run",c.req.param("id"),"proposed","executed");return c.json(ok({id:c.req.param("id"),status:"executed",resultSummary:"أُرسلت ٧ رسائل تذكير"}))});

app.get("/api/v1/district/report",c=>c.json(ok(report(c.req.query("date")))));
app.post("/api/v1/district/report/generate",async c=>{const body=await c.req.json<{date?:string;format?:string}>();const item={...report(body.date),format:body.format??"text",generatedAt:new Date().toISOString()};log("export","consolidated_report",item.id,null,item);return c.json(ok(item),201)});
app.get("/api/v1/attachments/:id/preview",c=>c.json(ok({url:`https://example.invalid/signed/preview/${c.req.param("id")}`,expiresIn:300})));
app.get("/api/v1/attachments/:id/download",c=>c.json(ok({url:`https://example.invalid/signed/download/${c.req.param("id")}`,expiresIn:300})));
app.get("/api/v1/clusters/:id/attachments.zip",c=>c.json(ok({url:`https://example.invalid/signed/cluster-${c.req.param("id")}.zip`,expiresIn:300})));
app.get("/api/v1/audit",c=>c.json(ok(audit,{total:audit.length})));

function report(date?:string){return{id:"report-today",date:date??new Date().toISOString().slice(0,10),memberCount:18,schoolCount:150,summaryText:"ثبّتت مدارس النطاق الغياب في ١٢٤ مدرسة من أصل ١٥٠ بنسبة ٨٣٪، ونفّذ الفريق ٤٧ زيارة ميدانية موثّقة. بلغ متوسط الانضباط اليومي ٩٤٪.",stats:[{label:"مدرسة",value:150},{label:"غياب مثبت",value:124},{label:"زيارة",value:47},{label:"الانضباط",value:"94%"}],citations:["daily-submissions:today","visit-reports:week","discipline-import:today"]}}

function registerCrud(base:string,entity:string,requiredMessage:string){
  app.get(base,c=>c.json(ok(bucket(entity).filter(item=>!c.req.param("parent")||item.parentId===c.req.param("parent")))));
  app.post(base,async c=>{const body=await c.req.json<Record<string,unknown>>();const label=String(body.label??body.name??"");if(!label.trim())return c.json(fail("VALIDATION_ERROR",requiredMessage,{label:requiredMessage}),422);const item={id:body.id??crypto.randomUUID(),parentId:c.req.param("parent"),...body};bucket(entity).push(item);log("create",entity,String(item.id),null,item);return c.json(ok(item),201)});
  app.patch(`${base}/:id`,async c=>{const body=await c.req.json<Record<string,unknown>>();const item=bucket(entity).find(row=>row.id===c.req.param("id"));if(!item)return c.json(fail("NOT_FOUND","العنصر غير موجود"),404);const before={...item};Object.assign(item,body);log("update",entity,String(item.id),before,item);return c.json(ok(item))});
  app.delete(`${base}/:id`,c=>{const items=bucket(entity);const index=items.findIndex(row=>row.id===c.req.param("id"));if(index<0)return c.json(fail("NOT_FOUND","العنصر غير موجود"),404);const [item]=items.splice(index,1);log("delete",entity,String(item.id),item,null);return c.json(ok({deleted:true}))});
}
