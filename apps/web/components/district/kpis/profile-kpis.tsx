"use client";

import type { KpiScope, SchoolKpi } from "@rasd/schemas";
import Link from "next/link";
import { useState } from "react";
import { api, errorText } from "../../../lib/api";
import { ar } from "../../../lib/format";
import { useToast } from "../toast";
import { KpiSummary, LevelChip } from "./kpi-view";
import { kpiHeadline } from "./model";

const registerLink = (row: SchoolKpi) => `/district/kpis?q=${encodeURIComponent(row.ministryNo || row.schoolName)}`;

/** One of her schools as the register has it, read-only; changes are made on the register page. */
export function SchoolKpiBlock({ row }: { row: SchoolKpi }) {
  const headline = kpiHeadline(row);
  return (
    <details className="mp-school-more kp-school">
      <summary>
        <span className="kp-school-title">
          <b>مؤشرات الأداء</b>
          {headline && <small>{headline}</small>}
        </span>
      </summary>
      <KpiSummary row={row} />
      <Link href={registerLink(row)} className="d-dialog-link">تعديل في مؤشرات الأداء</Link>
    </details>
  );
}

type BarProps = {
  memberId: string;
  scope: KpiScope;
  onScope: (scope: KpiScope) => void;
  /** Register rows that are hers (the sheet named her) but match none of her schools. */
  unlisted: SchoolKpi[];
};

/** Above her schools: which register rows she sees, and the rows of hers that are not in her list. */
export function MemberKpisBar({ memberId, scope, onScope, unlisted }: BarProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const change = async (next: KpiScope) => {
    onScope(next);
    setBusy(true);
    try {
      await api.put(`/district/members/${memberId}/kpi-scope`, { scope: next });
      toast(next === "district" ? "ستظهر لها مؤشرات كل مدارس النطاق" : "تظهر لها مؤشرات مدارسها فقط");
    } catch (reason) {
      onScope(scope);
      toast(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="kp-profile">
      <label className="kp-check">
        <input type="checkbox" checked={scope === "district"} disabled={busy} onChange={event => void change(event.target.checked ? "district" : "own")} />
        <span>
          تُعرض لها مؤشرات كل مدارس النطاق
          <small>للأخصائية التي تتابع مدارس النطاق كلها؛ وإلا ترى مؤشرات مدارسها فقط.</small>
        </span>
      </label>
      {unlisted.length > 0 && (
        <details className="kp-unlisted">
          <summary>مدارس في السجل لهذه المشرفة وليست في قائمتها: {ar(unlisted.length)}</summary>
          <ul>
            {unlisted.map(row => (
              <li key={row.id}>
                <Link href={registerLink(row)}>{row.schoolName}</Link>
                {row.ministryNo && <small dir="ltr">{row.ministryNo}</small>}
                <LevelChip level={row.overallLevel} score={row.overallScore} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
