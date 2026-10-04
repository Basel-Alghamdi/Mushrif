import type { DocumentKind } from "@rasd/schemas";
import { File, FileAudio, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { ar } from "../../../lib/format";

const KIND_ICONS = { spreadsheet: FileSpreadsheet, pdf: FileText, word: FileText, text: FileText, image: FileImage, audio: FileAudio, other: File };

export function KindIcon({ kind }: { kind: DocumentKind }) {
  const Icon = KIND_ICONS[kind] ?? File;
  return <span className={`kind-icon kind-${kind}`} aria-hidden><Icon /></span>;
}

/** Digits (Western or Arabic-Indic) with separators, signs and %: "٢٣٪", "1,200", "3/18". */
export const isNumeric = (value: string) => /^[\d٠-٩\s.,٫٬%٪+\-/:]+$/.test(value) && /[\d٠-٩]/.test(value);

/** Numbers (and purely numeric strings) in Arabic-Indic digits; other text untouched (emails, names). */
export function formatCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return ar(value);
  return isNumeric(value) ? ar(value).replace(/%/g, "٪") : value;
}
