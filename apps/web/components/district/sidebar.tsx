"use client";

import type { Conversation } from "@rasd/schemas";
import { Ellipsis, LogOut, Pencil, Search, SquarePen, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { logout } from "../../lib/api";
import { BrandMark } from "../brand/brand-mark";
import { useChat } from "../../lib/chat/chat-context";
import { groupConversations, initialsOf } from "../../lib/chat/helpers";
import { ConfirmDialog } from "./dialog";
import { useHead } from "./session";
import { useToast } from "./toast";

type SidebarProps = { onNavigate: () => void; onClose: () => void };

export function Sidebar({ onNavigate, onClose }: SidebarProps) {
  const pathname = usePathname();
  const head = useHead();
  const { conversations, conversationsLoaded } = useChat();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim();
    const list = needle ? conversations.filter(item => `${item.title} ${item.preview}`.includes(needle)) : conversations;
    return groupConversations(list);
  }, [conversations, query]);

  const onTeam = pathname.startsWith("/district/team");
  const activeId = pathname.startsWith("/district/c/") ? decodeURIComponent(pathname.split("/")[3] ?? "") : "";

  return (
    <div className="d-side">
      <div className="d-side-top">
        <div className="d-brand">
          <BrandMark className="d-brand-tile" />
          <b>رَصد</b>
        </div>
        <button className="btn btn-ghost btn-icon d-side-close" onClick={onClose} aria-label="إغلاق القائمة"><X /></button>
      </div>

      <Link href="/district" className="btn btn-primary btn-block d-new-chat" onClick={onNavigate}>
        <SquarePen /> محادثة جديدة
      </Link>

      <nav className="d-nav" aria-label="الأقسام">
        <Link href="/district/team" className={`d-nav-item ${onTeam ? "is-active" : ""}`} onClick={onNavigate} aria-current={onTeam ? "page" : undefined}>
          <Users /> الفريق والأرقام
        </Link>
      </nav>

      <label className="d-search">
        <Search aria-hidden />
        <span className="sr-only">ابحثي في المحادثات</span>
        <input type="search" placeholder="ابحثي في المحادثات" value={query} onChange={event => setQuery(event.target.value)} />
      </label>

      <div className="d-conversations">
        {!conversationsLoaded && <div className="d-conv-skeleton"><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></div>}
        {conversationsLoaded && !conversations.length && (
          <p className="d-conv-empty">محادثاتك السابقة ستظهر هنا. ابدئي بسؤال أو ارفعي ملفاً.</p>
        )}
        {conversationsLoaded && conversations.length > 0 && !groups.length && <p className="d-conv-empty">لا توجد محادثة بهذا الاسم.</p>}
        {groups.map(group => (
          <section key={group.label} className="d-conv-group">
            <h3>{group.label}</h3>
            <ul>
              {group.items.map(item => (
                <ConversationItem key={item.id} conversation={item} active={item.id === activeId} onNavigate={onNavigate} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="d-side-foot">
        <span className="avatar avatar-head">{initialsOf(head.name)}</span>
        <div className="d-side-user">
          <b>{head.name}</b>
          <small>{head.title || "رئيسة النطاق"}</small>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={() => void logout()} aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut /></button>
      </footer>
    </div>
  );
}

type ItemProps = { conversation: Conversation; active: boolean; onNavigate: () => void };

function ConversationItem({ conversation, active, onNavigate }: ItemProps) {
  const router = useRouter();
  const toast = useToast();
  const { rename, remove } = useChat();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const root = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const startRename = () => { setDraft(conversation.title); setEditing(true); setMenuOpen(false); };

  // Enter and the blur that follows it both end editing; only the first one saves.
  const saveRename = () => {
    if (!editing) return;
    setEditing(false);
    if (draft.trim() && draft.trim() !== conversation.title) {
      rename(conversation.id, draft).catch((error: Error) => toast(error.message));
    }
  };

  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); saveRename(); }
    if (event.key === "Escape") { event.stopPropagation(); setEditing(false); }
  };

  const confirmDelete = async () => {
    await remove(conversation.id);
    if (active) router.replace("/district");
    toast("حُذفت المحادثة");
  };

  return (
    <li ref={root} className={`d-conv ${active ? "is-active" : ""} ${menuOpen ? "is-menu-open" : ""}`}>
      {editing ? (
        <input
          className="d-conv-rename"
          value={draft}
          autoFocus
          aria-label="اسم المحادثة"
          onChange={event => setDraft(event.target.value)}
          onBlur={saveRename}
          onKeyDown={onRenameKey}
          onFocus={event => event.currentTarget.select()}
        />
      ) : (
        <Link href={`/district/c/${conversation.id}`} className="d-conv-link" onClick={onNavigate} aria-current={active ? "page" : undefined} title={conversation.title}>
          {conversation.title}
        </Link>
      )}
      {!editing && (
        <button className="d-conv-more" onClick={() => setMenuOpen(open => !open)} aria-label={`خيارات المحادثة: ${conversation.title}`} aria-expanded={menuOpen}>
          <Ellipsis />
        </button>
      )}
      {menuOpen && (
        <div className="d-menu" role="menu">
          <button role="menuitem" onClick={startRename}><Pencil /> إعادة تسمية</button>
          <button role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); setConfirming(true); }}><Trash2 /> حذف</button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="حذف المحادثة؟"
          description={<>ستُحذف محادثة «{conversation.title}» من القائمة. البيانات التي عُبّئت في ملفات المشرفات تبقى كما هي.</>}
          confirmLabel="حذف"
          danger
          onConfirm={confirmDelete}
          onClose={() => setConfirming(false)}
        />
      )}
    </li>
  );
}
