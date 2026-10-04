// Text and tables read out of uploaded files (SheetJS, mammoth, unpdf). Pure functions with no database or Storage, so
// documents.ts can run them in a worker thread (extract-worker.ts) instead of on the API's event loop.
import { extname } from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { DocumentKind } from "@rasd/schemas";
import { cleanText } from "./parse.js";

const MAX_ROWS_PER_SHEET = 5_000;
const MAX_COLS = 80;
const MAX_SHEETS = 30;
/** All sheets together: bounds the tables JSON a single upload can produce. */
const MAX_TABLE_CELLS = 600_000;

export type DocumentTable = { sheet: string; rows: string[][] };
export type ExtractedContent = { text: string; tables: DocumentTable[]; pages?: number };

export function detectKind(name: string, mime: string): DocumentKind {
  const ext = extname(name).toLowerCase();
  if ([".xlsx", ".xlsm", ".xls", ".csv", ".tsv", ".ods"].includes(ext) || /spreadsheet|excel|csv/.test(mime)) return "spreadsheet";
  if (ext === ".pdf" || mime === "application/pdf") return "pdf";
  if ([".docx", ".doc", ".odt", ".rtf"].includes(ext) || /word|opendocument\.text/.test(mime)) return "word";
  if ([".txt", ".md", ".json", ".html", ".htm", ".xml"].includes(ext) || mime.startsWith("text/")) return "text";
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".bmp"].includes(ext)) return "image";
  if (mime.startsWith("audio/") || [".mp3", ".m4a", ".wav", ".ogg", ".aac"].includes(ext)) return "audio";
  return "other";
}

/** Kinds that have text to read (images, audio and unknown files are only stored). */
export const hasContent = (kind: DocumentKind) => ["spreadsheet", "word", "pdf", "text"].includes(kind);

const cell = (value: unknown) => cleanText(value instanceof Date ? value.toISOString().slice(0, 10) : value).replace(/\u0000/g, "");

function trimTable(rows: unknown[][]): string[][] {
  const table = rows.slice(0, MAX_ROWS_PER_SHEET).map(row => row.slice(0, MAX_COLS).map(cell));
  while (table.length && table[table.length - 1].every(value => !value)) table.pop();
  const width = table.reduce((max, row) => { let last = row.length; while (last > 0 && !row[last - 1]) last--; return Math.max(max, last); }, 0);
  return table.filter(row => row.some(Boolean)).map(row => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

const tablesToText = (tables: DocumentTable[]) => tables.map(table => `## ${table.sheet}\n${table.rows.map(row => row.join(" | ")).join("\n")}`).join("\n\n");

/** Very small HTML table reader for mammoth output (Word tables often hold "label | value" forms). */
function htmlTables(html: string): DocumentTable[] {
  const tables: DocumentTable[] = [];
  const strip = (value: string) => cleanText(value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  for (const [index, tableHtml] of [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(match => match[0]).entries()) {
    const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(row => [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cellMatch => strip(cellMatch[1])));
    const trimmed = trimTable(rows);
    if (trimmed.length) tables.push({ sheet: `جدول ${index + 1}`, rows: trimmed });
  }
  return tables;
}

/**
 * The sheets of a workbook as tables. SheetJS stops reading each sheet after the row limit (sheetRows), and only the
 * first MAX_COLS columns are turned into rows, so a huge export never becomes a huge array.
 */
function spreadsheetTables(buffer: Buffer, ext: string): DocumentTable[] {
  const sheetRows = MAX_ROWS_PER_SHEET + 1;
  const workbook = ext === ".csv" || ext === ".tsv"
    ? XLSX.read(buffer.toString("utf8").replace(/^﻿/, ""), { type: "string", cellDates: true, raw: false, sheetRows, FS: ext === ".tsv" ? "\t" : undefined })
    : XLSX.read(buffer, { type: "buffer", cellDates: true, sheetRows });
  const tables: DocumentTable[] = [];
  let cells = 0;
  for (const sheet of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const worksheet = workbook.Sheets[sheet];
    if (!worksheet?.["!ref"] || cells >= MAX_TABLE_CELLS) continue;
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    range.e.c = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
    range.e.r = Math.min(range.e.r, range.s.r + MAX_ROWS_PER_SHEET - 1);
    const rows = trimTable(XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false, blankrows: false, range }));
    const width = rows[0]?.length ?? 0;
    const kept = width ? rows.slice(0, Math.max(1, Math.floor((MAX_TABLE_CELLS - cells) / width))) : rows;
    cells += kept.length * width;
    if (kept.length) tables.push({ sheet, rows: kept });
  }
  return tables;
}

/** Text and tables from a spreadsheet, Word document, PDF or text file; images and audio have none. */
export async function extractContent(buffer: Buffer, name: string, kind: DocumentKind): Promise<ExtractedContent> {
  const ext = extname(name).toLowerCase();
  if (kind === "spreadsheet") {
    const tables = spreadsheetTables(buffer, ext);
    return { text: tablesToText(tables), tables };
  }
  if (kind === "word") {
    if (ext !== ".docx") return { text: "", tables: [] };
    const [{ value: text }, { value: html }] = await Promise.all([mammoth.extractRawText({ buffer }), mammoth.convertToHtml({ buffer })]);
    return { text, tables: htmlTables(html) };
  }
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text: Array.isArray(text) ? text.join("\n") : text, tables: [], pages: totalPages };
  }
  if (kind === "text") return { text: buffer.toString("utf8").replace(/^﻿/, ""), tables: [] };
  return { text: "", tables: [] };
}
