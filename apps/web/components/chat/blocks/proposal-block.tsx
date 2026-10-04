"use client";

import type { ChatBlock, ProposalChange } from "@rasd/schemas";
import { ArrowLeft, CircleCheck, CircleX, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiRequestError } from "../../../lib/api";
import { useChat } from "../../../lib/chat/chat-context";
import { counted } from "../../../lib/format";

type ProposalBlockData = Extract<ChatBlock, { type: "proposal" }>;

const EDITS = { one: "تعديل واحد", two: "تعديلان", few: "تعديلات", many: "تعديلاً" };
type MemberGroup = { memberId: string; memberName: string; changes: ProposalChange[] };

function groupByMember(changes: ProposalChange[]): MemberGroup[] {
  const groups = new Map<string, MemberGroup>();
  for (const change of changes) {
    const key = change.memberId || change.memberName;
    const group = groups.get(key) ?? { memberId: change.memberId, memberName: change.memberName, changes: [] };
    group.changes.push(change);
    groups.set(key, group);
  }
  return [...groups.values()];
}

type Props = { block: ProposalBlockData; conversationId: string; messageId: string; messageText: string };

/**
 * Proposed changes with one approve / cancel. Each fact is said once: the summary only when the message
 * above doesn't already say it, and no result line after approval (the next message confirms it).
 */
export function ProposalBlock({ block, conversationId, messageId, messageText }: Props) {
  const { resolveProposal, loadMessages } = useChat();
  const [busy, setBusy] = useState<"apply" | "reject" | null>(null);
  const [error, setError] = useState("");
  const groups = useMemo(() => groupByMember(block.changes), [block.changes]);
  const newMembers = block.newMembers ?? [];
  const unmatched = block.unmatched ?? [];
  const pending = block.status === "pending";

  const act = async (action: "apply" | "reject") => {
    setBusy(action);
    setError("");
    try {
      await resolveProposal(conversationId, messageId, block.proposalId, action);
    } catch (reason) {
      const failure = reason as ApiRequestError;
      setError(failure.message);
      if (failure.status === 409) await loadMessages(conversationId).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`blk blk-proposal is-${block.status}`}>
      <header className="blk-proposal-head">
        <span className="blk-proposal-icon" aria-hidden><Sparkles /></span>
        <div>
          <b>{block.title}</b>
          {block.summary && !messageText.includes(block.summary) && <p>{block.summary}</p>}
        </div>
        {block.status === "applied" && <span className="pill pill-ok">تم الاعتماد</span>}
        {block.status === "rejected" && <span className="pill">أُلغي</span>}
      </header>

      {groups.map(group => (
        <details key={group.memberId || group.memberName} className="blk-group" open={groups.length <= 3}>
          <summary>
            <b>{group.memberName}</b>
            <span className="pill pill-brand">{counted(group.changes.length, EDITS)}</span>
            {group.memberId && <Link href={`/district/team/${group.memberId}`} className="blk-group-link" onClick={event => event.stopPropagation()}>الملف</Link>}
          </summary>
          <ul className="blk-changes">
            {group.changes.map((change, index) => (
              <li key={index}>
                <span className="blk-change-label">{change.fieldLabel}{change.fieldId === null && <small className="pill">حقل جديد</small>}</span>
                <span className="blk-change-values">
                  <span className="before">{change.before || "فارغ"}</span>
                  <ArrowLeft aria-label="يصبح" />
                  <span className="after">{change.after || "فارغ"}</span>
                </span>
                {change.source && <small className="blk-change-source">{change.source}</small>}
              </li>
            ))}
          </ul>
        </details>
      ))}

      {newMembers.length > 0 && (
        <div className="blk-sub">
          <h5><UserPlus aria-hidden /> مشرفات جديدات سيُضفن للفريق</h5>
          <ul className="blk-plain-list">
            {newMembers.map((member, index) => (
              <li key={index}><b>{member.name}</b> <span dir="ltr">{member.email}</span>{member.title && <> · {member.title}</>}</li>
            ))}
          </ul>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="blk-sub blk-unmatched">
          <h5>لم أتمكن من مطابقتها مع مشرفة</h5>
          <ul className="blk-plain-list">{unmatched.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}

      {pending && (
        <footer className="blk-actions">
          <button className="btn btn-primary" onClick={() => act("apply")} disabled={busy !== null}>
            {busy === "apply" ? <span className="spinner spinner-light" /> : <CircleCheck />} اعتماد وتعبئة
          </button>
          <button className="btn btn-secondary" onClick={() => act("reject")} disabled={busy !== null}>
            {busy === "reject" ? <span className="spinner" /> : <CircleX />} إلغاء
          </button>
        </footer>
      )}
    </section>
  );
}
