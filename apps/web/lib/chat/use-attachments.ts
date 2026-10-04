"use client";

import type { ChatAttachment } from "@rasd/schemas";
import { useCallback, useMemo, useState } from "react";
import { api } from "../api";

export type AttachmentUpload = {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  attachment?: ChatAttachment;
  error?: string;
};

let counter = 0;
const nextKey = () => `upload-${Date.now()}-${counter++}`;

/** Chat attachments: each file uploads as soon as it is picked, so sending only passes ids. */
export function useAttachments() {
  const [items, setItems] = useState<AttachmentUpload[]>([]);

  const patch = useCallback((key: string, change: Partial<AttachmentUpload>) => {
    setItems(list => list.map(item => item.key === key ? { ...item, ...change } : item));
  }, []);

  const add = useCallback((files: File[]) => {
    for (const file of files) {
      const key = nextKey();
      setItems(list => [...list, { key, name: file.name, size: file.size, status: "uploading" }]);
      api.upload<ChatAttachment[]>("/chat/attachments", [file])
        .then(([attachment]) => patch(key, { status: "ready", attachment }))
        .catch((error: Error) => patch(key, { status: "error", error: error.message }));
    }
  }, [patch]);

  const remove = useCallback((key: string) => setItems(list => list.filter(item => item.key !== key)), []);
  const clear = useCallback(() => setItems([]), []);

  /** Puts already-uploaded attachments back (after a failed send). */
  const restore = useCallback((attachments: ChatAttachment[]) => {
    setItems(attachments.map(attachment => ({ key: nextKey(), name: attachment.name, size: attachment.size, status: "ready", attachment })));
  }, []);

  const uploading = items.some(item => item.status === "uploading");
  const ready = useMemo(() => items.flatMap(item => item.status === "ready" && item.attachment ? [item.attachment] : []), [items]);

  return { items, add, remove, clear, restore, uploading, ready };
}
