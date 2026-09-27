"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ar } from "@rasd/i18n";
import { MADRASATI_METRICS, PD_KINDS, toWesternDigits, validators } from "@rasd/schemas";
import { api } from "../../lib/api";
import type { Program, School } from "../../lib/types";
import { formatTime, PageTitle, Progress, SectionTitle, StatusPill } from "../platform-shell";
import { EditableInput, EditableSelect, Empty, LabelText, useMember, WorkspaceSection } from "./context";
import { Tier, withVersion } from "./file-page";
import { replaceById, useCreate, useRemove } from "./mutations";

export function IndicatorsPage() {
  return <div className="page-stack">
    <PageTitle title="المؤشرات" description="التقويم المدرسي، مدرستي، الانضباط، والتطوير المهني."/>
    <WorkspaceSection><EvaluationSection/></WorkspaceSection>
    <WorkspaceSection><MadrasatiSection/></WorkspaceSection>
    <WorkspaceSection><DisciplineSection/></WorkspaceSection>
    <WorkspaceSection><DevelopmentSection/></WorkspaceSection>
  </div>;
}

const clampPercent = (value: string) => Math.min(100, Math.max(0, Math.round(Number(toWesternDigits(value)) || 0)));

/** A 0–100 cell bound to workspace state (so dependent averages recompute while typing); saves on blur, rolls back on failure. */
function PercentCell({ value, label, set, save }: { value: number; label: string; set: (value: number) => void; save: () => Promise<unknown> }) {
  const { fail } = useMember();
  const snapshot = useRef(value);
  const commit = async () => {
    if (value === snapshot.current) return;
    try { await save(); snapshot.current = value; } catch (error) { set(snapshot.current); fail(error); }
  };
  return <><input className={`percent-input ${value < 75 ? "attention-text" : ""}`} type="number" min="0" max="100" inputMode="numeric" aria-label={label} value={value}
    onFocus={() => { snapshot.current = value; }} onChange={event => set(clampPercent(event.target.value))} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}/><span>٪</span></>;
}

