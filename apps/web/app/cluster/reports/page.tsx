"use client";

import { Check, ClipboardList, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useActions } from "../../../components/member/actions";
import { useMember } from "../../../components/member/context";
import { SEP } from "../../../components/member/model";
import { useSchoolName } from "../../../components/member/today";
import { Expander } from "../../../components/member/ui";
import { VisitSheet } from "../../../components/member/visits";
import { ar, relativeTime } from "../../../lib/format";
import type { VisitReport } from "../../../lib/types";

/** Her visits and plan links. Files live in ملفاتي (ملف الإنجاز folders). */
export default function ReportsPage() {
  const { visits } = useMember();
  const schoolName = useSchoolName();
  const [logging, setLogging] = useState(false);
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  // #plans (from «جهّزي ملفك») opens the plans and brings them into view.
  useEffect(() => {
    if (window.location.hash !== "#plans") return;
    const section = document.getElementById("plans");
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ block: "start" });
  }, []);

  const items = [...visits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="m-page m-reports">
      <h1>تقاريري</h1>

      <div className="m-report-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setLogging(true)}><Plus aria-hidden />سجّلي زيارة</button>
        <Link href="/cluster/files" className="btn btn-secondary btn-lg"><FolderOpen aria-hidden />ملفاتي</Link>
      </div>
      <p className="m-hint">الملفات صارت في «ملفاتي»، كل ملف في مجلده من ملف الإنجاز.</p>

      <Plans />

      {items.length === 0 ? (
        <p className="m-lead">زياراتك تظهر هنا.</p>
      ) : (
        <ul className="card m-items">
          {items.map(visit => (
            <li key={`v-${visit.id}`} className="m-item">
              <button type="button" className="m-item-main" onClick={() => setOpenVisit(id => (id === visit.id ? null : visit.id))}
                aria-expanded={openVisit === visit.id}>
                <span className="m-item-icon is-visit" aria-hidden><ClipboardList /></span>
                <span className="m-item-text">
                  <b>{schoolName(visit)}{SEP}{visit.type}</b>
                  <small>{relativeTime(visit.createdAt)}</small>
                </span>
              </button>
              {openVisit === visit.id && <VisitDetails visit={visit} />}
            </li>
          ))}
        </ul>
      )}

      {logging && <VisitSheet onClose={() => setLogging(false)} />}
    </div>
  );
}

/** main's five plans as link rows (a link marks the plan as uploaded), plus the Nafes card folder. */
function Plans() {
  const { ws } = useMember();
  const { setPlanUrl, setNafesFolder } = useActions();
  const uploaded = ws.plans.filter(plan => plan.status === "uploaded").length;
  return (
    <div className="m-exp-group">
      <Expander id="plans" title={<>روابط الخطط <span className="m-count">({ar(uploaded)} من {ar(ws.plans.length)})</span></>}>
        {ws.plans.map(plan => (
          <div className="field" key={plan.id}>
            <label className="field-label m-plan-label" htmlFor={`plan-${plan.id}`}>
              {plan.label}
              {plan.status === "uploaded" && <span className="m-plan-done"><Check aria-hidden />مرفوعة</span>}
            </label>
            <input id={`plan-${plan.id}`} className="input" type="url" inputMode="url" dir="ltr" value={plan.url} placeholder="الصقي رابط الملف"
              onChange={event => setPlanUrl(plan, event.target.value)} />
          </div>
        ))}
        <div className="field">
          <label className="field-label" htmlFor="nafes-folder">مجلد بطاقة نافس <span className="m-optional">(اختياري)</span></label>
          <input id="nafes-folder" className="input" type="url" inputMode="url" dir="ltr" value={ws.cluster.nafesCardFolderUrl} placeholder="الصقي رابط المجلد"
            onChange={event => setNafesFolder(event.target.value)} />
        </div>
      </Expander>
    </div>
  );
}

function VisitDetails({ visit }: { visit: VisitReport }) {
  const counts = [
    visit.beneficiaries ? `المستفيدات: ${ar(visit.beneficiaries)}` : "",
    visit.sessions ? `الجلسات: ${ar(visit.sessions)}` : "",
  ].filter(Boolean).join(SEP);
  return (
    <div className="m-item-details">
      {visit.text ? <p>{visit.text}</p> : <p className="m-muted">لا يوجد وصف.</p>}
      {counts && <p className="m-muted">{counts}</p>}
      {visit.blockers && <p className="m-muted">المعوقات: {visit.blockers}</p>}
    </div>
  );
}
