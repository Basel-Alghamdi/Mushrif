import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { auditContext } from "../audit.js";
import { requireHead, requireMember, type Actor, type AppEnv } from "../auth.js";
import { sql } from "../db.js";
import {
  MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES, deleteDocument, documentsForCluster, documentsForDistrict, findDocument, getDocument,
  readDocumentFile, safeContentType, saveDocument, toDocumentInfo, type DocumentRow,
} from "../documents.js";
import { ApiError, fail, notFound, ok } from "../errors.js";
import { memberInDistrict } from "../ownership.js";

/** One upload request may carry several files, but never more than 100MB in total (it is read into memory). */
export const uploadLimit = bodyLimit({
  maxSize: 100 * 1024 * 1024,
  onError: c => c.json(fail("FILE_TOO_LARGE", "حجم الملفات في المرة الواحدة أكبر من ١٠٠ م.ب — ارفعيها على دفعات"), 413),
});

/** The files of a multipart request (field `files`; `files[]` and `file` also work): ≤ 20 files, ≤ 25MB each, read one at a time. */
export async function readUploads(c: Context<AppEnv>) {
  const form = await c.req.parseBody({ all: true }).catch(() => ({}) as Record<string, unknown>);
  const files = [form.files, form["files[]"], form.file].flat().filter((item): item is File => item instanceof File);
  if (!files.length) throw new ApiError(422, "NO_FILES", "اختاري ملفاً واحداً على الأقل");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new ApiError(413, "TOO_MANY_FILES", "يمكن رفع ٢٠ ملفاً كحد أقصى في المرة الواحدة");
  const tooBig = files.find(file => file.size > MAX_UPLOAD_BYTES);
  if (tooBig) throw new ApiError(413, "FILE_TOO_LARGE", `الملف «${tooBig.name}» أكبر من ٢٥ م.ب`);
  const uploads: { name: string; buffer: Buffer }[] = [];
  for (const file of files) uploads.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
  return uploads;
}

/** A file the user may see: a member her own cluster's files, the head any file in her district. Anything else is 404. */
export async function visibleDocument(actor: Actor, id: string) {
  const document = await findDocument(sql, id);
  const allowed = document && (actor.role === "head" ? document.districtId === actor.districtId : document.clusterId !== null && document.clusterId === actor.clusterId);
  if (!allowed) throw notFound("الملف غير موجود");
  return document;
}

const contentDisposition = (type: "inline" | "attachment", name: string) =>
  `${type}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Streams the stored bytes with a type chosen from the file name (never the uploader's), sandboxed. */
async function serveFile(document: DocumentRow, inline: boolean) {
  const contentType = safeContentType(document.name);
  const disposition = inline && contentType !== "application/octet-stream" ? "inline" : "attachment";
  return new Response(new Uint8Array(await readDocumentFile(document)), {
    headers: {
      "content-type": contentType,
      "content-disposition": contentDisposition(disposition, document.name),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
    },
  });
}

export function documentRoutes(app: Hono<AppEnv>) {
  // ───────── member: her files ─────────
  app.get("/cluster/me/documents", async c => {
    const actor = requireMember(c);
    return c.json(ok((await documentsForCluster(sql, actor.clusterId)).map(toDocumentInfo)));
  });

  app.post("/cluster/me/documents", uploadLimit, async c => {
    const actor = requireMember(c);
    const saved: DocumentRow[] = [];
    for (const file of await readUploads(c)) {
      saved.push(await saveDocument(sql, { districtId: actor.districtId, clusterId: actor.clusterId, uploadedBy: actor.id, ...file }, auditContext(c)));
    }
    return c.json(ok(saved.map(toDocumentInfo)), 201);
  });

  // ───────── head: the district's files ─────────
  app.get("/district/documents", async c => {
    const head = requireHead(c);
    return c.json(ok((await documentsForDistrict(sql, head.districtId)).map(toDocumentInfo)));
  });

  app.get("/district/members/:id/attachments", async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    return c.json(ok((await documentsForCluster(sql, clusterId)).map(toDocumentInfo)));
  });

  app.post("/district/members/:id/documents", uploadLimit, async c => {
    const head = requireHead(c);
    const clusterId = await memberInDistrict(sql, head, c.req.param("id"));
    const saved: DocumentRow[] = [];
    for (const file of await readUploads(c)) {
      saved.push(await saveDocument(sql, { districtId: head.districtId, clusterId, uploadedBy: head.id, ...file }, auditContext(c)));
    }
    return c.json(ok(saved.map(toDocumentInfo)), 201);
  });

  // ───────── any signed-in user, within what she may see ─────────
  app.get("/attachments/:id", async c => {
    const { id } = await visibleDocument(c.get("actor"), c.req.param("id"));
    const document = (await getDocument(sql, id))!;
    return c.json(ok({ ...toDocumentInfo(document), text: document.text.slice(0, 20_000) }));
  });
  app.get("/attachments/:id/download", async c => serveFile(await visibleDocument(c.get("actor"), c.req.param("id")), false));
  app.get("/attachments/:id/preview", async c => serveFile(await visibleDocument(c.get("actor"), c.req.param("id")), true));

  app.delete("/attachments/:id", async c => {
    const document = await visibleDocument(c.get("actor"), c.req.param("id"));
    await deleteDocument(sql, document.id, auditContext(c));
    return c.json(ok({ deleted: true }));
  });
}
