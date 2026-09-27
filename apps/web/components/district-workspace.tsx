"use client";

import { ar } from "@rasd/i18n";
import { Check, Clipboard, Copy, Download, FileDown, LoaderCircle, Mail, Plus, Printer, RefreshCw, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, errorText, redirectIfSignedOut } from "../lib/api";
import type { Invitation, MemberSummary, Submission, TimelineEntry, Workspace } from "../lib/types";
import { useToast } from "./member/context";
import { formatTime, PageTitle, PlatformShell, Progress, SectionTitle, StatusPill } from "./platform-shell";

type Team = { members: MemberSummary[]; invitations: Invitation[] };
type Overview = { kpis: { members: number; submitted: number; late: number; absenceDone: number; schools: number; discipline: number | null; visits: number }; tierSplit: { tier: string; count: number }[]; weekBars: { date: string; count: number }[] };
type Notify = (text: string) => void;

const submissionLabel: Record<Submission, string> = { submitted: "أرسلت اليوم", late: "أرسلت متأخرة", missing: "لم ترسل" };
const submissionTone: Record<Submission, "accent" | "warning" | "alert"> = { submitted: "accent", late: "warning", missing: "alert" };

export function DistrictWorkspace() {
  const [view, setView] = useState("dashboard");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team>({ members: [], invitations: [] });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const { notify, view: toastView } = useToast();

  const load = useCallback(async () => {
    try {
      const [nextTeam, nextOverview] = await Promise.all([api<Team>("/district/team"), api<Overview>("/district/overview")]);
      setTeam(nextTeam); setOverview(nextOverview); setLoadError("");
    } catch (error) { if (!redirectIfSignedOut(error)) setLoadError(errorText(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    const visible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);

  const navigate = (key: string) => { setView(key); setProfileId(null); };
  const openProfile = (id: string) => { setView("members"); setProfileId(id); };
  const missing = team.members.filter(member => member.submission === "missing").length;
  const nav = [
    { key: "dashboard", label: "لوحة النطاق", badge: missing ? ar(missing) : undefined },
    { key: "members", label: "أعضاء الفريق", badge: team.members.length ? ar(team.members.length) : undefined },
    { key: "assistant", label: "المساعد الذكي" },
    { key: "report", label: "التقرير المجمّع" },
  ];
  const pending = team.invitations.filter(item => item.status === "pending").length;
  const footer = <div className="district-ai-side"><span>حالة الفريق</span><p>{team.members.length ? `${ar(team.members.length)} عضوات فعّلن حساباتهن، و${ar(pending)} دعوات بانتظار القبول. لم ترسل ${ar(missing)} تحديث اليوم.` : "لم تنضم أي عضوة بعد. ابدئي بإرسال الدعوات."}</p><button onClick={() => navigate("members")}>إدارة الدعوات <Mail/></button></div>;
  const searchItems = team.members.map(member => ({ id: member.id, title: member.name, meta: `${member.clusterLabel || "بدون عنقود"} · اكتمال ${ar(member.completion)}٪`, target: `member:${member.id}` }));
  const onNavigate = (key: string) => (key.startsWith("member:") ? openProfile(key.slice(7)) : navigate(key));

  return <PlatformShell role="head" nav={nav} active={view} onNavigate={onNavigate} asideFooter={footer} searchItems={searchItems}>
    {toastView}
    {loadError && <div className="field-alert"><span>تعذّر تحديث بيانات الفريق</span><p>{loadError}</p><button className="text-button" onClick={load}>إعادة المحاولة</button></div>}
    {loading ? <div className="workspace-loading"><LoaderCircle className="spin"/> جاري تحميل الفريق…</div>
      : profileId ? <MemberProfile memberId={profileId} back={() => setProfileId(null)} notify={notify}/>
      : <>
        {view === "dashboard" && <Dashboard team={team} overview={overview} go={navigate} openProfile={openProfile} notify={notify}/>}
        {view === "members" && <Members team={team} openProfile={openProfile} refresh={load}/>}
        {view === "assistant" && <Assistant notify={notify}/>}
        {view === "report" && <Report notify={notify}/>}
      </>}
  </PlatformShell>;
}

// ───────────────────────── لوحة النطاق (A + B) ─────────────────────────
function Dashboard({ team, overview, go, openProfile, notify }: { team: Team; overview: Overview | null; go: (key: string) => void; openProfile: (id: string) => void; notify: Notify }) {
  const kpis = overview?.kpis;
  const cards = kpis ? [
    ["حدّثن اليوم", `${ar(kpis.submitted)} / ${ar(kpis.members)}`, kpis.late ? `${ar(kpis.late)} بعد الموعد` : "من الحسابات المفعّلة"],
    ["تثبيت الغياب", `${ar(kpis.absenceDone)} / ${ar(kpis.schools)}`, "مدارس ثُبّت غيابها اليوم"],
    ["متوسط الانضباط", kpis.discipline === null ? "—" : `${ar(kpis.discipline)}٪`, "اليومي، من ملفات العضوات"],
    ["تقارير الزيارات", ar(kpis.visits), "تُحسب من التقارير المرفوعة"],
  ] : [];
  const weekMax = Math.max(1, ...(overview?.weekBars.map(bar => bar.count) ?? [1]));
  const tierTotal = Math.max(1, overview?.tierSplit.reduce((sum, item) => sum + item.count, 0) ?? 1);
  return <div className="page-stack">
    <PageTitle title="لوحة النطاق" description="تعتمد هذه الأرقام فقط على العضوات المدعوات والبيانات التي أدخلنها." actions={<><button className="secondary-button" onClick={() => go("members")}><Plus/>دعوة عضوة</button><button className="secondary-button" onClick={() => go("report")}>التقرير المجمّع</button></>}/>
    <section className="workspace-section">
      <div className="kpi-grid">{cards.map(([label, value, note]) => <article className="card kpi" key={label}><span>{label}</span><b>{value}</b><small>{note}</small></article>)}</div>
      <div className="dashboard-panels">
        <section className="card"><h3>الإرسال خلال الأسبوع</h3>{overview?.weekBars.length ? <div className="week-chart">{overview.weekBars.map(bar => <div key={bar.date}><b>{ar(bar.count)}</b><i className={bar.date === overview.weekBars.at(-1)?.date ? "current" : ""} style={{ height: `${(bar.count / weekMax) * 128}px` }}/><span>{new Intl.DateTimeFormat("ar-SA", { weekday: "short" }).format(new Date(`${bar.date}T12:00:00`))}</span></div>)}</div> : <p>لا توجد إرسالات هذا الأسبوع بعد.</p>}</section>
        <section className="card"><h3>توزيع المدارس حسب التصنيف</h3>{overview?.tierSplit.map(item => <div className="tier-breakdown" key={item.tier}><div><span>{item.tier}</span><b>{ar(item.count)}</b></div><Progress value={(item.count / tierTotal) * 100}/></div>)}</section>
      </div>
      <section className="card"><div className="card-title-row"><div><h3>أداء العناقيد</h3><p>تُقرأ مباشرة من ملفات الحسابات المفعّلة</p></div><button className="text-button" onClick={() => go("members")}>كل العضوات</button></div>
        {team.members.length ? <div className="table-card embedded"><table><thead><tr><th>عضوة الفريق</th><th>العنقود</th><th>المدارس</th><th>الغياب</th><th>الزيارات</th><th>اكتمال الملف</th><th>آخر نشاط</th><th>الحالة</th></tr></thead>
          <tbody>{team.members.map(member => <tr key={member.id} onClick={() => openProfile(member.id)} tabIndex={0} onKeyDown={event => { if (event.key === "Enter") openProfile(member.id); }}>
            <td><span className="member-cell"><i className="avatar">{member.initials}</i><b>{member.name}</b></span></td><td>{member.clusterLabel || "—"}</td><td>{ar(member.schoolCount)}</td>
            <td className={member.absence < member.schoolCount ? "attention-text" : ""}>{ar(member.absence)} / {ar(member.schoolCount)}</td><td>{ar(member.visits)}</td>
            <td className={member.completion < 75 ? "attention-text" : ""}>{ar(member.completion)}٪</td><td>{formatTime(member.lastActivityAt)}</td>
            <td><StatusPill tone={submissionTone[member.submission]}>{submissionLabel[member.submission]}</StatusPill></td>
          </tr>)}</tbody></table></div> : <EmptyTeam go={() => go("members")}/>}
      </section>
    </section>
    <SubmissionBoard team={team} notify={notify}/>
    <ImportIndicators notify={notify}/>
  </div>;
}

function SubmissionBoard({ team, notify }: { team: Team; notify: Notify }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("يرجى استكمال تحديث اليوم وإرساله.");
  const [sending, setSending] = useState(false);
  const counts = { submitted: 0, late: 0, missing: 0 } as Record<Submission, number>;
  for (const member of team.members) counts[member.submission] += 1;
  const toggle = (id: string) => setSelected(items => (items.includes(id) ? items.filter(item => item !== id) : [...items, id]));
  const send = async (ids: string[]) => {
    if (!ids.length) return;
    setSending(true);
    try { const result = await api<{ sent: number }>("/district/reminders", { method: "POST", body: { memberIds: ids, body: message } }); notify(`أُرسل ${ar(result.sent)} تذكيرات`); setSelected([]); }
    catch (error) { notify(errorText(error)); } finally { setSending(false); }
  };
  const missingIds = team.members.filter(member => member.submission === "missing").map(member => member.id);
  return <section className="workspace-section">
    <SectionTitle title="متابعة الإرسال" description="اختاري العضوات لإرسال تذكير، أو ذكّري كل من لم ترسل." actions={<>
      <button className="secondary-button" disabled={!selected.length || sending} onClick={() => send(selected)}><Send/>تذكير المحددات ({ar(selected.length)})</button>
      <button className="primary-button" disabled={!missingIds.length || sending} onClick={() => send(missingIds)}>{sending ? <LoaderCircle className="spin"/> : <Send/>}إرسال تذكير للباقيات</button>
    </>}/>
    <div className="count-grid"><article><b>{ar(counts.submitted)}</b><span>أرسلن في الموعد</span></article><article><b className="warning-text">{ar(counts.late)}</b><span>بعد الموعد</span></article><article><b className="attention-text">{ar(counts.missing)}</b><span>لم يرسلن</span></article></div>
    <label className="reminder-body"><span>نص التذكير</span><textarea maxLength={1000} value={message} onChange={event => setMessage(event.target.value)}/></label>
    {team.members.length ? <div className="member-status-grid">{team.members.map(member => <button key={member.id} aria-pressed={selected.includes(member.id)} className={`${member.submission === "missing" ? "missing" : ""} ${selected.includes(member.id) ? "selected" : ""}`} onClick={() => toggle(member.id)}>
      <i className="avatar">{member.initials}</i><b>{member.name}</b><span>{submissionLabel[member.submission]}{member.submittedAt ? ` · ${formatTime(member.submittedAt)}` : ""}</span>
    </button>)}</div> : <p>لا توجد عضوات بعد.</p>}
  </section>;
}

function ImportIndicators({ notify }: { notify: Notify }) {
  const run = async (kind: string, file?: File) => {
    if (!file) return;
    try { await api(`/district/imports/${kind}`, { method: "POST", body: { fileName: file.name } }); }
    catch (error) { notify(errorText(error)); }
  };
  return <section className="workspace-section"><SectionTitle title="استيراد مؤشرات النطاق" description="تُملأ منها جداول التقويم والانضباط ومدرستي لدى العضوات (للقراءة فقط)."/>
    <div className="import-grid">{[["nafes", "نافس والتقرير الخارجي"], ["discipline", "الانضباط"], ["madrasati", "مدرستي"]].map(([kind, label]) => <label className="card import-card" key={kind}>
      <Upload/><span><b>{label}</b><small>Excel أو CSV</small></span><input hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => run(kind, event.target.files?.[0])}/><StatusPill>قيد التطوير</StatusPill>
    </label>)}</div>
  </section>;
}

// ───────────────────────── أعضاء الفريق (C) ─────────────────────────
function Members({ team, openProfile, refresh }: { team: Team; openProfile: (id: string) => void; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showInvite, setShowInvite] = useState(team.members.length === 0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ url: string; status: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const filters = [["all", "الكل"], ["complete", "ملف مكتمل"], ["incomplete", "ملف ناقص"], ["lowDiscipline", "انضباط منخفض"]];
  const visible = useMemo(() => team.members.filter(member =>
    (!query || member.name.includes(query) || member.email.includes(query.toLowerCase()) || member.clusterLabel.includes(query)) &&
    (filter === "all" || (filter === "complete" && member.completion >= 85) || (filter === "incomplete" && member.completion < 85) || (filter === "lowDiscipline" && member.discipline !== null && member.discipline < 85))), [team.members, query, filter]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSending(true); setError(""); setFields({}); setResult(null);
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      const data = await api<{ invitation: Invitation; inviteUrl: string }>("/district/invitations", { method: "POST", body: { name: form.get("name"), email: form.get("email"), clusterLabel: form.get("clusterLabel") } });
      setResult({ url: data.inviteUrl, status: data.invitation.deliveryStatus }); formElement.reset(); await refresh();
    } catch (reason) { if (reason instanceof ApiError && reason.fields) setFields(reason.fields); setError(errorText(reason)); } finally { setSending(false); }
  };
  const resend = async (id: string) => {
    setError("");
    try { const data = await api<{ invitation: Invitation; inviteUrl: string }>(`/district/invitations/${id}/resend`, { method: "POST", body: {} }); setResult({ url: data.inviteUrl, status: data.invitation.deliveryStatus }); setShowInvite(true); await refresh(); }
    catch (reason) { setError(errorText(reason)); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm("إلغاء هذه الدعوة؟ لن يعمل رابطها بعد الآن.")) return;
    try { await api(`/district/invitations/${id}`, { method: "DELETE" }); await refresh(); } catch (reason) { setError(errorText(reason)); }
  };
  const copy = async () => { if (!result) return; await navigator.clipboard.writeText(result.url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); };

  return <div className="page-stack">
    <PageTitle title="أعضاء الفريق" description={`${ar(team.members.length)} حسابات مفعّلة · ${ar(team.invitations.length)} دعوات لم تُقبل`} actions={<><input className="page-search" value={query} onChange={event => setQuery(event.target.value)} aria-label="بحث في العضوات" placeholder="ابحثي بالاسم أو البريد…"/><button className="primary-button" onClick={() => setShowInvite(value => !value)}><Plus/>دعوة عضوة</button></>}/>
    {showInvite && <section className="card"><SectionTitle title="إرسال دعوة جديدة" description="ستنشئ العضوة حسابها من الرابط ثم تعبئ ملفها بنفسها."/>
      <form className="invite-form" onSubmit={invite}>
        <label><span>اسم العضوة</span><input name="name" required/>{fields.name && <small className="field-error">{fields.name}</small>}</label>
        <label><span>البريد الوزاري</span><input name="email" type="email" dir="ltr" placeholder="name@moe.gov.sa" required/>{fields.email && <small className="field-error">{fields.email}</small>}</label>
        <label><span>اسم أو رقم العنقود</span><input name="clusterLabel" placeholder="عنقود ٤" required/>{fields.clusterLabel && <small className="field-error">{fields.clusterLabel}</small>}</label>
        <button className="primary-button" disabled={sending}>{sending ? <><LoaderCircle className="spin"/>جاري الإرسال…</> : <><Send/>إرسال الدعوة</>}</button>
      </form>
      {error && !Object.keys(fields).length && <p className="field-error inline">{error}</p>}
      {result && <div className="invitation-result"><b>{result.status === "sent" ? "أُرسلت الدعوة بالبريد بنجاح" : result.status === "failed" ? "تعذّر البريد — الرابط جاهز للمشاركة" : "الرابط جاهز للمشاركة"}</b>
        {result.status !== "sent" && <span>لم تصل الدعوة بالبريد؛ انسخي الرابط وأرسليه للعضوة.</span>}
        <div className="invitation-link"><input readOnly dir="ltr" value={result.url} aria-label="رابط الدعوة"/><button className="secondary-button" type="button" onClick={copy}>{copied ? <><Check/>نُسخ</> : <><Copy/>نسخ الرابط</>}</button></div></div>}
    </section>}
    {team.invitations.length > 0 && <section className="workspace-section"><SectionTitle title="الدعوات المعلّقة" description="لم تُنشئ صاحبات هذه الدعوات حساباتهن بعد."/>
      <div className="pending-invites">{team.invitations.map(item => <article className="pending-invite" key={item.id}>
        <span><b>{item.name}</b><small dir="ltr">{item.email}</small><small>{item.clusterLabel} · {item.status === "expired" ? "انتهت الصلاحية" : `تنتهي ${formatTime(item.expiresAt)}`}</small></span>
        <div className="pending-invite-actions">
          <StatusPill tone={item.status === "expired" ? "alert" : item.deliveryStatus === "sent" ? "accent" : item.deliveryStatus === "failed" ? "alert" : "warning"}>{item.status === "expired" ? "منتهية" : item.deliveryStatus === "sent" ? "أُرسلت بالبريد" : item.deliveryStatus === "failed" ? "تعذّر البريد" : "الرابط جاهز"}</StatusPill>
          <button className="secondary-button" onClick={() => resend(item.id)}><RefreshCw/>إعادة إرسال</button>
          {item.status === "pending" && <button className="danger-button" onClick={() => revoke(item.id)}><Trash2/>إلغاء</button>}
        </div>
      </article>)}</div>
    </section>}
    <section className="workspace-section">
      <div className="filter-chips">{filters.map(([key, label]) => <button className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)} key={key}>{label}</button>)}</div>
      {visible.length ? <div className="members-grid">{visible.map(member => <button key={member.id} onClick={() => openProfile(member.id)}>
        <div><i className="avatar">{member.initials}</i><span><b>{member.name}</b><small>{member.clusterLabel || "بدون عنقود"} · {ar(member.schoolCount)} مدارس</small></span></div>
        <div className="completion-row"><span>اكتمال الملف</span><b>{ar(member.completion)}٪</b></div><Progress value={member.completion}/>
      </button>)}</div> : <div className="empty-state"><Mail/><b>{team.members.length ? "لا توجد عضوات مطابقة" : "لم تنضم أي عضوة بعد"}</b><span>{team.members.length ? "غيّري البحث أو المرشح" : "أرسلي أول دعوة ليظهر الحساب هنا بعد قبولها"}</span></div>}
    </section>
  </div>;
}

// ───────────────────────── ملف العضوة (D) ─────────────────────────
type MemberDetail = { summary: MemberSummary; phone: string; workspace: Workspace };

function MemberProfile({ memberId, back, notify }: { memberId: string; back: () => void; notify: Notify }) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [tab, setTab] = useState("timeline");
  const [contact, setContact] = useState({ email: "", phone: "" });
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextDetail, nextTimeline] = await Promise.all([api<MemberDetail>(`/district/members/${memberId}`), api<TimelineEntry[]>(`/district/members/${memberId}/timeline`)]);
      setDetail(nextDetail); setTimeline(nextTimeline); setContact({ email: nextDetail.summary.email, phone: nextDetail.phone }); setError("");
    } catch (reason) { setError(errorText(reason)); }
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  if (error && !detail) return <div className="page-stack"><button className="back-button" onClick={back}>العودة إلى أعضاء الفريق</button><div className="field-alert"><span>تعذّر فتح ملف العضوة</span><p>{error}</p></div></div>;
  if (!detail) return <div className="workspace-loading"><LoaderCircle className="spin"/> جاري تحميل ملف العضوة…</div>;
  const { summary, workspace } = detail;
  const saveContact = async () => {
    setContactErrors({});
    const changes = { ...(contact.email !== summary.email ? { email: contact.email } : {}), ...(contact.phone !== detail.phone ? { phone: contact.phone } : {}) };
    if (!Object.keys(changes).length) return;
    try { await api(`/district/members/${memberId}/contact`, { method: "PATCH", body: changes }); notify("حُفظت بيانات التواصل"); await load(); }
    catch (reason) { if (reason instanceof ApiError && reason.fields) setContactErrors(reason.fields); else notify(errorText(reason)); }
  };
  const remind = async () => {
    try { await api("/district/reminders", { method: "POST", body: { memberIds: [memberId] } }); notify("أُرسل التذكير"); } catch (reason) { notify(errorText(reason)); }
  };
  const tiles: [string, string, boolean][] = [
    ["اكتمال الملف", `${ar(summary.completion)}٪`, summary.completion < 80],
    ["تثبيت الغياب", `${ar(summary.absence)} / ${ar(summary.schoolCount)}`, summary.absence < summary.schoolCount],
    ["الزيارات", ar(summary.visits), false],
    ["الانضباط", summary.discipline === null ? "—" : `${ar(summary.discipline)}٪`, summary.discipline !== null && summary.discipline < 85],
  ];
  const tabs = [["timeline", "سجل التسليم"], ["sections", "أقسام الملف"], ["schools", "مدارس العنقود"]];
  return <div className="page-stack">
    <div className="page-actions"><button className="back-button" onClick={back}>العودة إلى أعضاء الفريق</button><button className="secondary-button" onClick={load}><RefreshCw/>تحديث البيانات</button><button className="secondary-button" onClick={remind}><Send/>إرسال تذكير</button></div>
    <section className="profile-hero"><i className="avatar head">{summary.initials}</i><div><h1>{summary.name}</h1><p>{summary.clusterLabel || "بدون عنقود"} · {ar(summary.schoolCount)} مدارس · آخر نشاط {formatTime(summary.lastActivityAt)}</p></div><StatusPill tone={submissionTone[summary.submission]}>{submissionLabel[summary.submission]}</StatusPill></section>
    <section className="contact-editor">
      <label><span>البريد الوزاري</span><input dir="ltr" value={contact.email} onChange={event => setContact({ ...contact, email: event.target.value })}/>{contactErrors.email && <small className="field-error">{contactErrors.email}</small>}</label>
      <label><span>رقم الجوال</span><input dir="ltr" inputMode="tel" value={contact.phone} placeholder="05xxxxxxxx" onChange={event => setContact({ ...contact, phone: event.target.value })}/>{contactErrors.phone && <small className="field-error">{contactErrors.phone}</small>}</label>
      <button className="secondary-button" onClick={saveContact}>حفظ بيانات التواصل</button>
    </section>
    <div className="kpi-grid profile-kpis">{tiles.map(([label, value, low]) => <article className="card" key={label}><span>{label}</span><b className={low ? "warning-text" : ""}>{value}</b></article>)}</div>
    <div className="filter-chips">{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === "timeline" && <section className="card">{timeline.length ? timeline.map(entry => <div className="timeline-row" key={entry.id}><i className={entry.flagged ? "alert" : ""}/><span><b>{entry.title}</b><small>{[entry.body, entry.actorName, entry.sourceLabel].filter(Boolean).join(" · ")}</small></span><time>{formatTime(entry.at)}</time></div>) : <p>لا توجد أحداث بعد.</p>}</section>}
    {tab === "sections" && <>
      <section className="card form-grid">{workspace.profile.map(field => <label key={field.id}><span>{field.label}</span><input value={field.value || "—"} readOnly dir={field.key === "email" ? "ltr" : undefined}/></label>)}</section>
      {workspace.sections.map(section => <section className="card" key={section.id}><h3>{section.label}</h3><div className="form-grid">{section.fields.map(field => <label key={field.id}><span>{field.label}</span><input value={field.value || "—"} readOnly/></label>)}</div></section>)}
      <section className="card"><h3>الخطط</h3>{workspace.plans.map(plan => <div className="file-row" key={plan.id}><span>{plan.label}{plan.url && <small dir="ltr"><a href={plan.url} target="_blank" rel="noreferrer">{plan.url}</a></small>}</span><StatusPill tone={plan.status === "uploaded" ? "accent" : "alert"}>{plan.status === "uploaded" ? "مرفوع" : "ناقص"}</StatusPill></div>)}</section>
    </>}
    {tab === "schools" && (workspace.schools.length ? <div className="card table-card"><table><thead><tr><th>المدرسة</th><th>المرحلة</th><th>التصنيف</th><th>الطالبات</th><th>الغياب اليوم</th><th>الزيارات</th><th>الانضباط اليومي</th></tr></thead>
      <tbody>{workspace.schools.map(school => <tr key={school.id}><td>{school.name}</td><td>{school.stage || "—"}</td><td>{school.tier ?? "—"}</td><td>{ar(school.students)}</td><td>{school.absenceToday ? "تم" : <span className="attention-text">لم يتم</span>}</td><td>{ar(school.visitCount)}</td><td>{ar(school.discipline.daily)}٪</td></tr>)}</tbody></table></div>
      : <div className="empty-state"><b>لم تضف العضوة مدارسها بعد</b></div>)}
  </div>;
}

