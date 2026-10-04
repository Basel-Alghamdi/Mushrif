"use client";

import { CircleAlert, MailOpen, RefreshCw, Search, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, errorText, redirectIfSignedOut } from "../../lib/api";
import { initialsOf } from "../../lib/chat/helpers";
import { ar, pct, relativeTime } from "../../lib/format";
import type { Invitation, MemberSummary } from "../../lib/types";
import { AddMemberDialog } from "./add-member-dialog";

type Filter = "all" | "inactive" | "incomplete";
type Team = { members: MemberSummary[]; invitations: Invitation[] };

// Same threshold as main's district filter: a file counts as complete from 85% (today's absence keeps 100% rare).
const COMPLETE_FROM = 85;

const FILTERS: { id: Filter; label: string; test: (member: MemberSummary) => boolean }[] = [
  { id: "all", label: "الكل", test: () => true },
  { id: "inactive", label: "لم تفعّل", test: member => !member.activated },
  { id: "incomplete", label: "ملف ناقص", test: member => member.completion < COMPLETE_FROM },
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
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState("");
  // Coming back from a profile keeps the filter and the search she was using (this tab only).
  const [view] = useState(readView);
  const [query, setQuery] = useState(view?.query ?? "");
  const [searching, setSearching] = useState(() => Boolean(view?.query) && typeof window !== "undefined" && window.matchMedia(PHONE).matches);
  const [filter, setFilter] = useState<Filter>(view?.filter ?? "all");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setTeam(await api.get<Team>("/district/team"));
      setError("");
    } catch (reason) {
      if (!redirectIfSignedOut(reason)) setError(errorText(reason));
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
          <KpiRow members={members} />

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

          {team.invitations.length > 0 && <Invitations items={team.invitations} />}
        </>
      )}

      {adding && <AddMemberDialog clusters={clusters} onClose={() => setAdding(false)} onCreated={() => void load()} />}
    </div>
  );
}

/** Three numbers computed from the team list: activated accounts, average completion, updated today. */
function KpiRow({ members }: { members: MemberSummary[] }) {
  const activated = members.filter(member => member.activated).length;
  const average = members.length ? members.reduce((sum, member) => sum + member.completion, 0) / members.length : 0;
  const updated = members.filter(member => member.submission !== "missing").length;
  return (
    <section className="d-kpis" aria-label="أرقام الفريق">
      <div className={`d-kpi ${activated < members.length ? "tone-warn" : "tone-ok"}`}><span>فعّلن</span><b>{ar(activated)}/{ar(members.length)}</b></div>
      <div className="d-kpi"><span>متوسط الاكتمال</span><b>{pct(average)}</b></div>
      <div className="d-kpi"><span>حدّثن اليوم</span><b>{ar(updated)}</b></div>
    </section>
  );
}

/**
 * One status by priority: لم تفعّل الحساب > حدّثت اليوم > ملف ناقص > مكتمل ✓. Today's activity comes before «ملف ناقص»:
 * main's completion also counts plans, every school field and today's absence, so almost every file stays «ناقص»
 * and «حدّثت اليوم» would otherwise never show (the % beside it already tells how complete she is).
 */
function memberStatus(member: MemberSummary) {
  if (!member.activated) return { text: "لم تفعّل الحساب", tone: "pill-warn" };
  if (member.submission !== "missing") return { text: "حدّثت اليوم", tone: "pill-ok" };
  if (member.completion < COMPLETE_FROM) return { text: "ملف ناقص", tone: "" };
  return { text: "مكتمل ✓", tone: "pill-ok" };
}

function MemberRow({ member }: { member: MemberSummary }) {
  const status = memberStatus(member);
  const lastSeen = member.lastActivityAt ?? member.lastSignInAt;
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

/** main's pending invitations (the older way in), listed compactly under the team. */
function Invitations({ items }: { items: Invitation[] }) {
  return (
    <details className="d-invitations">
      <summary><MailOpen aria-hidden /> دعوات لم تُقبل بعد ({ar(items.length)})</summary>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <span className="d-member-id">
              <b>{item.name}</b>
              <small dir="ltr">{item.email}</small>
            </span>
            <span className={`pill ${item.status === "expired" ? "pill-bad" : ""}`}>{item.status === "expired" ? "انتهت صلاحيتها" : `أُرسلت ${relativeTime(item.createdAt)}`}</span>
          </li>
        ))}
      </ul>
    </details>
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
