"use client";

import { KPI_DOMAINS, type KpiScope, type SchoolKpi } from "@rasd/schemas";
import { ArrowRight, ChartColumn, ChevronLeft, Link2, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../../../lib/api";
import { ar } from "../../../lib/format";
import { KpiHeadline, KpiStandards } from "../../district/kpis/kpi-view";
import { kpiOfSchool, matchesQuery, needOf } from "../../district/kpis/model";
import { useMember } from "../context";
import { SEP } from "../model";

type DistrictKpis = { kpiScope: KpiScope; year: string; years: string[]; rows: SchoolKpi[] };
type Tab = "mine" | "district";

/** مدارسي → مؤشرات الأداء, shown only when the register has something for her (no empty corner otherwise). */
export function KpiEntry() {
  const { kpis, kpiScope } = useMember();
  if (kpiScope !== "district" && !kpis.length) return null;
  return (
    <Link href="/cluster/indicators" className="card m-school-card">
      <span className="kp-entry-icon" aria-hidden><ChartColumn /></span>
      <span className="m-school-main">
        <b>{kpiScope === "district" ? "مؤشرات الأداء لمدارس النطاق" : `مؤشرات الأداء لمدارسك (${ar(kpis.length)})`}</b>
        <span className="m-school-meta">من سجل رئيسة النطاق</span>
      </span>
      <ChevronLeft className="m-chev" aria-hidden />
    </Link>
  );
}

/**
 * «مؤشرات الأداء»: the register رئيسة النطاق keeps, for her schools (already loaded with her file) and, for the
 * specialists who follow the whole district, every school's row — the neediest first, by one domain or overall.
 */
export function MemberKpis() {
  const { kpis, kpiScope } = useMember();
  const wide = kpiScope === "district";
  const [tab, setTab] = useState<Tab>(() => (wide && !kpis.length ? "district" : "mine"));
  const [domain, setDomain] = useState("");
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState<DistrictKpis | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Every school's row (~200) only for her, and once when the page opens — not on every return to the tab.
  useEffect(() => {
    if (!wide) return;
    api.get<DistrictKpis>("/cluster/me/kpis")
      .then(data => { setDistrict(data); setError(""); })
      .catch(reason => setError(errorText(reason)));
  }, [wide, attempt]);

  const source = tab === "district" ? district?.rows ?? [] : kpis;
  const rows = useMemo(
    () => source.filter(row => matchesQuery(row, query)).sort((a, b) => needOf(a, domain) - needOf(b, domain) || 0),
    [source, query, domain],
  );
  const year = (tab === "district" ? district?.year : kpis[0]?.year) ?? "";

  return (
    <div className="m-page">
      <Link href="/cluster/schools" className="m-back"><ArrowRight aria-hidden />مدارسي</Link>
      <header className="m-head">
        <h1>مؤشرات الأداء</h1>
        <p className="m-status">{["من سجل رئيسة النطاق", year && `للعام ${ar(year)}`].filter(Boolean).join(SEP)}</p>
      </header>

      {wide && (
        <div className="m-chips" role="group" aria-label="المدارس">
          <button type="button" aria-pressed={tab === "mine"} className={`m-chip${tab === "mine" ? " is-on" : ""}`} onClick={() => setTab("mine")}>
            مدارسي ({ar(kpis.length)})
          </button>
          <button type="button" aria-pressed={tab === "district"} className={`m-chip${tab === "district" ? " is-on" : ""}`} onClick={() => setTab("district")}>
            كل مدارس النطاق{district && ` (${ar(district.rows.length)})`}
          </button>
        </div>
      )}

      {source.length > 0 && (
        <>
          <div className="m-chips kp-domain-chips" role="group" aria-label="المجال">
            {[{ key: "", label: "المستوى العام" }, ...KPI_DOMAINS].map(item => (
              <button key={item.key} type="button" className={`m-chip${domain === item.key ? " is-on" : ""}`} aria-pressed={domain === item.key} onClick={() => setDomain(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <p className="m-hint">الأحوج إلى الدعم أولاً{domain ? ` في ${KPI_DOMAINS.find(item => item.key === domain)?.label}` : ""}.</p>
          {source.length > 8 && (
            <input type="search" className="input" aria-label="ابحثي عن مدرسة" placeholder="ابحثي باسم المدرسة أو رقمها الوزاري" value={query}
              onChange={event => setQuery(event.target.value)} />
          )}
        </>
      )}

      {tab === "district" && !district && (error
        ? <div className="card kp-member-empty"><p className="m-note">{error}</p><button type="button" className="btn btn-secondary" onClick={() => setAttempt(count => count + 1)}>إعادة المحاولة</button></div>
        : <p className="m-muted"><LoaderCircle className="m-spin" aria-hidden /> جارٍ التحميل…</p>)}

      {tab === "mine" && !kpis.length && (
        <div className="card kp-member-empty">
          <p className="m-lead">لا توجد مؤشرات لمدارسك بعد.</p>
          <p className="m-note">تظهر هنا حين ترفع رئيسة النطاق سجل مؤشرات الأداء. اكتبي الرقم الوزاري لكل مدرسة في مدارسي، فبه تُربط مؤشراتها.</p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="kp-cards">
          {rows.map(row => <KpiCard key={row.id} row={row} domain={domain} hers={tab === "mine"} />)}
        </ul>
      )}
      {source.length > 0 && !rows.length && <p className="m-muted">لا توجد مدرسة بهذا الاسم.</p>}
    </div>
  );
}

function KpiCard({ row, domain, hers }: { row: SchoolKpi; domain: string; hers: boolean }) {
  const { ws } = useMember();
  const school = ws.schools.find(item => kpiOfSchool([row], item));
  return (
    <li className="card kp-card">
      <header className="kp-card-head">
        <b>{row.schoolName}</b>
        <small>{[row.stage, row.ministryNo].filter(Boolean).join(SEP)}</small>
      </header>
      <KpiHeadline row={row} />
      {domain ? <KpiStandards row={row} domain={domain} /> : (
        <details className="kp-more">
          <summary>المعايير</summary>
          <KpiStandards row={row} />
        </details>
      )}
      {row.note && <p className="kp-note">{row.note}</p>}
      {school
        ? <Link href={`/cluster/schools/${school.id}`} className="m-link">فتح {school.name || "المدرسة"}</Link>
        : hers && <AddToMySchools row={row} />}
    </li>
  );
}

/** A row of hers that is none of her schools yet: give one of her schools its ministry number, or add it as a new school. */
function AddToMySchools({ row }: { row: SchoolKpi }) {
  const { ws, kpis, reload, notify, fail } = useMember();
  const [picking, setPicking] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [busy, setBusy] = useState(false);
  // Only schools that no row is linked to yet (linking writes the row's ministry number into the school).
  const free = ws.schools.filter(school => !kpiOfSchool(kpis, school));

  const run = async (request: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await request();
      await reload(); // her schools and her rows, so the row shows under its school
      notify(done);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  if (picking) {
    return (
      <div className="kp-link">
        <label className="field-label" htmlFor={`link-${row.id}`}>أي مدرسة من مدارسك هي؟</label>
        <div className="m-inline">
          <select id={`link-${row.id}`} className="input" value={schoolId} onChange={event => setSchoolId(event.target.value)}>
            <option value="">اختاري المدرسة</option>
            {free.map(school => <option key={school.id} value={school.id}>{school.name || "مدرسة بدون اسم"}</option>)}
          </select>
          <button type="button" className="btn btn-primary" disabled={!schoolId || busy}
            onClick={() => void run(() => api.post(`/cluster/me/kpis/${row.id}/link`, { schoolId }), "رُبطت المؤشرات بمدرستك")}>
            {busy && <LoaderCircle className="m-spin" aria-hidden />}ربط
          </button>
        </div>
        {row.ministryNo && <p className="m-hint">سيُكتب فيها الرقم الوزاري <bdi dir="ltr">{row.ministryNo}</bdi>.</p>}
        <button type="button" className="btn btn-ghost m-cancel" onClick={() => setPicking(false)}>إلغاء</button>
      </div>
    );
  }
  return (
    <div className="kp-link">
      <p className="m-note">هذه المدرسة ليست في مدارسي بعد.</p>
      <div className="m-actions">
        {free.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setPicking(true)}><Link2 aria-hidden />اربطيها بمدرسة من مدارسي</button>}
        <button type="button" className="btn btn-secondary" disabled={busy}
          onClick={() => void run(() => api.post(`/cluster/me/kpis/${row.id}/add-school`), "أُضيفت إلى مدارسي")}>
          {busy ? <LoaderCircle className="m-spin" aria-hidden /> : <Plus aria-hidden />}أضيفيها إلى مدارسي
        </button>
      </div>
    </div>
  );
}
