"use client";

import type { ReminderSendInput, ReminderSendResult } from "@rasd/schemas";
import { useState } from "react";
import { api, errorText } from "./api";
import { counted } from "./format";

const MEMBERS = { one: "مشرفة واحدة", two: "مشرفتين", few: "مشرفات", many: "مشرفة" };

/** POST /district/reminders: each member gets her own message by email (when the platform's email is set up) and in the app. */
export const sendMessages = (input: ReminderSendInput) => api.post<ReminderSendResult>("/district/reminders", input);

/** What happened, in one line: emailed, or why only the in-app notification went out. */
export function sentLine(result: ReminderSendResult) {
  if (result.emailed === result.sent) return result.sent === 1 ? "أُرسلت إلى بريدها ✓" : `أُرسلت إلى بريد ${counted(result.sent, MEMBERS)} ✓`;
  if (!result.emailConfigured) return "البريد غير مفعّل في المنصة بعد — وصلها تنبيه داخل المنصة فقط";
  return "تعذّر الإرسال بالبريد — وصلها تنبيه داخل المنصة فقط. أعيدي المحاولة لاحقاً";
}

export type SendStatus = "idle" | "sending" | "sent" | "warn" | "error";

/** One send button's state: «sent» locks it (no double emails); «warn»/«error» let her try again. */
export function useSendMessages() {
  const [status, setStatus] = useState<SendStatus>("idle");
  const [note, setNote] = useState("");
  const send = async (input: ReminderSendInput) => {
    if (status === "sending" || status === "sent") return null;
    setStatus("sending");
    setNote("");
    try {
      const result = await sendMessages(input);
      setStatus(result.emailed === result.sent ? "sent" : "warn");
      setNote(sentLine(result));
      return result;
    } catch (error) {
      setStatus("error");
      setNote(errorText(error));
      return null;
    }
  };
  return { status, note, send, busy: status === "sending" };
}
