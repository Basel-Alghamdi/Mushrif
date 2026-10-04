"use client";

import type { ChatBlock } from "@rasd/schemas";
import { ExternalLink, School } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { downloadFile } from "../../../lib/api";
import { initialsOf } from "../../../lib/chat/helpers";
import { ar, counted, pct, relativeTime } from "../../../lib/format";
import { formatCell, KindIcon } from "./shared";

type MemberBlockData = Extract<ChatBlock, { type: "member" }>;
const VISIBLE_FIELDS = 4;
const STUDENTS = { one: "طالبة واحدة", two: "طالبتان", few: "طالبات", many: "طالبة" };
const TEACHERS = { one: "معلمة واحدة", two: "معلمتان", few: "معلمات", many: "معلمة" };

/** A member in the chat: one status line (like her profile header), 4 fields, then «كل البيانات». */
export function MemberBlock({ block }: { block: MemberBlockData }) {
  const [showAll, setShowAll] = useState(false);
  const fields = showAll ? block.fields : block.fields.slice(0, VISIBLE_FIELDS);

  return (
    <section className="blk blk-member">
      <header className="blk-member-head">
        <span className="avatar">{initialsOf(block.name)}</span>
        <div className="blk-member-id">
          <b>{block.name}</b>
          {block.title && <span>{block.title}</span>}
        </div>
      </header>

      <p className="mp-status">
        <span className={`mp-status-dot ${block.activated ? "is-ok" : "is-warn"}`} aria-hidden />
        <span>{block.activated ? "فعّلت" : "لم تفعّل حسابها"}</span>
        <span aria-hidden>·</span>
        <span>{pct(block.completion)}</span>
        <span aria-hidden>·</span>
        {block.missing.length
          ? <span className="blk-member-missing">ينقصها {ar(block.missing.length)}</span>
          : <span className="mp-complete">مكتمل ✓</span>}
      </p>

      {fields.length > 0 && (
        <dl className="blk-fields">
          {fields.map((field, index) => (
            <div key={index}>
              <dt>{field.label}</dt>
              <dd>{field.value ? formatCell(field.value) : <span className="muted">لم يُعبّأ</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {block.fields.length > VISIBLE_FIELDS && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>
          {showAll ? "عرض أقل" : `كل البيانات (${ar(block.fields.length)})`}
        </button>
      )}

      {block.schools.length > 0 && (
        <div className="blk-sub">
          <h5>المدارس ({ar(block.schools.length)})</h5>
          <ul className="blk-schools">
            {block.schools.map((school, index) => (
              <li key={index}>
                <School aria-hidden />
                <div>
                  <b>{school.name || "مدرسة بدون اسم"}</b>
                  <small>{[school.stage, school.students > 0 && counted(school.students, STUDENTS), school.teachers > 0 && counted(school.teachers, TEACHERS)].filter(Boolean).join(" · ")}</small>
                </div>
                {school.tier && <span className="pill pill-brand">{school.tier}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {block.documents.length > 0 && (
        <div className="blk-sub">
          <h5>الملفات ({ar(block.documents.length)})</h5>
          <ul className="blk-doc-chips">
            {block.documents.map(document => (
              <li key={document.id}>
                <button className="file-chip" onClick={() => void downloadFile(`/documents/${document.id}/download`, document.name)} title={`تنزيل ${document.name}`}>
                  <KindIcon kind={document.kind} />
                  <bdi className="file-chip-name">{document.name}</bdi>
                  <small>{relativeTime(document.createdAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href={`/district/team/${block.memberId}`} className="btn btn-secondary btn-block">
        <ExternalLink /> فتح الملف الكامل
      </Link>
    </section>
  );
}
