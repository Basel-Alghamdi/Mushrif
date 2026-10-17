"use client";

import { FolderSync } from "lucide-react";
import { useState } from "react";
import { api, errorText, redirectIfSignedOut } from "../../../lib/api";
import { ar, counted } from "../../../lib/format";
import { Dialog } from "../dialog";
import { useToast } from "../toast";
import { FILES, MEMBERS, type FolderMember, type SyncChange, type SyncResult } from "./model";

type Props = {
  members: FolderMember[];
  /** The group the card shows: whose folders become the chosen member's. */
  group: string[];
  onDone: () => void;
  onClose: () => void;
};

const changed = (item: SyncChange) => item.added.length + item.renamed.length + item.removed.length + item.restored.length > 0;

/** «يُضاف ١ · تُعاد تسمية ١ · يُحذف ١ وفيه ٤ ملفات». */
function changeLine(item: SyncChange) {
  const removed = item.removed.length
    ? `يُحذف ${ar(item.removed.length)}${item.filesToUnsorted ? ` و${item.removed.length === 1 ? "فيه" : "فيها"} ${counted(item.filesToUnsorted, FILES)}` : ""}`
    : "";
  const parts = [
    item.added.length ? `يُضاف ${ar(item.added.length)}` : "",
    item.renamed.length ? `تُعاد تسمية ${ar(item.renamed.length)}` : "",
    item.restored.length ? `يُستعاد ${ar(item.restored.length)}` : "",
    removed,
  ];
  return parts.filter(Boolean).join(" · ") || "لا تغيير";
}

/** The folder names behind the counts: «يُضاف: …  · يُحذف: …». */
function changeNames(item: SyncChange) {
  const lists: [string, string[]][] = [["يُضاف", item.added], ["تُعاد تسمية", item.renamed], ["يُستعاد", item.restored], ["يُحذف", item.removed]];
  return lists.filter(([, labels]) => labels.length).map(([verb, labels]) => `${verb}: ${labels.join("، ")}`).join(" · ");
}

/**
 * «توحيد مع مجلدات مشرفة…» (POST /district/folders/sync): the chosen members end up with exactly another member's folders
 * (hers and each school's). A dry run first shows what changes for each of them; nothing is saved until she confirms.
 */
export function SyncDialog({ members, group, onDone, onClose }: Props) {
  const toast = useToast();
  const [source, setSource] = useState(() => members.find(member => !group.includes(member.memberId))?.memberId ?? members[0]?.memberId ?? "");
  const [chosen, setChosen] = useState(group);
  const [preview, setPreview] = useState<SyncChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const groupMembers = members.filter(member => group.includes(member.memberId) && member.memberId !== source);
  const targets = groupMembers.filter(member => chosen.includes(member.memberId)).map(member => member.memberId);
  const sourceName = members.find(member => member.memberId === source)?.name ?? "";

  const request = (dryRun: boolean) => api.post<SyncResult>("/district/folders/sync", { fromMemberId: source, toMemberIds: targets, dryRun });
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await job(); } catch (reason) { if (!redirectIfSignedOut(reason)) setError(errorText(reason)); } finally { setBusy(false); }
  };

  const showPreview = () => run(async () => setPreview((await request(true)).results));
  const sync = () => run(async () => {
    const { results } = await request(false);
    const count = results.filter(changed).length;
    toast(count ? `وُحّدت مجلدات ${counted(count, MEMBERS)}` : "مجلداتهن مثل مجلداتها — لم يتغير شيء");
    onDone();
    onClose();
  });

  if (preview) {
    const files = preview.reduce((sum, item) => sum + item.filesToUnsorted, 0);
    return (
      <Dialog
        title="توحيد المجلدات"
        description={`تصبح مجلدات كل واحدة منهن مثل مجلدات ${sourceName} تماماً: مجلداتها ومجلدات كل مدرسة.`}
        onClose={onClose}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setPreview(null)} disabled={busy}>رجوع</button>
          <button type="button" className={`btn ${files ? "btn-danger-solid" : "btn-primary"}`} onClick={() => void sync()} disabled={busy || !preview.some(changed)}>
            {busy ? <span className="spinner spinner-light" /> : <FolderSync aria-hidden />} توحيد المجلدات
          </button>
        </>}
      >
        <ul className="fs-preview">
          {preview.map(item => (
            <li key={item.memberId}>
              <b>{item.name}</b>
              <span className={item.filesToUnsorted ? "fe-warn" : undefined}>{changeLine(item)}</span>
              {changed(item) && <small>{changeNames(item)}</small>}
            </li>
          ))}
        </ul>
        {files > 0 && <p className="fe-note">الملفات لا تُحذف: تنتقل إلى «غير مصنّفة» عند صاحبتها، وتعود إلى مكانها إن استُعيد مجلدها.</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="توحيد مع مجلدات مشرفة"
      description="اختاري المشرفة التي تُنسخ مجلداتها، ومن تصبح مجلداتها مثلها. تُعرض التغييرات قبل أن يُحفظ شيء."
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={() => void showPreview()} disabled={busy || !source || !targets.length}>
          {busy && <span className="spinner spinner-light" />} معاينة التغييرات
        </button>
      </>}
    >
      <label className="field">
        <span className="field-label">مثل مجلدات</span>
        <select className="input" value={source} onChange={event => setSource(event.target.value)}>
          {members.map(member => <option key={member.memberId} value={member.memberId}>{member.name}{member.title ? ` — ${member.title}` : ""}</option>)}
        </select>
      </label>
      <fieldset className="fs-targets">
        <legend className="field-label">تصبح مجلداتها مثلها</legend>
        {groupMembers.length ? (
          <ul className="fe-also-list">
            {groupMembers.map(member => (
              <li key={member.memberId}>
                <label>
                  <input type="checkbox" checked={chosen.includes(member.memberId)}
                    onChange={() => setChosen(list => (list.includes(member.memberId) ? list.filter(id => id !== member.memberId) : [...list, member.memberId]))} />
                  <span><b>{member.name}</b>{member.title && <small>{member.title}</small>}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="fe-note">اختاري مشرفة من خارج هذه المجموعة.</p>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Dialog>
  );
}
