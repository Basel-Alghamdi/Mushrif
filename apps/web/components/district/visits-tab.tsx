"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../../lib/api";
import { ar, counted, relativeTime } from "../../lib/format";
import type { MemberVisit, Workspace } from "../../lib/types";

const VISITS = { one: "زيارة واحدة", two: "زيارتان", few: "زيارات", many: "زيارة" };

/** Her visit reports, newest first, with the count per school on top. */
export function VisitsTab({ memberId, workspace }: { memberId: string; workspace: Workspace }) {
  const [visits, setVisits] = useState<MemberVisit[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setVisits(await api.get<MemberVisit[]>(`/district/members/${memberId}/visits`));
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    }
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  const bySchool = workspace.schools.filter(school => school.visitCount > 0);

  if (error) {
    return (
      <div className="mp-panel">
        <p className="field-error" role="alert">{error}</p>
        <button className="btn btn-secondary" onClick={() => void load()}><RefreshCw /> إعادة المحاولة</button>
      </div>
    );
  }
  if (!visits) return <div className="mp-panel"><div className="mp-fields"><i className="skeleton mp-skeleton-field" /><i className="skeleton mp-skeleton-field" /></div></div>;
  if (!visits.length) {
    return <div className="mp-panel"><p className="mp-note">لم تُسجَّل زيارات بعد. الزيارات التي تسجّلها من حسابها تظهر هنا.</p></div>;
  }

  return (
    <div className="mp-panel">
      {bySchool.length > 0 && (
        <ul className="mp-visit-schools">
          {bySchool.map(school => <li key={school.id}><b>{school.name}</b><span>{counted(school.visitCount, VISITS)}</span></li>)}
        </ul>
      )}
      <ul className="mp-visits">
        {visits.map(visit => (
          <li key={visit.id} className="mp-visit">
            <header>
              <b>{visit.schoolName} · {visit.type}</b>
              <small>{relativeTime(visit.createdAt)}</small>
            </header>
            {visit.text && <p>{visit.text}</p>}
            {(visit.beneficiaries || visit.sessions || visit.blockers) && (
              <small className="mp-visit-meta">
                {[
                  visit.beneficiaries ? `المستفيدات: ${ar(visit.beneficiaries)}` : "",
                  visit.sessions ? `الجلسات: ${ar(visit.sessions)}` : "",
                  visit.blockers ? `المعوقات: ${visit.blockers}` : "",
                ].filter(Boolean).join("، ")}
              </small>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
