"use client";

import type { DocumentInfo, DocumentPlacement } from "@rasd/schemas";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FolderBrowser, type FolderLocation } from "../../../components/files/folder-browser";
import { useActions } from "../../../components/member/actions";
import { useMember } from "../../../components/member/context";
import { downloadFile, errorText } from "../../../lib/api";

/** ملفاتي: her ملف الإنجاز. The open folder lives in the address (?f=folder&s=school) so back and links work. */
export default function FilesPage() {
  return (
    <div className="m-page">
      <h1>ملفاتي</h1>
      <Suspense fallback={null}><Files /></Suspense>
    </div>
  );
}

function Files() {
  const { ws, documents, notify } = useMember();
  const { uploadDocument, moveDocument, removeDocument } = useActions();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/cluster/files";
  const location: FolderLocation = { folder: params.get("f") || undefined, schoolId: params.get("s") || undefined };

  const navigate = (to: FolderLocation) => {
    const query = new URLSearchParams();
    if (to.schoolId) query.set("s", to.schoolId);
    if (to.folder) query.set("f", to.folder);
    const search = query.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
    window.scrollTo({ top: 0 });
  };

  const upload = async (files: File[], placement: DocumentPlacement) => {
    let done = 0;
    for (const file of files) {
      await uploadDocument(file, placement);
      done += 1;
    }
    if (done) notify(done === 1 ? "رُفع الملف" : "رُفعت الملفات");
  };

  const open = (document: DocumentInfo) =>
    downloadFile(`/attachments/${document.id}/download`, document.name, true).catch(error => notify(errorText(error), { tone: "error" }));

  return (
    <FolderBrowser
      documents={documents}
      schools={ws.schools}
      location={location}
      onNavigate={navigate}
      onUpload={upload}
      onMove={moveDocument}
      onRemove={removeDocument}
      onOpen={open}
      noSchools={<p className="m-lead">أضيفي مدارسك من <Link href="/cluster/schools" className="m-link">مدارسي</Link> لتظهر مجلداتها هنا.</p>}
    />
  );
}
