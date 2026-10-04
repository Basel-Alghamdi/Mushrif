"use client";

import type { ChatBlock } from "@rasd/schemas";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ar } from "../../../lib/format";
import { formatCell, isNumeric } from "./shared";

type TableBlockData = Extract<ChatBlock, { type: "table" }>;
const PHONE_ROWS = 8;

/** A table on wide screens; on phones (≤600px, via CSS) compact two-line rows, the first 8 + «عرض الكل (n)». */
export function TableBlock({ block }: { block: TableBlockData }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const clickable = Boolean(block.memberIds?.some(Boolean));
  const open = (id: string | null | undefined) => { if (id) router.push(`/district/team/${id}`); };
  const phoneRows = showAll ? block.rows : block.rows.slice(0, PHONE_ROWS);

  // Phone rows: skip columns that say the same on every row, and put short numbers first so the ellipsis never hides them.
  const text = (row: (string | number)[], index: number) => String(row[index] ?? "").trim();
  const numeric = (index: number) => block.rows.every(row => !text(row, index) || isNumeric(text(row, index)));
  const detailColumns = block.columns
    .map((column, index) => ({ column, index }))
    .slice(1)
    .filter(({ index }) => block.rows.length < 3 || new Set(block.rows.map(row => text(row, index))).size > 1)
    .sort((a, b) => Number(numeric(b.index)) - Number(numeric(a.index)));

  return (
    <section className="blk blk-table">
      {block.title && <h4 className="blk-title">{block.title}</h4>}
      <div className="md-table-wrap blk-table-wide">
        <table className="md-table">
          <thead>
            <tr>
              {block.columns.map((column, index) => <th key={index}>{column}</th>)}
              {clickable && <th aria-label="فتح الملف" />}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => {
              const memberId = block.memberIds?.[rowIndex];
              return (
                <tr
                  key={rowIndex}
                  className={memberId ? "is-link" : undefined}
                  onClick={memberId ? () => open(memberId) : undefined}
                  onKeyDown={memberId ? event => { if (event.key === "Enter") open(memberId); } : undefined}
                  tabIndex={memberId ? 0 : undefined}
                  role={memberId ? "link" : undefined}
                >
                  {block.columns.map((_, index) => <td key={index}>{formatCell(row[index])}</td>)}
                  {clickable && <td className="cell-chevron">{memberId && <ChevronLeft aria-hidden />}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="blk-rows">
        {phoneRows.map((row, rowIndex) => {
          const memberId = block.memberIds?.[rowIndex];
          const details = detailColumns
            .map(({ column, index }) => ({ column, value: formatCell(row[index]) }))
            .filter(item => item.value !== "—")
            .map(item => `${item.column}: ${item.value}`)
            .join(" · ");
          const body = (
            <>
              <span className="blk-row-text">
                <b>{formatCell(row[0])}</b>
                {details && <small>{details}</small>}
              </span>
              {memberId && <ChevronLeft aria-hidden className="blk-row-chevron" />}
            </>
          );
          return (
            <li key={rowIndex}>
              {memberId ? <Link href={`/district/team/${memberId}`} className="blk-row is-link">{body}</Link> : <div className="blk-row">{body}</div>}
            </li>
          );
        })}
      </ul>
      {block.rows.length > PHONE_ROWS && (
        <button className="btn btn-ghost btn-block blk-rows-more" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>
          {showAll ? "عرض أقل" : `عرض الكل (${ar(block.rows.length)})`}
        </button>
      )}
    </section>
  );
}
