import { Fragment, ReactNode } from "react";
import { formatCell, isNumeric } from "./blocks/shared";

// A deliberately small markdown renderer for the assistant's replies.
// It only ever produces React elements (never raw HTML), and only http(s) links.

type MdBlock =
  | { type: "p"; lines: string[] }
  | { type: "h"; level: 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[]; start: number }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "quote"; lines: string[] }
  | { type: "code"; text: string }
  | { type: "hr" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*([0-9٠-٩]+)[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|?\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

const toWestern = (digits: string) => Number(digits.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));

function splitRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

export function parseBlocks(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ type: "p", lines: paragraph }); paragraph = []; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }

    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) { flush(); blocks.push({ type: "h", level: heading[1].length <= 2 ? 2 : 3, text: heading[2] }); continue; }
    if (RULE.test(line)) { flush(); blocks.push({ type: "hr" }); continue; }

    if (TABLE_ROW.test(line) && line.includes("|", line.indexOf("|") + 1)) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]); i++) {
        if (!TABLE_SEPARATOR.test(lines[i])) rows.push(splitRow(lines[i]));
      }
      i--;
      if (rows.length) blocks.push({ type: "table", header: rows[0], rows: rows.slice(1) });
      continue;
    }

    const bullet = line.match(BULLET);
    const ordered = line.match(ORDERED);
    if (bullet || ordered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const match = kind === "ul" ? lines[i].match(BULLET) : lines[i].match(ORDERED);
        if (match) items.push(kind === "ul" ? match[1] : match[2]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      blocks.push(kind === "ul" ? { type: "ul", items } : { type: "ol", items, start: toWestern(ordered![1]) || 1 });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ type: "quote", lines: quote });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

// Order matters: code first (its content is literal), then bold, links, bare urls, italic.
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)|\*([^*\s](?:[^*]*[^*\s])?)\*/g;
const TRAILING_PUNCTUATION = /[.,،؛:!?؟)]+$/;

function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="md-link" dir="auto">{children}</a>;
}

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    const [whole, code, bold, linkText, linkHref, url, italic] = match;
    let consumed = whole.length;
    if (code !== undefined) nodes.push(<code key={key} className="md-code">{code}</code>);
    else if (bold !== undefined) nodes.push(<strong key={key}>{renderInline(bold, key)}</strong>);
    else if (linkText !== undefined) nodes.push(<SafeLink key={key} href={linkHref}>{renderInline(linkText, key)}</SafeLink>);
    else if (url !== undefined) {
      const clean = url.replace(TRAILING_PUNCTUATION, "");
      consumed = clean.length;
      nodes.push(<SafeLink key={key} href={clean}>{clean}</SafeLink>);
    } else if (italic !== undefined) nodes.push(<em key={key}>{renderInline(italic, key)}</em>);
    last = start + consumed;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Lines({ lines, keyPrefix }: { lines: string[]; keyPrefix: string }) {
  return <>{lines.map((line, index) => (
    <Fragment key={index}>{index > 0 && <br />}{renderInline(line, `${keyPrefix}-${index}`)}</Fragment>
  ))}</>;
}

function MdTable({ header, rows, keyPrefix }: { header: string[]; rows: string[][]; keyPrefix: string }) {
  const width = Math.max(header.length, ...rows.map(row => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? "");
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{pad(header).map((cell, index) => <th key={index}>{renderInline(cell, `${keyPrefix}-h${index}`)}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{pad(row).map((cell, index) => (
              <td key={index}>{isNumeric(cell) ? formatCell(cell) : renderInline(cell, `${keyPrefix}-${rowIndex}-${index}`)}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case "p": return <p key={key}><Lines lines={block.lines} keyPrefix={key} /></p>;
          case "h": return block.level === 2 ? <h3 key={key} className="md-h2">{renderInline(block.text, key)}</h3> : <h4 key={key} className="md-h3">{renderInline(block.text, key)}</h4>;
          case "ul": return <ul key={key}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</ul>;
          case "ol": return <ol key={key} start={block.start}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</ol>;
          case "table": return <MdTable key={key} header={block.header} rows={block.rows} keyPrefix={key} />;
          case "quote": return <blockquote key={key}><Lines lines={block.lines} keyPrefix={key} /></blockquote>;
          case "code": return <pre key={key} className="md-pre"><code>{block.text}</code></pre>;
          case "hr": return <hr key={key} />;
        }
      })}
    </div>
  );
}
