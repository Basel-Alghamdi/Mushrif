"use client";

import { ClipboardList, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useMember } from "../../../components/member/context";
import { SEP } from "../../../components/member/model";
import { useSchoolName } from "../../../components/member/today";
import { VisitSheet } from "../../../components/member/visits";
import { ar, relativeTime } from "../../../lib/format";
import type { VisitReport } from "../../../lib/types";

/** Her visits. Files (the plans among them) live in ملفاتي, each in its ملف الإنجاز folder. */
export default function ReportsPage() {
  const { visits } = useMember();
  const schoolName = useSchoolName();
  const [logging, setLogging] = useState(false);
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  const items = [...visits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="m-page m-reports">
      <h1>تقاريري</h1>

      <div className="m-report-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setLogging(true)}><Plus aria-hidden />سجّلي زيارة</button>
        <Link href="/cluster/files" className="btn btn-secondary btn-lg"><FolderOpen aria-hidden />ملفاتي</Link>
      </div>
      <p className="m-hint">الملفات صارت في «ملفاتي»، كل ملف في مجلده من ملف الإنجاز.</p>

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

/** Older visits may also carry counts and blockers (the sheet no longer asks for them). */
function VisitDetails({ visit }: { visit: VisitReport }) {
  const counts = [
    visit.beneficiaries ? `المستفيدات: ${ar(visit.beneficiaries)}` : "",
    visit.sessions ? `الجلسات: ${ar(visit.sessions)}` : "",
  ].filter(Boolean).join(SEP);
  return (
    <div className="m-item-details">
      {visit.text ? <p><span className="m-muted">الهدف: </span>{visit.text}</p> : <p className="m-muted">لم يُكتب الهدف.</p>}
      {counts && <p className="m-muted">{counts}</p>}
      {visit.blockers && <p className="m-muted">المعوقات: {visit.blockers}</p>}
    </div>
  );
}