// ───────────────────────── المساعد الذكي (E) ─────────────────────────
type AgentRun = { id: string; action: string; status: string; plan: { step: string; ok: boolean }[]; payload: Record<string, unknown>; resultSummary: string | null };

function Assistant({ notify }: { notify: Notify }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string; source?: string }[]>([{ role: "assistant", text: "أجيب فقط من بيانات الحسابات الفعلية المرتبطة بنطاقك، ومع كل رقم مصدره." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<AgentRun | null>(null);
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setMessages(items => [...items, { role: "user", text }]); setInput(""); setBusy(true);
    try { const answer = await api<{ text: string; citations: unknown[] }>("/ai/chat", { method: "POST", body: { message: text } }); setMessages(items => [...items, { role: "assistant", text: answer.text, source: `${ar(answer.citations.length)} ملفات · الآن` }]); }
    catch (error) { setMessages(items => [...items, { role: "assistant", text: errorText(error) }]); } finally { setBusy(false); }
  };
  const propose = async (action: string) => { try { setRun(await api<AgentRun>("/ai/agent/propose", { method: "POST", body: { action } })); } catch (error) { notify(errorText(error)); } };
  const decide = async (decision: "approve" | "reject") => {
    if (!run) return;
    try { const next = await api<AgentRun>(`/ai/agent/${run.id}/${decision}`, { method: "POST", body: {} }); setRun(next); notify(decision === "approve" ? next.resultSummary ?? "نُفّذ الإجراء" : "رُفض الإجراء"); }
    catch (error) { notify(errorText(error)); }
  };
  const targets = (run?.payload.targets as { name: string }[] | undefined) ?? [];
  const gaps = (run?.payload.gaps as { name: string; completion: number }[] | undefined) ?? [];
  return <div className="page-stack">
    <PageTitle title="المساعد الذكي" description="ملخص من سجلات العضوات الحقيقية. الإجراءات لا تُنفّذ إلا بعد موافقتك."/>
    <div className="filter-chips">{[["remind", "ذكّري المتأخرات"], ["report", "جهّزي التقرير المجمّع"], ["gaps", "راجعي الملفات الناقصة"]].map(([action, label]) => <button key={action} onClick={() => propose(action)}><Sparkles/>{label}</button>)}</div>
    {run && <section className="card agent-plan"><div className="card-title-row"><h3>خطة الوكيل</h3><button className="text-button" aria-label="إغلاق الخطة" onClick={() => setRun(null)}><X/></button></div>
      <ol>{run.plan.map(step => <li key={step.step}><span>{step.ok ? "✓" : "…"}</span>{step.step}</li>)}</ol>
      {targets.length > 0 && <p>المستهدفات: {targets.map(target => target.name).join("، ")}</p>}
      {gaps.length > 0 && <p>{gaps.map(gap => `${gap.name} (${ar(gap.completion)}٪)`).join("، ")}</p>}
      {typeof run.payload.summaryText === "string" && <p>{run.payload.summaryText}</p>}
      {run.status === "proposed" ? <div className="page-actions"><button className="primary-button" onClick={() => decide("approve")}><Check/>موافقة وتنفيذ</button><button className="secondary-button" onClick={() => decide("reject")}>رفض</button></div>
        : <StatusPill tone={run.status === "executed" ? "accent" : "neutral"}>{run.status === "executed" ? run.resultSummary : "مرفوض"}</StatusPill>}
    </section>}
    <div className="chat"><div className="messages" aria-live="polite">{messages.map((message, index) => <div className={`bubble ${message.role}`} key={index}>{message.role === "assistant" && <Sparkles/>}<p style={{ whiteSpace: "pre-line" }}>{message.text}</p>{message.source && <small>المصدر: {message.source}</small>}</div>)}{busy && <div className="bubble assistant"><LoaderCircle className="spin"/></div>}</div>
      <div className="suggestions">{["ملخص اليوم", "من لم تحدّث بياناتها؟", "الملفات الناقصة"].map(item => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div>
      <form className="composer" onSubmit={event => { event.preventDefault(); ask(input); }}><input value={input} onChange={event => setInput(event.target.value)} aria-label="سؤالك" placeholder="مثال: كم ملفاً يحتاج متابعة؟"/><button disabled={busy}>إرسال</button></form>
    </div>
  </div>;
}

// ───────────────────────── التقرير المجمّع (F) ─────────────────────────
type ReportData = { date: string; summaryText: string; stats: { label: string; value: string | number }[]; rows: { memberId: string; name: string; clusterLabel: string; schools: number; completion: number; submission: Submission; customSections: { label: string; fields: { label: string; value: string }[] }[] }[] };

function Report({ notify }: { notify: Notify }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [format, setFormat] = useState<"text" | "excel" | "print">("text");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<ReportData>("/district/report").then(setReport).catch(error => notify(errorText(error))); }, [notify]);
  const generate = async () => {
    if (format === "print") { window.print(); return; }
    setBusy(true);
    try {
      const result = await api<{ content: string }>("/district/report/generate", { method: "POST", body: { format } });
      if (format === "text") { await navigator.clipboard.writeText(result.content); notify("نُسخ الملخص"); }
      else { download(`rasd-report-${report?.date ?? "today"}.csv`, result.content, "text/csv;charset=utf-8"); notify("نُزّل الجدول"); }
    } catch (error) { notify(errorText(error)); } finally { setBusy(false); }
  };
  if (!report) return <div className="workspace-loading"><LoaderCircle className="spin"/> جاري تجهيز التقرير…</div>;
  const sections = report.rows.flatMap(row => row.customSections.map(section => ({ ...section, member: row.name })));
  return <div className="page-stack">
    <PageTitle title="التقرير المجمّع" description="مُنشأ من بيانات الحسابات المفعّلة حالياً."/>
    <div className="report-layout">
      <article className="card document"><div className="document-head"><b>تقرير النطاق</b><span>{report.date}</span></div>
        <h3>الملخص التنفيذي</h3><p>{report.summaryText}</p>
        <h3>الأرقام</h3><div className="report-stats">{report.stats.map(stat => <div key={stat.label}><b>{typeof stat.value === "number" ? ar(stat.value) : stat.value}</b><span>{stat.label}</span></div>)}</div>
        {sections.length > 0 && <><h3>الأقسام المخصصة</h3>{sections.map(section => <p key={`${section.member}-${section.label}`}><b>{section.member} · {section.label}:</b> {section.fields.map(field => `${field.label}: ${field.value || "—"}`).join("، ")}</p>)}</>}
      </article>
      <aside className="card export-card"><h3>خيارات التصدير</h3>
        {([["text", "نص جاهز للنسخ", Clipboard], ["excel", "جدول Excel (CSV)", FileDown], ["print", "طباعة أو حفظ PDF", Printer]] as const).map(([key, label, Icon]) => <button className={format === key ? "active" : ""} aria-pressed={format === key} onClick={() => setFormat(key)} key={key}><Icon/>{label}</button>)}
        <button className="primary-button" onClick={generate} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Download/>}تجهيز التقرير</button>
        <p>يُسجَّل كل تصدير في سجل التدقيق.</p>
      </aside>
    </div>
  </div>;
}

function EmptyTeam({ go }: { go: () => void }) { return <div className="empty-state"><Mail/><b>لا توجد بيانات بعد</b><button className="secondary-button" onClick={go}>دعوة أول عضوة</button></div>; }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
