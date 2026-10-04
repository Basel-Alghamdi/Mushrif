"use client";

import type { MemberSummary, TeamResponse, TeamStats } from "@rasd/schemas";
import { CircleAlert, RefreshCw, Search, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "../../lib/api";
import { initialsOf } from "../../lib/chat/helpers";
import { ar, pct, relativeTime } from "../../lib/format";
import { AddMemberDialog } from "./add-member-dialog";

type Filter = "all" | "inactive" | "incomplete";

const FILTERS: { id: Filter; label: string; test: (member: MemberSummary) => boolean }[] = [
  { id: "all", label: "الكل", test: () => true },
  { id: "inactive", label: "لم تفعّل", test: member => !member.activated },
  { id: "incomplete", label: "ملف ناقص", test: member => member.missing.length > 0 },
];

const REFRESH_MS = 20_000;
const PHONE = "(max-width: 899.98px)";
const VIEW_KEY = "rasd:team-view";

function readView(): { filter: Filter; query: string } | null {
  try {
    const view = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as { filter?: string; query?: string } | null;
    if (!view) return null;
    const filter = FILTERS.find(item => item.id === view.filter)?.id ?? "all";
    return { filter, query: typeof view.query === "string" ? view.query : "" };
  } catch {
    return null;
  }
}

export function TeamPage() {
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [error, setError] = useState("");
  // Coming back from a profile keeps the filter and the search she was using (this tab only).
  const [view] = useState(readView);
  const [query, setQuery] = useState(view?.query ?? "");
  const [searching, setSearching] = useState(() => Boolean(view?.query) && typeof window !== "undefined" && window.matchMedia(PHONE).matches);
  const [filter, setFilter] = useState<Filter>(view?.filter ?? "all");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setTeam(await api.get<TeamResponse>("/district/team"));
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  // Refresh every 20s while the page is visible, and right away when she comes back to the tab.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ filter, query })); } catch { /* private mode: nothing to remember */ }
  }, [filter, query]);

  const members = team?.members ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // On phones the chips are hidden while searching, so the search covers everyone.
    const test = searching ? () => true : FILTERS.find(item => item.id === filter)!.test;
    return members.filter(member => test(member) && (!needle || `${member.name} ${member.email} ${member.title}`.toLowerCase().includes(needle)));
  }, [members, query, filter, searching]);
  const clusters = useMemo(() => [...new Set(members.map(member => member.clusterLabel).filter(Boolean))], [members]);

  const searchInput = useRef<HTMLInputElement>(null);
  const closeSearch = () => { setSearching(false); setQuery(""); };
  // Focus inside the tap itself so phones open the keyboard.
  const openSearch = () => { flushSync(() => setSearching(true)); searchInput.current?.focus(); };

  return (
    <div className="d-page d-team">
      {/* Desktop only: on phones the topbar already names the page. */}
      <header className="d-page-head d-team-head">
        <h1>الفريق والأرقام</h1>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><UserPlus /> إضافة مشرفة</button>
      </header>

      {error && !team && (
        <div className="empty">
          <CircleAlert />
          <b>تعذّر تحميل الفريق</b>
          <span>{error}</span>
          <button className="btn btn-primary" onClick={() => void load()}><RefreshCw /> إعادة المحاولة</button>
        </div>
      )}

      {!team && !error && <TeamSkeleton />}

      {team && (
        <>
          <KpiRow stats={team.stats} />

          <div className={`d-team-tools ${searching ? "is-searching" : ""}`}>
            <div className="d-filter-chips" role="group" aria-label="تصفية">
              {FILTERS.map(item => (
                <button key={item.id} className={`chip ${filter === item.id ? "is-active" : ""}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <label className="d-search d-team-search">
              <Search aria-hidden />
              <span className="sr-only">ابحثي عن مشرفة</span>
              <input type="search" placeholder="ابحثي بالاسم" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") closeSearch(); }} ref={searchInput} />
              <button type="button" className="d-team-search-close" onClick={closeSearch} aria-label="إغلاق البحث"><X /></button>
            </label>
            <button className="btn btn-ghost btn-icon d-team-search-open" onClick={openSearch} aria-label="بحث عن مشرفة"><Search /></button>
          </div>

          {visible.length ? (
            <ul className="d-member-list">
              {visible.map(member => <li key={member.id}><MemberRow member={member} /></li>)}
            </ul>
          ) : (
            <div className="empty">
              <Users />
              <b>{members.length ? "لا توجد مشرفة بهذا الوصف" : "لا توجد مشرفات بعد"}</b>
              {members.length > 0 && <button className="btn btn-secondary" onClick={() => { closeSearch(); setFilter("all"); }}>عرض الكل</button>}
            </div>
          )}

          <button className="btn btn-add btn-block d-team-add" onClick={() => setAdding(true)}><UserPlus /> إضافة مشرفة</button>
        </>
      )}

      {adding && <AddMemberDialog clusters={clusters} onClose={() => setAdding(false)} onCreated={() => void load()} />}
    </div>
  );
}

function KpiRow({ stats }: { stats: TeamStats }) {
  return (
    <section className="d-kpis" aria-label="أرقام الفريق">
      <div className={`d-kpi ${stats.notActivated ? "tone-warn" : "tone-ok"}`}><span>فعّلن</span><b>{ar(stats.activated)}/{ar(stats.members)}</b></div>
      <div className="d-kpi"><span>متوسط الاكتمال</span><b>{pct(stats.averageCompletion)}</b></div>
      <div className="d-kpi"><span>حدّثن اليوم</span><b>{ar(stats.submittedToday)}</b></div>
    </section>
  );
}

/** One status by priority: لم تفعّل الحساب > ينقصها n > حدّثت اليوم / مكتمل ✓. */
function memberStatus(member: MemberSummary) {
  if (!member.activated) return { text: "لم تفعّل الحساب", tone: "pill-warn" };
  if (member.missing.length) return { text: `ينقصها ${ar(member.missing.length)}`, tone: "" };
  if (member.submittedToday) return { text: "حدّثت اليوم", tone: "pill-ok" };
  return { text: "مكتمل ✓", tone: "pill-ok" };
}

function MemberRow({ member }: { member: MemberSummary }) {
  const status = memberStatus(member);
  const lastSeen = member.lastActivityAt ?? member.lastLoginAt;
  return (
    <Link href={`/district/team/${member.id}`} className="d-member-row">
      <span className="avatar">{member.initials || initialsOf(member.name)}</span>
      <span className="d-member-id">
        <b>{member.name}</b>
        <small>{member.title || "—"}</small>
      </span>
      <small className="d-member-seen">{lastSeen ? `آخر نشاط ${relativeTime(lastSeen)}` : "لم تدخل بعد"}</small>
      <span className="d-member-state">
        <b>{pct(member.completion)}</b>
        <span className={`pill ${status.tone}`}>{status.text}</span>
      </span>
    </Link>
  );
}

function TeamSkeleton() {
  return (
    <div className="d-team-skeleton" aria-label="جارٍ التحميل">
      <div className="d-kpis">{Array.from({ length: 3 }, (_, index) => <i key={index} className="skeleton d-kpi-skeleton" />)}</div>
      <div className="d-member-list">{Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton d-row-skeleton" />)}</div>
    </div>
  );
}
