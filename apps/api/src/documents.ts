// Stored files (decision 7): rows in attachments (+ attachment_contents for the text and tables read out of them),
// bytes in a private Supabase Storage bucket. A member's files have owner_type "document"; the head's chat uploads
// start without a cluster and are filed into a member's cluster later (assignDocument).
// Inside a cluster, each file sits in one of the fixed ملف الإنجاز folders (folder, + school_id for a school's folder).
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type postgres from "postgres";
import { isFileFolder, type DocumentInfo, type DocumentKind, type DocumentPlacement } from "@rasd/schemas";
import { auditWith, type AuditContext } from "./audit.js";
import { supabaseAdmin } from "./auth.js";
import { atomically, type Row, type Sql } from "./db.js";
import { env } from "./env.js";
import { ApiError, notFound } from "./errors.js";
import { detectKind, extractContent, hasContent, type DocumentTable } from "./extract.js";
import { cleanText, isUuid } from "./parse.js";

export { detectKind, type DocumentTable } from "./extract.js";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;
const MAX_TEXT_CHARS = 400_000;
const EXCERPT_CHARS = 280;

/** A file without its extracted content: what listings, permission checks and downloads need. */
export type DocumentRow = DocumentInfo & {
  clusterId: string | null; districtId: string; conversationId: string | null; ownerType: string; storagePath: string;
};
/** A file with the full text and tables read out of it (getDocument, the agent). */
export type StoredDocument = DocumentRow & { text: string; tables: DocumentTable[] };

// ───────── reading files (off the event loop) ─────────
export const EXTRACT_TIMEOUT_MS = 20_000;
const WORKER_HEAP_MB = 512;
/** At most this many files are read at once across all requests; the rest wait their turn. */
const MAX_PARALLEL_EXTRACTIONS = 2;

type Extracted = { text: string; tablesJson: string; pages?: number };

let running = 0;
const waiting: (() => void)[] = [];
const acquireSlot = () => (running < MAX_PARALLEL_EXTRACTIONS ? (running += 1, Promise.resolve()) : new Promise<void>(resolve => waiting.push(resolve)));
const releaseSlot = () => { const next = waiting.shift(); if (next) next(); else running -= 1; };

