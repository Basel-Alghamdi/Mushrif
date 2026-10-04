"use client";

import { ArrowUp, CircleAlert, Paperclip, X } from "lucide-react";
import { ClipboardEvent, KeyboardEvent, RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { guessKind, kindLabel } from "../../lib/chat/helpers";
import type { AttachmentUpload } from "../../lib/chat/use-attachments";
import { KindIcon } from "./blocks/shared";

export const ACCEPTED_FILES = ".xlsx,.xls,.xlsm,.csv,.docx,.doc,.pdf,.txt,image/*";
const MAX_HEIGHT = 8 * 24 + 20; // ~8 lines

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (key: string) => void;
  uploads: AttachmentUpload[];
  canSend: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export function Composer({ value, onChange, onSubmit, onFiles, onRemoveFile, uploads, canSend, textareaRef, fileInputRef }: Props) {
  const coarse = useRef(false);

  useEffect(() => { coarse.current = window.matchMedia("(pointer: coarse)").matches; }, []);

  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value, textareaRef]);

  // Desktop: Enter sends, Shift+Enter is a new line. Touch devices: Enter is a new line, the button sends.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || coarse.current) return;
    event.preventDefault();
    if (canSend) onSubmit();
  };

  // Pasted files become attachments — unless text came along too (Excel copies cells as text + a picture).
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length && !event.clipboardData.getData("text/plain")) {
      event.preventDefault();
      onFiles(files);
    }
  };

  return (
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); if (canSend) onSubmit(); }}>
      {uploads.length > 0 && (
        <ul className="composer-files" aria-label="الملفات المرفقة">
          {uploads.map(item => (
            <li key={item.key} className={`composer-file is-${item.status}`} title={item.error ?? item.name}>
              {item.status === "uploading" ? <span className="spinner" aria-label="جارٍ الرفع" /> : item.status === "error" ? <CircleAlert className="composer-file-error" /> : <KindIcon kind={item.attachment?.kind ?? guessKind(item.name)} />}
              <span className="composer-file-text">
                <b dir="auto">{item.name}</b>
                <small>{item.status === "uploading" ? "جارٍ الرفع…" : item.status === "error" ? item.error ?? "تعذّر الرفع" : kindLabel[item.attachment?.kind ?? guessKind(item.name)]}</small>
              </span>
              <button type="button" onClick={() => onRemoveFile(item.key)} aria-label={`إزالة ${item.name}`}><X /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor="chat-input">رسالتك للمساعد</label>
      <textarea
        id="chat-input"
        ref={textareaRef}
        className="composer-input"
        rows={1}
        value={value}
        placeholder="اسألي عن أي مشرفة أو رقم… أو أرفقي ملفاً"
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        dir="auto"
        enterKeyHint="enter"
      />
      <div className="composer-bar">
        <button type="button" className="composer-attach" onClick={() => fileInputRef.current?.click()} aria-label="إرفاق ملف" title="إرفاق ملف (Excel، Word، PDF، صور)">
          <Paperclip />
          <span>إرفاق ملف</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          hidden
          onChange={event => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}
        />
        <button type="submit" className="composer-send" disabled={!canSend} aria-label="إرسال">
          <ArrowUp />
        </button>
      </div>
    </form>
  );
}