function EvaluationSection() {
  const { ws, setWs, fail } = useMember();
  const imported = ws.schools.map(school => school.evaluation?.importedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const saveReport = async (school: School, patch: Record<string, unknown>) => {
    const row = await api<{ externalReportUrl: string; externalReportStatus: string }>("/cluster/me/indicators/evaluation", { method: "PUT", body: { schoolId: school.id, ...patch } });
    setWs(current => ({ ...current, schools: replaceById(current.schools, school.id, item => ({ ...item, evaluation: { ...(item.evaluation ?? emptyEvaluation), externalReportUrl: row.externalReportUrl, externalReportStatus: row.externalReportStatus } })) }));
  };
  const toggleReport = async (school: School) => {
    try { await saveReport(school, { externalReportStatus: school.evaluation?.externalReportStatus === "uploaded" ? "missing" : "uploaded" }); }
    catch (error) { fail(error, () => toggleReport(school)); }
  };
  return <>
    <SectionTitle title="مؤشرات التقويم المدرسي" actions={<StatusPill tone={imported ? "accent" : "neutral"}>{imported ? `مستورد من لوحة رئيسة النطاق · ${formatTime(imported)}` : "لم تستورد رئيسة النطاق هذه المؤشرات بعد"}</StatusPill>}/>
    {ws.schools.length === 0 ? <Empty title="أضيفي مدارس العنقود أولاً"/> : <div className="card table-card"><table>
      <thead><tr>{["المدرسة", "التصنيف", "نوع الدعم", "نافس", "القدرات", "التحصيلي"].map(header => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{ws.schools.map(school => {
        const evaluation = school.evaluation;
        const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${ar(value)}٪`);
        return <tr key={school.id}>
          <td>{school.name}</td><td>{school.tier ? <Tier tier={school.tier}/> : "—"}</td><td>{evaluation?.supportType || "—"}</td>
          <td className={evaluation?.nafesDirection === "down" ? "attention-text" : ""}>{evaluation?.nafesValue !== null && evaluation?.nafesValue !== undefined ? `${percent(evaluation.nafesValue)} ${evaluation.nafesDelta}` : "—"}</td>
          <td>{percent(evaluation?.qudrat)}</td><td>{percent(evaluation?.tahsili)}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    <div className="two-cards">
      <section className="card"><h3>التقرير الخارجي — المجالات والمعايير</h3>{ws.schools.map(school => <div className="file-row" key={school.id}>
        <span>{school.name}<EditableInput dir="ltr" placeholder="رابط التقرير في الدرايف" aria-label={`رابط التقرير الخارجي لـ${school.name}`} value={school.evaluation?.externalReportUrl ?? ""} validate={validators.url} save={url => saveReport(school, { externalReportUrl: url.trim() })}/></span>
        <button className="status-toggle" aria-label={`حالة التقرير الخارجي لـ${school.name}`} onClick={() => toggleReport(school)}><StatusPill tone={school.evaluation?.externalReportStatus === "uploaded" ? "accent" : "alert"}>{school.evaluation?.externalReportStatus === "uploaded" ? "مرفوع" : "ناقص"}</StatusPill></button>
      </div>)}</section>
      <section className="card"><h3>بطاقة نافس</h3><label><span>رابط مجلد الدرايف</span>
        <EditableInput dir="ltr" value={ws.cluster.nafesCardFolderUrl} validate={validators.url} save={async url => {
          await api("/cluster/me/indicators/evaluation", { method: "PUT", body: { nafesCardFolderUrl: url.trim() } });
          setWs(current => ({ ...current, cluster: { ...current.cluster, nafesCardFolderUrl: url.trim() } }));
        }}/></label><small>يُحفظ الرابط عند مغادرة الحقل.</small></section>
    </div>
  </>;
}
const emptyEvaluation = { supportType: "", nafesValue: null, nafesDirection: "", nafesDelta: "", qudrat: null, tahsili: null, externalReportUrl: "", externalReportStatus: "missing", importedAt: null };

function MadrasatiSection() {
  const { ws, setWs } = useMember();
  const averages = MADRASATI_METRICS.map((_, index) => ws.schools.length ? Math.round(ws.schools.reduce((sum, school) => sum + school.madrasati[index], 0) / ws.schools.length) : 0);
  const setMetric = (schoolId: string, index: number, value: number) =>
    setWs(current => ({ ...current, schools: replaceById(current.schools, schoolId, item => ({ ...item, madrasati: item.madrasati.map((old, i) => (i === index ? value : old)) })) }));
  return <>
    <SectionTitle title="مؤشرات منصة مدرستي" description="عدّلي نسب كل مدرسة؛ المتوسطات تُحسب تلقائياً."/>
    <div className="metric-grid">{MADRASATI_METRICS.map((metric, index) => <article className="card metric-card" key={metric.key}>
      <span>{metric.label}</span><b className={averages[index] < 75 ? "attention-text" : ""}>{ar(averages[index])}٪</b><Progress value={averages[index]}/><small>تُحسب تلقائياً</small>
    </article>)}</div>
    {ws.schools.length > 0 && <div className="card table-card"><table>
      <thead><tr><th>المدرسة</th>{MADRASATI_METRICS.map(metric => <th key={metric.key}>{metric.label}</th>)}</tr></thead>
      <tbody>{ws.schools.map(school => <tr key={school.id}><td><b>{school.name}</b></td>{school.madrasati.map((value, index) => <td key={index}>
        <PercentCell value={value} label={`${MADRASATI_METRICS[index].label} في ${school.name}`} set={next => setMetric(school.id, index, next)}
          save={() => api("/cluster/me/indicators/madrasati", { method: "PUT", body: { schoolId: school.id, metrics: school.madrasati } })}/>
      </td>)}</tr>)}</tbody>
    </table></div>}
  </>;
}

function DisciplineSection() {
  const { ws, setWs, fail } = useMember();
  const [plan, setPlan] = useState(ws.disciplineSupportPlan.text);
  useEffect(() => setPlan(ws.disciplineSupportPlan.text), [ws.disciplineSupportPlan.text]);
  const periods = [["daily", "يومي"], ["weekly", "أسبوعي"], ["monthly", "شهري"]] as const;
  const setDiscipline = (schoolId: string, patch: Partial<School["discipline"]>) =>
    setWs(current => ({ ...current, schools: replaceById(current.schools, schoolId, item => ({ ...item, discipline: { ...item.discipline, ...patch } })) }));
  const togglePlanStatus = async (school: School) => {
    const next = school.discipline.planStatus === "approved" ? "missing" : "approved";
    setDiscipline(school.id, { planStatus: next });
    try { await api("/cluster/me/indicators/discipline", { method: "PUT", body: { schoolId: school.id, planStatus: next } }); }
    catch (error) { setDiscipline(school.id, { planStatus: school.discipline.planStatus }); fail(error); }
  };
  const savePlan = async (force = false) => {
    if (plan === ws.disciplineSupportPlan.text) return;
    try {
      const row = await api<{ text: string; updatedAt: string }>("/cluster/me/discipline-support-plan", { method: "PUT", body: withVersion({ text: plan }, ws.disciplineSupportPlan.updatedAt ?? "", force) });
      setWs(current => ({ ...current, disciplineSupportPlan: { text: row.text, updatedAt: row.updatedAt } }));
    } catch (error) { fail(error, () => savePlan(force), () => savePlan(true)); }
  };
  return <>
    <SectionTitle title="مؤشرات الانضباط المدرسي"/>
    {ws.schools.length > 0 && <div className="card table-card"><table>
      <thead><tr><th>المدرسة</th><th>التصنيف</th>{periods.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{ws.schools.map(school => <tr key={school.id}><td>{school.name}</td><td>{school.tier ? <Tier tier={school.tier}/> : "—"}</td>{periods.map(([key, label]) => <td key={key}>
        <PercentCell value={school.discipline[key]} label={`الانضباط ${label} في ${school.name}`} set={value => setDiscipline(school.id, { [key]: value })}
          save={() => api("/cluster/me/indicators/discipline", { method: "PUT", body: { schoolId: school.id, [key]: school.discipline[key] } })}/>
      </td>)}</tr>)}</tbody>
    </table></div>}
    <div className="two-cards">
      <section className="card"><h3>خطة الانضباط للمدارس</h3>{ws.schools.map(school => <button className="file-row interactive" key={school.id} onClick={() => togglePlanStatus(school)}>
        <span>{school.name}</span><StatusPill tone={school.discipline.planStatus === "approved" ? "accent" : "alert"}>{school.discipline.planStatus === "approved" ? "معتمدة" : "لم تُرفع"}</StatusPill>
      </button>)}</section>
      <section className="card"><h3>خطة دعم الانضباط — عضو الفريق</h3>
        <textarea maxLength={1000} aria-label="خطة دعم الانضباط" value={plan} onChange={event => setPlan(event.target.value)} onBlur={() => savePlan()}/>
        <small>{ar(plan.length)} / ١٠٠٠ · يُحفظ عند مغادرة الحقل</small>
        <div className="file-row"><span>إرفاق ملف الخطة<small>يُفعّل مع خدمة التخزين</small></span><StatusPill>قيد التجهيز</StatusPill></div>
      </section>
    </div>
  </>;
}

function DevelopmentSection() {
  const { ws, setWs, fail } = useMember();
  const create = useCreate();
  const remove = useRemove();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", kind: "workshop", count: "1", reportsUrl: "" });
  const [draftError, setDraftError] = useState("");
  const kinds = Object.entries(PD_KINDS).map(([value, label]) => ({ value, label }));
  const add = () => {
    const urlError = validators.url(draft.reportsUrl);
    if (!draft.label.trim()) { setDraftError("اسم البرنامج مطلوب"); return; }
    if (urlError) { setDraftError(urlError); return; }
    const id = crypto.randomUUID();
    const program: Program = { id, kind: draft.kind, label: draft.label.trim(), count: Number(toWesternDigits(draft.count)) || 0, reportsUrl: draft.reportsUrl.trim(), status: draft.reportsUrl.trim() ? "uploaded" : "missing", updatedAt: "" };
    create<Program>({ path: "/pd", body: { id, kind: program.kind, label: program.label, count: program.count, reportsUrl: program.reportsUrl, status: program.status },
      apply: () => { setWs(current => ({ ...current, programs: [...current.programs, program] })); setAdding(false); setDraftError(""); setDraft({ label: "", kind: "workshop", count: "1", reportsUrl: "" }); },
      rollback: () => setWs(current => ({ ...current, programs: current.programs.filter(item => item.id !== id) })),
      then: row => setWs(current => ({ ...current, programs: replaceById(current.programs, id, { updatedAt: row.updatedAt }) })) });
  };
  const save = (program: Program) => async (patch: Record<string, unknown>, force: boolean) => {
    const row = await api<Program>(`/pd/${program.id}`, { method: "PATCH", body: withVersion(patch, program.updatedAt, force) });
    setWs(current => ({ ...current, programs: replaceById(current.programs, program.id, { kind: row.kind, label: row.label, count: row.count, reportsUrl: row.reportsUrl, status: row.status, updatedAt: row.updatedAt }) }));
  };
  return <>
    <SectionTitle title="التطوير المهني" actions={<button className="secondary-button" onClick={() => setAdding(value => !value)}><Plus/>إضافة برنامج</button>}/>
    {adding && <section className="card add-program">
      <label><span>اسم البرنامج</span><input value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })}/></label>
      <label><span>النوع</span><select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>{kinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
      <label><span>العدد</span><input inputMode="numeric" value={draft.count} onChange={event => setDraft({ ...draft, count: event.target.value })}/></label>
      <label><span>رابط التقارير</span><input dir="ltr" value={draft.reportsUrl} onChange={event => setDraft({ ...draft, reportsUrl: event.target.value })}/></label>
      <button className="primary-button" onClick={add}>إضافة البرنامج</button><button className="secondary-button" onClick={() => { setAdding(false); setDraftError(""); }}>إلغاء</button>
      {draftError && <small className="field-error">{draftError}</small>}
    </section>}
    {ws.programs.length === 0 ? <Empty title="لا توجد برامج تطوير مهني" action="إضافة برنامج" onAction={() => setAdding(true)}/> : <div className="development-grid">{ws.programs.map(program =>
      <article className="card development-card" key={program.id}>
        <button className="delete-corner" aria-label={`حذف ${program.label}`} onClick={() => remove({ text: "حُذف البرنامج", path: `/pd/${program.id}`,
          apply: () => setWs(current => ({ ...current, programs: current.programs.filter(item => item.id !== program.id) })),
          rollback: () => setWs(current => ({ ...current, programs: ws.programs })) })}><X/></button>
        <LabelText as="h3" label={program.label} save={label => save(program)({ label }, true)}/>
        <label><span>النوع</span><EditableSelect ariaLabel="نوع البرنامج" value={program.kind} options={kinds} save={kind => save(program)({ kind }, true)}/></label>
        <label><span>العدد</span><EditableInput inputMode="numeric" value={program.count} validate={value => (/^\d+$/.test(toWesternDigits(value.trim())) ? null : "القيمة يجب أن تكون رقماً")} save={(value, force) => save(program)({ count: Number(toWesternDigits(value.trim())) }, force)}/></label>
        <label><span>رابط تقارير الدرايف</span><EditableInput dir="ltr" value={program.reportsUrl} validate={validators.url} save={(value, force) => save(program)({ reportsUrl: value.trim() }, force)}/></label>
        <button className="status-toggle" onClick={() => save(program)({ status: program.status === "uploaded" ? "missing" : "uploaded" }, true).catch(error => fail(error))}>
          <StatusPill tone={program.status === "uploaded" ? "accent" : "alert"}>{program.status === "uploaded" ? "التقارير مرفوعة" : "التقارير ناقصة"}</StatusPill>
        </button>
      </article>)}</div>}
  </>;
}
