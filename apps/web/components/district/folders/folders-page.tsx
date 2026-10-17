"use client";

import { schoolsEntry, subfoldersOf, topFolders, type FolderLayout } from "@rasd/schemas";
import { CircleAlert, Folder, FolderSync, Pencil, RefreshCw, School, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText, redirectIfSignedOut } from "../../../lib/api";
import { ar, counted } from "../../../lib/format";
import { FolderEditor } from "./folder-editor";
import { DEFAULT_SIGNATURE, MEMBERS, layoutSignature, type FolderMember } from "./model";
import { SyncDialog } from "./sync-dialog";
import "./folders.css";

type Group = { members: FolderMember[]; layout: FolderLayout; isDefault: boolean };

/** Members whose folders are identical share a card: the biggest groups first, the default folders first among equals. */
function groupByFolders(members: FolderMember[]): Group[] {
  const groups = new Map<string, FolderMember[]>();
  for (const member of members) {
    const signature = layoutSignature(member.layout);
    groups.set(signature, [...(groups.get(signature) ?? []), member]);
  }
  return [...groups]
    .map(([signature, list]) => ({ members: list, layout: list[0].layout, isDefault: signature === DEFAULT_SIGNATURE }))
    .sort((a, b) => b.members.length - a.members.length || Number(b.isDefault) - Number(a.isDefault));
}

/** /district/folders: everyone's ملف الإنجاز folders, grouped by who has the same ones, edited a group at a time. */
export function FoldersPage() {
  const [members, setMembers] = useState<FolderMember[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string[] | null>(null);
  const [syncing, setSyncing] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers((await api.get<{ members: FolderMember[] }>("/district/folders")).members);
      setError("");
    } catch (reason) {
      if (!redirectIfSignedOut(reason)) setError(errorText(reason));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupByFolders(members ?? []), [members]);
  const ids = (group: Group) => group.members.map(member => member.memberId);

  return (
    <div className="d-page fp">
      <header className="fp-head">
        <h1>مجلدات ملف الإنجاز</h1>
        <p>كل بطاقة تجمع مشرفات لهن المجلدات نفسها: عدّلي مجلدات المجموعة مرة واحدة، أو وحّديها مع مجلدات مشرفة أخرى.</p>
      </header>

      {error && !members && (
        <div className="empty">
          <CircleAlert />
          <b>تعذّر تحميل المجلدات</b>
          <span>{error}</span>
          <button className="btn btn-primary" onClick={() => void load()}><RefreshCw /> إعادة المحاولة</button>
        </div>
      )}

      {!members && !error && (
        <div className="fp-groups" aria-label="جارٍ التحميل">{Array.from({ length: 3 }, (_, index) => <i key={index} className="skeleton fp-skeleton" />)}</div>
      )}

      {members && !members.length && (
        <div className="empty">
          <Users />
          <b>لا توجد مشرفات بعد</b>
          <Link href="/district/team" className="btn btn-secondary">الفريق والأرقام</Link>
        </div>
      )}

      {groups.length > 0 && (
        <div className="fp-groups">
          {groups.map(group => (
            <GroupCard key={ids(group).join()} group={group} onEdit={() => setEditing(ids(group))} onSync={() => setSyncing(ids(group))} />
          ))}
        </div>
      )}

      {editing && members && <FolderEditor memberIds={editing} initial={members} onChanged={setMembers} onClose={() => setEditing(null)} />}
      {syncing && members && <SyncDialog members={members} group={syncing} onDone={() => void load()} onClose={() => setSyncing(null)} />}
    </div>
  );
}

function GroupCard({ group, onEdit, onSync }: { group: Group; onEdit: () => void; onSync: () => void }) {
  const { layout, members } = group;
  const entry = schoolsEntry(layout);
  return (
    <article className="card fp-group">
      <header className="fp-group-head">
        <h2>{counted(members.length, MEMBERS)}</h2>
        {group.isDefault && <span className="pill">المجلدات الافتراضية</span>}
      </header>
      <ul className="fp-members">
        {members.map(member => (
          <li key={member.memberId}>
            <Link href={`/district/team/${member.memberId}`}><b>{member.name}</b>{member.title && <small>{member.title}</small>}</Link>
          </li>
        ))}
      </ul>
      <FolderList layout={layout} inSchool={false} />
      {entry ? (
        <details className="fp-school-folders">
          <summary>مجلدات كل مدرسة ({ar(topFolders(layout, true).length)})</summary>
          <FolderList layout={layout} inSchool />
        </details>
      ) : <p className="fe-note">بدون «مدارس المشرفة»، فلا تظهر مجلدات المدارس.</p>}
      <div className="fp-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onEdit}><Pencil aria-hidden /> {members.length > 1 ? "تعديل مجلدات المجموعة" : "تعديل مجلداتها"}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSync}><FolderSync aria-hidden /> توحيد مع مجلدات مشرفة…</button>
      </div>
    </article>
  );
}

/** The folders in order, each with its sub-folders on the same line. */
function FolderList({ layout, inSchool }: { layout: FolderLayout; inSchool: boolean }) {
  return (
    <ol className="fp-folders">
      {topFolders(layout, inSchool).map(folder => {
        const subs = subfoldersOf(layout, folder.key, inSchool);
        const Icon = folder.kind === "schools" ? School : Folder;
        return (
          <li key={folder.key}>
            <Icon aria-hidden />
            <span>{folder.label}{subs.length > 0 && <small> — {subs.map(sub => sub.label).join("، ")}</small>}</span>
          </li>
        );
      })}
    </ol>
  );
}
