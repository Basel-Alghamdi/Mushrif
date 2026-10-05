"use client";

import type { DocumentInfo, DocumentKind, DocumentPlacement } from "@rasd/schemas";
import { useState } from "react";
import { api, downloadFile, errorText } from "../../lib/api";
import { counted } from "../../lib/format";
import { FolderBrowser, type FolderLocation } from "../files/folder-browser";
import { useToast } from "./toast";

type Props = { memberId: string; documents: DocumentInfo[] | null; schools: { id: string; name: string }[]; error: string; onChanged: () => void };
const OPENABLE: DocumentKind[] = ["pdf", "image", "text"];
const FILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفاً" };

/**
 * Her ملف الإنجاز (GET /district/members/:id/attachments) as folders: open, add into a folder (POST …/documents),
 * move (PATCH /attachments/:id), delete (DELETE /attachments/:id).
 */
export function DocumentsTab({ memberId, documents, schools, error, onChanged }: Props) {
  const toast = useToast();
  const [location, setLocation] = useState<FolderLocation>({});
  const [openError, setOpenError] = useState("");

  const upload = async (files: File[], placement: DocumentPlacement) => {
    const saved = await api.upload<DocumentInfo[]>(`/district/members/${memberId}/documents`, files, { folder: placement.folder, schoolId: placement.schoolId ?? "" });
    toast(saved.length === 1 ? "رُفع الملف" : `رُفعت ${counted(saved.length, FILES)}`);
    onChanged();
  };

  const move = async (item: DocumentInfo, placement: DocumentPlacement) => {
    await api.patch(`/attachments/${item.id}`, placement);
    toast("نُقل الملف");
    onChanged();
  };

  const remove = async (item: DocumentInfo) => {
    await api.del(`/attachments/${item.id}`);
    toast("حُذف الملف");
    onChanged();
  };

  // Tap a file: open it when the browser can show it safely, otherwise download it.
  const open = (item: DocumentInfo) => {
    setOpenError("");
    downloadFile(`/attachments/${item.id}/download`, item.name, OPENABLE.includes(item.kind)).catch(reason => setOpenError(errorText(reason)));
  };

  return (
    <div className="mp-panel">
      {(openError || error) && <p className="field-error" role="alert">{openError || error}</p>}
      <FolderBrowser
        documents={error && documents === null ? [] : documents}
        schools={schools}
        location={location}
        onNavigate={setLocation}
        onUpload={upload}
        onMove={move}
        onRemove={remove}
        onOpen={open}
        noSchools={<p className="mp-note">لم تُضف مدارسها بعد. تظهر مجلدات كل مدرسة هنا بعد إضافتها.</p>}
      />
    </div>
  );
}
