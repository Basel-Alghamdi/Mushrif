"use client";

import { KPI_DOMAINS, kpiSupport, type KpiLevel, type SchoolKpi } from "@rasd/schemas";
import { ar } from "../../../lib/format";
import { levelPill, scoreText, supportPill } from "./model";
import "./kpis.css";

/** A level pill in the tier colours, with the score beside the word when given («تقدم ٨٢»). */
export function LevelChip({ level, score }: { level: KpiLevel | null; score?: number | null }) {
  const number = score === undefined || score === null ? "" : scoreText(score);
  if (!level) return number ? <span className="kp-number">{number}</span> : null;
  return <span className={`pill ${levelPill(level)}`}>{level}{number && ` ${number}`}</span>;
}

export function SupportChip({ score }: { score: number | null }) {
  const support = kpiSupport(score);
  return support && score !== null ? <span className={`pill ${supportPill(score)}`}>{support}</span> : null;
}

/** المستوى العام, درجة النواتج and مستوى المتابعة, with the year and evaluation type above them. */
export function KpiHeadline({ row }: { row: SchoolKpi }) {
  return (
    <div className="kp-head">
      {(row.year || row.evaluationType) && (
        <p className="kp-meta">
          {row.year && <span>العام {ar(row.year)}</span>}
          {row.evaluationType && <span>نوع التقويم: {row.evaluationType}</span>}
        </p>
      )}
      <dl className="kp-values">
        <div><dt>المستوى العام</dt><dd><b>{scoreText(row.overallScore)}</b><LevelChip level={row.overallLevel} /></dd></div>
        <div><dt>درجة النواتج</dt><dd><b>{scoreText(row.outcomesScore)}</b><LevelChip level={row.outcomesLevel} /></dd></div>
        <div><dt>مستوى المتابعة</dt><dd><b>{row.followUpLevel || "—"}</b></dd></div>
      </dl>
    </div>
  );
}

/** Each domain's standards with the support they call for; one domain when `domain` is set. Empty domains are left out. */
export function KpiStandards({ row, domain }: { row: SchoolKpi; domain?: string }) {
  const domains = KPI_DOMAINS.filter(item =>
    (!domain || item.key === domain) && item.standards.some(standard => typeof row.standards[standard.key] === "number"));
  if (!domains.length) return <p className="kp-empty-line">لم تُسجّل درجات المعايير{domain ? " في هذا المجال" : ""}.</p>;
  return (
    <div className="kp-domains">
      {domains.map(item => (
        <section key={item.key} className="kp-domain">
          <h4>{item.label}</h4>
          <ul>
            {item.standards.map(standard => {
              const score = row.standards[standard.key] ?? null;
              return (
                <li key={standard.key}>
                  <span>{standard.label}</span>
                  <b>{scoreText(score)}</b>
                  <SupportChip score={score} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One school's register row, read-only (her school page, the head's view of her schools). */
export function KpiSummary({ row }: { row: SchoolKpi }) {
  return (
    <div className="kp-summary">
      <KpiHeadline row={row} />
      <KpiStandards row={row} />
      {row.note && <p className="kp-note">{row.note}</p>}
    </div>
  );
}
