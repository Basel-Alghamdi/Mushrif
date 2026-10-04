import type { Conversation, DocumentKind } from "@rasd/schemas";

/** Random id for new local items (crypto.randomUUID is missing on plain-http LAN addresses). */
export const newLocalId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Copies text to the clipboard (with a fallback for older mobile browsers). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

/** Normalises a Saudi mobile number for wa.me ("0551234567" → "966551234567"). Empty when unknown. */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("966")) return digits;
  if (digits.startsWith("05") && digits.length === 10) return `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) return `966${digits}`;
  return "";
}

export const whatsappLink = (text: string, phone = "") => `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`;

/** Western digits for numeric inputs typed with Arabic-Indic digits. */
export const toNumber = (value: string) => {
  const western = value.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٬,\s]/g, "");
  const parsed = Number(western);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Two-letter initials ("رشا خالد القرني" → "ر‌ق"). */
export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.[0] ?? "؟";
  const family = parts[parts.length - 1].replace(/^ال(?=..)/, "");
  return `${parts[0][0]}‌${family[0]}`;
}

export const kindLabel: Record<DocumentKind, string> = {
  spreadsheet: "جدول", pdf: "PDF", word: "Word", text: "نص", image: "صورة", audio: "صوت", other: "ملف",
};

export function guessKind(name: string): DocumentKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["xlsx", "xls", "xlsm", "csv", "tsv", "ods"].includes(ext)) return "spreadsheet";
  if (ext === "pdf") return "pdf";
  if (["docx", "doc", "odt", "rtf"].includes(ext)) return "word";
  if (["txt", "md", "json"].includes(ext)) return "text";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp"].includes(ext)) return "image";
  if (["mp3", "m4a", "wav", "ogg", "aac"].includes(ext)) return "audio";
  return "other";
}

export type ConversationGroup = { label: string; items: Conversation[] };

/** Groups conversations like ChatGPT: اليوم / أمس / آخر ٧ أيام / أقدم. */
export function groupConversations(list: Conversation[], now = new Date()): ConversationGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const edges = [startOfToday.getTime(), startOfToday.getTime() - day, startOfToday.getTime() - 6 * day];
  const groups: ConversationGroup[] = [
    { label: "اليوم", items: [] }, { label: "أمس", items: [] }, { label: "آخر ٧ أيام", items: [] }, { label: "أقدم", items: [] },
  ];
  for (const conversation of list) {
    const time = new Date(conversation.updatedAt).getTime();
    const index = edges.findIndex(edge => time >= edge);
    groups[index < 0 ? 3 : index].items.push(conversation);
  }
  return groups.filter(group => group.items.length);
}

/** Login message for a new or reminded member. */
export function loginMessage(name: string, email: string) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  const site = typeof window === "undefined" ? "" : `${window.location.origin}/login`;
  return [
    `أهلاً أ. ${first}،`,
    "تمت إضافتك في منصة رَصد لمتابعة أعمال الفريق.",
    "",
    `رابط الدخول: ${site}`,
    `بريدك: ${email}`,
    "أول مرة: اكتبي بريدك ثم اختاري كلمة مرور لحسابك، وبعدها أكملي ملفك.",
  ].join("\n");
}
