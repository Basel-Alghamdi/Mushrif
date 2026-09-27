"use client";

import { Check, LoaderCircle, Pencil, Plus, Send } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Dispatch, ReactNode, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { ar } from "@rasd/i18n";
import { completionPct } from "@rasd/schemas";
import { api, redirectIfSignedOut } from "../../lib/api";
import type { Workspace } from "../../lib/types";
import { PlatformShell } from "../platform-shell";
import { makeFail, MemberContext, useToast } from "./context";

const builtIn: Record<string, string> = { today: "/cluster/today", file: "/cluster/file", indicators: "/cluster/indicators" };

export function MemberShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ws, setLoaded] = useState<Workspace | null>(null);
  // Updates only apply once the workspace is loaded; children never render before that.
  const setWs: Dispatch<SetStateAction<Workspace>> = useCallback(action => setLoaded(current => current && (typeof action === "function" ? action(current) : action)), []);
  const [loadError, setLoadError] = useState("");
  const [labelMode, setLabelMode] = useState(false);
  const [sending, setSending] = useState(false);
  const { notify, view: toastView } = useToast();

  const reload = useCallback(async () => {
    try { setLoaded(await api<Workspace>("/member/workspace")); setLoadError(""); }
    catch (error) { if (!redirectIfSignedOut(error)) setLoadError((error as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const fail = useMemo(() => makeFail(notify, reload), [notify, reload]);

  const active = pathname.startsWith("/cluster/s/") ? pathname.split("/")[3] : pathname.split("/")[2] ?? "today";
  const navigate = (key: string) => router.push(builtIn[key] ?? `/cluster/s/${key}`);

  if (!ws) {
    return <PlatformShell role="member" nav={[]} active="" onNavigate={navigate}>
      {loadError ? <div className="field-alert"><span>تعذّر تحميل ملفك</span><p>{loadError}</p><button className="text-button" onClick={reload}>إعادة المحاولة</button></div>
        : <div className="workspace-loading"><LoaderCircle className="spin"/> جاري تحميل ملفك…</div>}
    </PlatformShell>;
  }

  const missingAbsence = ws.schools.filter(school => !school.absenceToday).length;
  const missingPlans = ws.plans.filter(plan => plan.status !== "uploaded");
  const completion = completionPct(ws);
  const submitted = Boolean(ws.cluster.submittedToday);
  const nav = [
    { key: "today", label: "اليوم", badge: missingAbsence ? ar(missingAbsence) : undefined },
    { key: "file", label: "ملف العنقود" },
    { key: "indicators", label: "المؤشرات" },
    ...ws.sections.map(section => ({ key: section.id, label: section.label })),
  ];

  const addSection = async () => {
    const id = crypto.randomUUID();
    setWs(current => ({ ...current, sections: [...current.sections, { id, label: "قسم جديد", updatedAt: "", fields: [] }] }));
    router.push(`/cluster/s/${id}`);
    try { await api("/cluster/me/sections", { method: "POST", body: { id, label: "قسم جديد" } }); }
    catch (error) {
      setWs(current => ({ ...current, sections: current.sections.filter(section => section.id !== id) }));
      router.push("/cluster/file");
      fail(error, addSection);
    }
  };
  const submitUpdate = async () => {
    setSending(true);
    try {
      const result = await api<{ submittedAt: string }>("/cluster/me/submit", { method: "POST", body: {} });
      setWs(current => ({ ...current, cluster: { ...current.cluster, submittedToday: result.submittedAt } }));
      notify("أُرسل التحديث لرئيسة النطاق");
    } catch (error) { fail(error, submitUpdate); } finally { setSending(false); }
  };

  const gaps = [
    missingAbsence ? `تثبيت الغياب لـ${ar(missingAbsence)} مدارس` : "",
    missingPlans.length ? `${ar(missingPlans.length)} خطط لم تُرفع` : "",
    ws.schools.length ? "" : "أضيفي مدارس العنقود",
  ].filter(Boolean);
  const footer = <div className="sidebar-footer">
    <button className={`secondary-button full ${labelMode ? "active-control" : ""}`} onClick={() => setLabelMode(value => !value)}>{labelMode ? <><Check/>إنهاء تعديل المسميات</> : <><Pencil/>تعديل مسميات الحقول</>}</button>
    <button className="secondary-button full" onClick={addSection}><Plus/>إضافة قسم جديد</button>
    <div className="gap-card"><b>{gaps.length ? "ناقص عندك" : "لا نواقص اليوم"}</b><span>{gaps.length ? gaps.join(" · ") : "اكتملت مهام اليوم الأساسية"}</span></div>
    <button className="primary-button full" onClick={submitUpdate} disabled={sending}>{sending ? <><LoaderCircle className="spin"/>جاري الإرسال…</> : submitted ? <><Check/>أُرسل اليوم — إعادة الإرسال</> : <><Send/>إرسال التحديث لرئيسة النطاق</>}</button>
  </div>;
  const searchItems = ws.schools.map(school => ({ id: school.id, title: school.name, meta: [school.stage, school.tier].filter(Boolean).join(" · "), target: "file" }));

  return <MemberContext.Provider value={{ ws, setWs, reload, labelMode, notify, fail }}>
    <PlatformShell role="member" nav={nav} active={active} onNavigate={navigate} asideFooter={footer} completion={completion} searchItems={searchItems}>
      {toastView}
      {children}
    </PlatformShell>
  </MemberContext.Provider>;
}