// The worker is TypeScript like the rest of the API: it inherits the parent's tsx loader, or gets one if the parent has none.
const workerFile = new URL(`./extract-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const workerExecArgv = () =>
  workerFile.pathname.endsWith(".ts") && !process.execArgv.some(arg => arg.includes("tsx")) ? [...process.execArgv, "--import", import.meta.resolve("tsx")] : undefined;
let warnedInThread = false;

/** One file in a worker thread, with a time and memory limit. Resolves null when no worker could be started. */
function extractInWorker(buffer: Buffer, name: string, kind: DocumentKind, timeoutMs: number) {
  return new Promise<Extracted | null>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerFile, { workerData: { buffer, name, kind }, execArgv: workerExecArgv(), resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
    } catch (error) {
      console.error("extraction worker could not start", error);
      resolve(null);
      return;
    }
    let started = false;
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`reading the file took longer than ${timeoutMs / 1000}s`))), timeoutMs);
    worker.on("message", (message: Partial<Extracted> & { type: string; error?: string }) => {
      if (message.type === "ready") { started = true; return; }
      if (message.type === "done") finish(() => resolve({ text: message.text ?? "", tablesJson: message.tablesJson ?? "[]", pages: message.pages }));
      else finish(() => reject(new Error(message.error ?? "extraction failed")));
    });
    // Before "ready" the worker itself failed to load (no TypeScript loader, a missing module…); after it, the file did.
    worker.on("error", error => finish(() => (started ? reject(error) : (console.error("extraction worker could not start", error), resolve(null)))));
    worker.on("exit", code => finish(() => (started ? reject(new Error(`extraction stopped (exit ${code})`)) : resolve(null))));
  });
}

/**
 * Text and tables of an uploaded file, read in a worker thread so a large spreadsheet, document or PDF never blocks
 * the API (timeout → the file is kept with status "failed"). Only if no worker can start is the file read in-thread.
 */
export async function extractOffThread(buffer: Buffer, name: string, kind: DocumentKind, timeoutMs = EXTRACT_TIMEOUT_MS): Promise<Extracted> {
  if (!hasContent(kind)) return { text: "", tablesJson: "[]" };
  await acquireSlot();
  let result: Extracted | null;
  try { result = await extractInWorker(buffer, name, kind, timeoutMs); }
  finally { releaseSlot(); }
  if (result) return result;
  if (!warnedInThread) { warnedInThread = true; console.error("no extraction worker: reading uploaded files on the main thread"); }
  const content = await extractContent(buffer, name, kind);
  return { text: content.text, tablesJson: JSON.stringify(content.tables), pages: content.pages };
}

// Types a browser may render inline. Everything else (html, svg, js, unknown) is served as a plain download so an
// uploaded file can never run script in the web app's origin. The client-supplied mime is never trusted here.
const SAFE_INLINE: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
};
export const safeContentType = (name: string) => SAFE_INLINE[extname(name).toLowerCase()] ?? "application/octet-stream";

// ───────── storage ─────────
const bucket = () => supabaseAdmin.storage.from(env.storageBucket);
let bucketReady: Promise<void> | null = null;

type BucketApi = Pick<typeof supabaseAdmin.storage, "getBucket" | "createBucket" | "updateBucket">;

/**
 * Makes sure the uploads bucket exists and is private (decision 7). A public bucket with that name would serve every
 * file without sign-in, so it is switched to private, and uploads are refused if that is not possible.
 */
export async function prepareBucket(storage: BucketApi, name: string) {
  let existing = await storage.getBucket(name);
  if (existing.error) {
    const { error } = await storage.createBucket(name, { public: false });
    if (!error) return;
    if (!/exist|duplicate/i.test(error.message)) throw error;
    existing = await storage.getBucket(name); // created by a parallel request in the meantime
    if (existing.error) throw existing.error;
  }
  if (!existing.data.public) return;
  console.error(`SECURITY: the Storage bucket "${name}" is PUBLIC — every uploaded file would be readable without signing in. Making it private.`);
  const { error } = await storage.updateBucket(name, {
    public: false, fileSizeLimit: existing.data.file_size_limit ?? null, allowedMimeTypes: existing.data.allowed_mime_types ?? null,
  });
  if (error) {
    console.error(`SECURITY: could not make the Storage bucket "${name}" private (${error.message}). Uploads are refused until it is private.`);
    throw new ApiError(502, "STORAGE_NOT_PRIVATE", "رفع الملفات متوقف مؤقتاً لأن مخزن الملفات غير محمي — تواصلي مع الدعم الفني");
  }
}

function ensureBucket() {
  bucketReady ??= prepareBucket(supabaseAdmin.storage, env.storageBucket).catch(error => { bucketReady = null; throw error; });
  return bucketReady;
}

export async function readDocumentFile(document: DocumentRow) {
  const { data, error } = await bucket().download(document.storagePath);
  if (error || !data) throw notFound("تعذّر العثور على محتوى الملف");
  return Buffer.from(await data.arrayBuffer());
}

// ───────── rows ─────────
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; }
};

function documentRow(row: Row, sheets: string[]): DocumentRow {
  return {
    id: String(row.id),
    ownerId: row.ownerId ? String(row.ownerId) : null,
    ownerName: row.ownerName ? String(row.ownerName) : null,
    uploadedBy: row.uploadedBy ? String(row.uploadedBy) : "",
    uploadedByName: String(row.uploaderName ?? ""),
    name: String(row.name),
    mime: String(row.mimeType ?? ""),
    size: Number(row.sizeBytes ?? 0),
    kind: detectKind(String(row.name), String(row.mimeType ?? "")),
    status: row.status === "failed" ? "failed" : "ready",
    excerpt: cleanText(row.text ?? "").slice(0, EXCERPT_CHARS),
    ...(row.pages == null ? {} : { pages: Number(row.pages) }),
    ...(sheets.length ? { sheets } : {}),
    createdAt: iso(row.uploadedAt),
    folder: row.folder ? String(row.folder) : null,
    schoolId: row.schoolId ? String(row.schoolId) : null,
    schoolName: row.schoolId ? String(row.schoolName ?? "") : null,
    clusterId: row.clusterId ? String(row.clusterId) : null,
    districtId: String(row.districtId),
    conversationId: row.conversationId ? String(row.conversationId) : null,
    ownerType: String(row.ownerType),
    storagePath: String(row.storagePath),
  };
}

function storedDocument(row: Row): StoredDocument {
  const tables = parseJson<DocumentTable[]>(row.tablesJson, []);
  return { ...documentRow(row, tables.map(table => table.sheet)), text: String(row.text ?? ""), tables };
}

export const toDocumentInfo = ({
  clusterId: _c, districtId: _d, conversationId: _v, ownerType: _o, storagePath: _p, text: _t, tables: _b, ...info
}: DocumentRow & Partial<Pick<StoredDocument, "text" | "tables">>): DocumentInfo => info;

// Text/tables come as text: postgres.camel would rewrite keys inside the jsonb. Without `content`, only the start of the
// text (for the excerpt) and the sheet names are read — listings never load whole files' content.
const selectDocuments = (db: Sql, where: postgres.Fragment, content: boolean) => db`
  select a.*, ac.pages, coalesce(ac.status, 'ready') as status,
    ${content ? db`ac.text, ac.tables::text as tables_json` : db`left(ac.text, 2000) as text, jsonb_path_query_array(ac.tables, '$[*].sheet')::text as sheets_json`},
    c.member_id as owner_id, owner.name as owner_name, uploader.name as uploader_name, s.name as school_name
  from attachments a
    left join attachment_contents ac on ac.attachment_id = a.id
    left join schools s on s.id = a.school_id
    left join clusters c on c.id = a.cluster_id
    left join profiles owner on owner.id = c.member_id
    left join profiles uploader on uploader.id = a.uploaded_by
  where a.deleted_at is null and ${where}
  order by a.uploaded_at desc`;

const listed = (rows: Row[]) => rows.map(row => documentRow(row, parseJson<unknown[]>(row.sheetsJson, []).map(String)));

/** One file with its full extracted text and tables. */
export async function getDocument(db: Sql, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await selectDocuments(db, db`a.id = ${id}`, true);
  return row ? storedDocument(row) : null;
}

/** One file without its content (permission checks, downloads, filing). */
export async function findDocument(db: Sql, id: string) {
  if (!isUuid(id)) return null;
  return listed(await selectDocuments(db, db`a.id = ${id}`, false))[0] ?? null;
}

export async function documentsForCluster(db: Sql, clusterId: string) {
  return listed(await selectDocuments(db, db`a.cluster_id = ${clusterId}`, false));
}

/** Every file in the district: the members' files and the head's chat uploads. */
export async function documentsForDistrict(db: Sql, districtId: string) {
  return listed(await selectDocuments(db, db`a.district_id = ${districtId}`, false));
}

/** documentsForDistrict with each file's full text and tables (the agent searches and quotes them). */
export async function documentContentsForDistrict(db: Sql, districtId: string) {
  return (await selectDocuments(db, db`a.district_id = ${districtId}`, true)).map(storedDocument);
}

/**
 * Stores a file: the bytes in Storage, then its row and extracted content. Extraction failures keep the file
 * (status "failed"); a database failure removes the stored bytes again. With `context`, the upload is audited
 * in the same transaction (a member's upload then counts as today's activity).
 */
export async function saveDocument(db: Sql, input: {
  districtId: string; clusterId: string | null; uploadedBy: string; conversationId?: string | null; ownerType?: string;
  placement?: DocumentPlacement | null; name: string; buffer: Buffer;
}, context?: AuditContext) {
  await ensureBucket();
  const id = randomUUID();
  const name = cleanText(input.name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 200) || "ملف";
  const kind = detectKind(name, "");
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
  const storagePath = `${input.districtId}/${id}${ext}`;
  const upload = await bucket().upload(storagePath, input.buffer, { contentType: safeContentType(name), upsert: false });
  if (upload.error) throw upload.error;

  let content: Extracted = { text: "", tablesJson: "[]" };
  let status: "ready" | "failed" = "ready";
  let error: string | null = null;
  try { content = await extractOffThread(input.buffer, name, kind); }
  catch (reason) { status = "failed"; error = String((reason as Error)?.message ?? reason).slice(0, 300); }

  try {
    await atomically(db, async tx => {
      await tx`insert into attachments ${tx({
        id, districtId: input.districtId, clusterId: input.clusterId, conversationId: input.conversationId ?? null,
        ownerType: input.ownerType ?? "document", name, kind, mimeType: safeContentType(name), sizeBytes: input.buffer.length,
        storagePath, uploadedBy: input.uploadedBy, folder: input.placement?.folder ?? null, schoolId: input.placement?.schoolId ?? null,
      })}`;
      await tx`
        insert into attachment_contents (attachment_id, text, tables, pages, status, error)
        values (${id}, ${content.text.slice(0, MAX_TEXT_CHARS).replace(/\u0000/g, "")}, ${content.tablesJson}::text::jsonb, ${content.pages ?? null}, ${status}, ${error})`;
      if (context) await auditWith(tx, context, { action: "create", entity: "document", entityId: id, clusterId: input.clusterId, after: { name, kind } });
    });
  } catch (failure) {
    await bucket().remove([storagePath]).catch(() => {});
    throw failure;
  }
  return (await findDocument(db, id))!;
}

/** Files a document into a member's cluster (or back to unfiled with null). */
export async function assignDocument(db: Sql, id: string, memberId: string | null, context?: AuditContext) {
  return atomically(db, async tx => {
    const before = await findDocument(tx, id);
    if (!before) return null;
    let clusterId: string | null = null;
    if (memberId) {
      const [cluster] = await tx`select id from clusters where member_id = ${memberId} and district_id = ${before.districtId}`;
      if (!cluster) throw notFound("العضوة غير موجودة");
      clusterId = String(cluster.id);
    }
    // Her folders (and her schools) do not exist in another cluster: a file filed elsewhere starts out of the folders.
    const keepFolder = clusterId !== null && clusterId === before.clusterId;
    await tx`
      update attachments set cluster_id = ${clusterId}, owner_type = 'document',
        folder = ${keepFolder ? before.folder : null}, school_id = ${keepFolder ? before.schoolId : null}
      where id = ${id}`;
    if (context) await auditWith(tx, context, { action: "assign", entity: "document", entityId: id, clusterId: clusterId ?? before.clusterId, before: before.ownerId, after: memberId });
    return findDocument(tx, id);
  });
}

/**
 * Where a file may go in a cluster: one of her folders (not «مدارس المشرفة» itself) or a folder of one of her schools.
 * Anything else is refused, so a file can never land in another member's school.
 */
export async function checkPlacement(db: Sql, clusterId: string, placement: DocumentPlacement): Promise<DocumentPlacement> {
  const schoolId = placement.schoolId || null;
  if (!isFileFolder(placement.folder, schoolId !== null)) throw new ApiError(422, "INVALID_FOLDER", "اختاري مجلداً من مجلدات ملف الإنجاز");
  if (schoolId) {
    const [school] = isUuid(schoolId) ? await db`select id from schools where id = ${schoolId} and cluster_id = ${clusterId} and deleted_at is null` : [];
    if (!school) throw notFound("المدرسة غير موجودة");
  }
  return { folder: placement.folder, schoolId };
}

/** Moves a file to another folder of its cluster (null = out of the folders). Null when the file has no cluster. */
export async function placeDocument(db: Sql, id: string, placement: DocumentPlacement | null, context?: AuditContext) {
  return atomically(db, async tx => {
    const before = await findDocument(tx, id);
    if (!before?.clusterId) return null;
    const target = placement ? await checkPlacement(tx, before.clusterId, placement) : { folder: null, schoolId: null };
    await tx`update attachments set folder = ${target.folder}, school_id = ${target.schoolId} where id = ${id}`;
    if (context) {
      await auditWith(tx, context, {
        action: "move", entity: "document", entityId: id, clusterId: before.clusterId,
        before: { folder: before.folder, schoolId: before.schoolId }, after: target,
      });
    }
    return findDocument(tx, id);
  });
}

/** Links chat uploads to the conversation they were sent in (only uploads not linked yet). */
export async function linkDocumentsToConversation(db: Sql, ids: string[], conversationId: string) {
  if (!ids.length) return;
  await db`update attachments set conversation_id = ${conversationId} where id = any(${db.array(ids)}::uuid[]) and conversation_id is null`;
}

/** Soft delete (main's convention); the bytes stay in Storage so the file can be restored. */
export async function deleteDocument(db: Sql, id: string, context?: AuditContext) {
  return atomically(db, async tx => {
    const document = await findDocument(tx, id);
    if (!document) return false;
    await tx`update attachments set deleted_at = now() where id = ${id}`;
    if (context) await auditWith(tx, context, { action: "delete", entity: "document", entityId: id, clusterId: document.clusterId, before: { name: document.name } });
    return true;
  });
}
