"use client";

import { FileUp, UploadCloud } from "lucide-react";
import { ar } from "@rasd/i18n";
import { validators } from "@rasd/schemas";
import { api } from "../../lib/api";
import type { Plan } from "../../lib/types";
import { PageTitle, Progress, SectionTitle, StatusPill } from "../platform-shell";
import { EditableInput, Empty, useMember, WorkspaceSection } from "./context";
import { withVersion } from "./file-page";
import { replaceById } from "./mutations";

export function TodayPage() {
  return <div className="page-stack">
    <PageTitle title="اليوم" description="ثبّتي الغياب، ارفعي أعمالك الميدانية، وراجعي الخطط."/>
    <WorkspaceSection><TasksSection/></WorkspaceSection>
    <WorkspaceSection><IngestSection/></WorkspaceSection>
  </div>;
}

function TasksSection() {
  const { ws, setWs, fail } = useMember();
  const schools = ws.schools;
  const done = schools.filter(school => school.absenceToday).length;

  const toggleAbsence = async (id: string, next: boolean) => {
    const setDone = (value: boolean) => setWs(current => ({ ...current, schools: replaceById(current.schools, id, { absenceToday: value }) }));
    setDone(next);
    try { await api(`/schools/${id}/absence`, { method: "PUT", body: { date: ws.cluster.today, done: next } }); }
    catch (error) { setDone(!next); fail(error, () => toggleAbsence(id, next)); }
  };
  const savePlan = (plan: Plan) => async (patch: Record<string, unknown>, force: boolean) => {
    const row = await api<Plan>(`/plans/${plan.id}`, { method: "PATCH", body: withVersion(patch, plan.updatedAt, force) });
    setWs(current => ({ ...current, plans: replaceById(current.plans, plan.id, { url: row.url, status: row.status, updatedAt: row.updatedAt }) }));
  };
  const togglePlan = async (plan: Plan) => {
    try { await savePlan(plan)({ status: plan.status === "uploaded" ? "missing" : "uploaded" }, true); }
    catch (error) { fail(error, () => togglePlan(plan)); }
  };

  return <>
    <SectionTitle title="مهام اليوم" description="تظهر حالة الغياب مباشرة في لوحة رئيسة النطاق."/>
    <section className="card">
      <div className="card-title-row"><div><h3>تثبيت الغياب اليومي</h3><p>{ar(done)} من {ar(schools.length)} مثبتة</p></div><Progress value={schools.length ? (done / schools.length) * 100 : 0}/></div>
      {schools.length === 0 ? <Empty title="لا توجد مدارس لتثبيت الغياب — أضيفيها من ملف العنقود"/> : <div className="absence-grid">{schools.map(school =>
        <button className={school.absenceToday ? "done" : "missing"} key={school.id} aria-pressed={school.absenceToday} onClick={() => toggleAbsence(school.id, !school.absenceToday)}>
          <span>{school.name}</span><StatusPill tone={school.absenceToday ? "accent" : "alert"}>{school.absenceToday ? "تم" : "لم يتم"}</StatusPill>
        </button>)}</div>}
    </section>
    <section className="card">
      <div className="card-title-row"><h3>تقارير الزيارات</h3><StatusPill>{ar(schools.reduce((sum, school) => sum + school.visitCount, 0))} زيارة · تُحسب تلقائياً</StatusPill></div>
      {schools.map(school => <div className="bar-row" key={school.id}><span>{school.name}</span><Progress value={(school.visitCount / 12) * 100}/><b>{ar(school.visitCount)}</b></div>)}
      <a className="secondary-button inline" href="/field"><UploadCloud/>رفع تقرير زيارة من الجوال</a>
    </section>
    <section className="card">
      <h3>الخطط</h3>
      {ws.plans.map(plan => <div className="plan-editor" key={plan.id}>
        <b>{plan.label}</b>
        <div><EditableInput dir="ltr" aria-label={`رابط ${plan.label}`} value={plan.url} placeholder="رابط درايف" validate={validators.url} save={(url, force) => savePlan(plan)({ url: url.trim() }, force)}/></div>
        <button aria-label={`تغيير حالة ${plan.label}`} onClick={() => togglePlan(plan)}><StatusPill tone={plan.status === "uploaded" ? "accent" : "alert"}>{plan.status === "uploaded" ? "مرفوع" : "ناقص"}</StatusPill></button>
      </div>)}
    </section>
  </>;
}

// Upload, extraction and review arrive with the Supabase Storage + OpenAI step; until then nothing here pretends to work.
function IngestSection() {
  return <>
    <SectionTitle title="الاستيراد الذكي للملفات" description="ارفعي الملفات، راجعي كل قيمة ومصدرها، ثم طبّقي الحقول المعتمدة."/>
    <div className="drop-zone disabled" aria-disabled="true"><FileUp/><b>الاستيراد الذكي قيد التجهيز</b><span>سيُفعّل بعد ربط التخزين والذكاء الاصطناعي · حتى ٢٠ ملفاً · ٢٥ م.ب لكل ملف</span></div>
  </>;
}
