"use client";

import type { ChatBlock } from "@rasd/schemas";
import { useState } from "react";
import { ar } from "../../../lib/format";
import { formatCell } from "./shared";

type StatsBlockData = Extract<ChatBlock, { type: "stats" }>;
const HEADLINE = 4;

/** The first 4 numbers as compact tiles; the rest behind «كل الأرقام (n)». */
export function StatsBlock({ block }: { block: StatsBlockData }) {
  const [open, setOpen] = useState(false);
  const collapsible = block.items.length > HEADLINE;
  const items = collapsible && !open ? block.items.slice(0, HEADLINE) : block.items;

  return (
    <section className="blk blk-stats">
      {block.title && <h4 className="blk-title">{block.title}</h4>}
      <div className="blk-stats-grid">
        {items.map((item, index) => (
          <div key={index} className={`blk-stat tone-${item.tone ?? "neutral"}`}>
            <span className="blk-stat-label">{item.label}</span>
            <b className="blk-stat-value">{formatCell(item.value)}</b>
            {item.hint && <small className="blk-stat-hint">{item.hint}</small>}
          </div>
        ))}
        {collapsible && (
          <button className={`blk-stats-more ${open ? "is-open" : ""}`} onClick={() => setOpen(value => !value)} aria-expanded={open}>
            {open ? "عرض أقل" : `كل الأرقام (${ar(block.items.length)})`}
          </button>
        )}
      </div>
    </section>
  );
}
