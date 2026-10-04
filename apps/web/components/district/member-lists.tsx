import type { Visit } from "@rasd/schemas";
import { ar, relativeTime } from "../../lib/format";

export function VisitsTab({ visits }: { visits: Visit[] }) {
  if (!visits.length) {
    return <div className="mp-panel"><p className="mp-note">لم تُسجَّل زيارات بعد. الزيارات التي تسجّلها من حسابها تظهر هنا.</p></div>;
  }
  return (
    <div className="mp-panel">
      <ul className="mp-visits">
        {visits.map(visit => (
          <li key={visit.id} className="mp-visit">
            <header>
              <b>{visit.schoolName || "زيارة"}{visit.type && <span className="muted"> · {visit.type}</span>}</b>
              <small>{relativeTime(visit.createdAt)}</small>
            </header>
            {visit.text && <p>{visit.text}</p>}
            {(visit.beneficiaries > 0 || visit.sessions > 0 || visit.blockers) && (
              <small className="mp-visit-meta">
                {[
                  visit.beneficiaries > 0 && `المستفيدات: ${ar(visit.beneficiaries)}`,
                  visit.sessions > 0 && `الجلسات: ${ar(visit.sessions)}`,
                  visit.blockers && `المعوقات: ${visit.blockers}`,
                ].filter(Boolean).join(" · ")}
              </small>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
