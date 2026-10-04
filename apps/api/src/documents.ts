import type { DocumentInfo, DocumentKind } from "@rasd/schemas";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { cleanText, db, newId, now, parseJson, uploadsDir } from "./db.js";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;
const MAX_ROWS_PER_SHEET = 5_000;
const MAX_COLS = 80;

export type DocumentTable = { sheet: string; rows: string[][] };
export type StoredDocument = DocumentInfo & { text: string; tables: DocumentTable[]; storagePath: string; conversationId: string | null };

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

const cell = (value: unknown) => cleanText(value instanceof Date ? value.toISOString().slice(0, 10) : value);

function trimTable(rows: unknown[][]): string[][] {
  const table = rows.slice(0, MAX_ROWS_PER_SHEET).map(row => row.slice(0, MAX_COLS).map(cell));
  while (table.length && table[table.length - 1].every(value => !value)) table.pop();
  const width = table.reduce((max, row) => { let last = row.length; while (last > 0 && !row[last - 1]) last--; return Math.max(max, last); }, 0);
  return table.filter(row => row.some(Boolean)).map(row => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

function tablesToText(tables: DocumentTable[]) {
  return tables.map(table => `## ${table.sheet}\n${table.rows.map(row => row.join(" | ")).join("\n")}`).join("\n\n");
}

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

export async function extractContent(buffer: Buffer, name: string, kind: DocumentKind): Promise<{ text: string; tables: DocumentTable[]; pages?: number }> {
  const ext = extname(name).toLowerCase();
  if (kind === "spreadsheet") {
    const workbook = ext === ".csv" || ext === ".tsv"
      ? XLSX.read(buffer.toString("utf8").replace(/^﻿/, ""), { type: "string", cellDates: true, raw: false, FS: ext === ".tsv" ? "\t" : undefined })
      : XLSX.read(buffer, { type: "buffer", cellDates: true });
    const tables = workbook.SheetNames.map(sheet => ({
      sheet,
      rows: trimTable(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "", raw: false, blankrows: false })),
    })).filter(table => table.rows.length);
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

function mapDocument(row: Record<string, unknown>): StoredDocument {
  const text = String(row.text_content ?? "");
  const tables = parseJson<DocumentTable[]>(row.tables_json, []);
  return {
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    ownerName: row.owner_name ? String(row.owner_name) : null,
    uploadedBy: String(row.uploaded_by),
    uploadedByName: String(row.uploader_name ?? ""),
    name: String(row.name),
    mime: String(row.mime ?? ""),
    size: Number(row.size ?? 0),
    kind: String(row.kind) as DocumentKind,
    status: String(row.status) === "failed" ? "failed" : "ready",
    excerpt: cleanText(text).slice(0, 280),
    pages: row.pages == null ? undefined : Number(row.pages),
    sheets: tables.length ? tables.map(table => table.sheet) : undefined,
    createdAt: String(row.created_at),
    text,
    tables,
    storagePath: String(row.storage_path),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
  };
}

export const toDocumentInfo = ({ text: _text, tables: _tables, storagePath: _path, conversationId: _conversation, ...info }: StoredDocument): DocumentInfo => info;

const SELECT_DOCUMENT = `SELECT documents.*, owner.name AS owner_name, uploader.name AS uploader_name FROM documents
  LEFT JOIN users owner ON owner.id = documents.owner_id LEFT JOIN users uploader ON uploader.id = documents.uploaded_by`;

export function getDocument(id: string) {
  const row = db.prepare(`${SELECT_DOCUMENT} WHERE documents.id = ?`).get(id);
  return row ? mapDocument(row) : null;
}

export function documentsForOwner(ownerId: string) {
  return db.prepare(`${SELECT_DOCUMENT} WHERE documents.owner_id = ? ORDER BY documents.created_at DESC`).all(ownerId).map(mapDocument);
}

/** Every document the head can see: her team's files plus the files she uploaded herself. */
export function documentsForHead(headId: string) {
  return db.prepare(`${SELECT_DOCUMENT} WHERE documents.uploaded_by = ? OR documents.owner_id = ?
    OR documents.owner_id IN (SELECT id FROM users WHERE head_id = ?) ORDER BY documents.created_at DESC`).all(headId, headId, headId).map(mapDocument);
}

export async function saveDocument(input: { ownerId: string | null; uploadedBy: string; conversationId?: string | null; name: string; mime: string; buffer: Buffer }) {
  const id = newId();
  const name = cleanText(input.name).replace(/[\\/:*?"<>|]/g, "_") || "ملف";
  const kind = detectKind(name, input.mime);
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
  const storagePath = `${id}${ext}`;
  writeFileSync(join(uploadsDir, storagePath), input.buffer);
  let content: { text: string; tables: DocumentTable[]; pages?: number } = { text: "", tables: [] };
  let status = "ready";
  let error: string | null = null;
  try { content = await extractContent(input.buffer, name, kind); }
  catch (reason) { status = "failed"; error = (reason as Error).message.slice(0, 300); }
  db.prepare(`INSERT INTO documents (id,owner_id,uploaded_by,conversation_id,name,mime,size,kind,storage_path,text_content,tables_json,pages,status,error,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.ownerId, input.uploadedBy, input.conversationId ?? null, name, input.mime || "application/octet-stream", input.buffer.length, kind, storagePath,
    content.text.slice(0, MAX_TEXT_CHARS), JSON.stringify(content.tables), content.pages ?? null, status, error, now(),
  );
  return getDocument(id)!;
}

// Types a browser may render inline. Everything else (html, svg, js, unknown) is served as a plain download so an
// uploaded file can never run script in the web app's origin. The client-supplied mime is never trusted here.
const SAFE_INLINE: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
};
export const safeContentType = (name: string) => SAFE_INLINE[extname(name).toLowerCase()] ?? "application/octet-stream";

export function readDocumentFile(document: StoredDocument) {
  return readFileSync(join(uploadsDir, document.storagePath));
}

export function assignDocument(id: string, ownerId: string | null) {
  db.prepare("UPDATE documents SET owner_id = ? WHERE id = ?").run(ownerId, id);
  return getDocument(id);
}

export function linkDocumentsToConversation(ids: string[], conversationId: string) {
  for (const id of ids) db.prepare("UPDATE documents SET conversation_id = ? WHERE id = ? AND conversation_id IS NULL").run(conversationId, id);
}

export function deleteDocument(id: string) {
  const document = getDocument(id);
  if (!document) return false;
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  try { rmSync(join(uploadsDir, document.storagePath), { force: true }); } catch { /* file already gone */ }
  return true;
}
