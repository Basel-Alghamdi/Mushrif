// A KPI sheet (مؤشرات الأداء) brought to the chat: the register's own import (POST /district/kpis/import) runs as a dry
// run and its result becomes a 'kpi_import' card; approving runs the same import for real — same file, options and
// names — with an undo for a day (an 'api_requests' card of its own).
import type { ChatBlock, KpiImportResult, ProposalChange } from "@rasd/schemas";
import type { Actor } from "../auth.js";
import { createProposal } from "../chat-store.js";
import { ApiError } from "../errors.js";
import { callInternal, currentHead, type InternalResult } from "../internal-api.js";
import type { ApiRequestsPayload } from "./api-actions.js";
import type { Session } from "./model.js";
import { proposalBlock, type AgentReply, type ProposalPayload } from "./proposals.js";
import { ar, count, NOUNS } from "./render.js";

export type KpiImportOptions = { mode?: "merge" | "replace"; year?: string };
export type KpiImportPayload = ProposalPayload & {
  kpiImport: { documentId: string; documentName: string; mode: "merge" | "replace"; year: string; sheets: string[]; names: Record<string, string> };
};

const REGISTER = { memberId: "", memberName: "سجل مؤشرات الأداء", fieldId: "kpi_import" };
const STATUS: Record<KpiImportResult["names"][number]["status"], string> = {
  matched: "طابق اسم مشرفة في الفريق", alias: "من اختيارك في استيراد سابق", chosen: "من اختيارك",
  ambiguous: "يطابق أكثر من مشرفة — حدّديها من صفحة مؤشرات الأداء", unknown: "لا يطابق أحداً في الفريق",
};

const importError = (result: InternalResult) =>
  new ApiError(result.status === 404 ? 404 : result.status === 409 ? 409 : 422, result.error?.code ?? "IMPORT_FAILED", result.error?.message ?? "تعذّر استيراد ملف المؤشرات");

/** «تُضاف ٢٠ · تُحدَّث ٥ · بلا تغيير ٣» before, «أُضيفت ٢٠ مدرسة، وحُدّثت ٥ مدارس، و٣ مدارس كما هي» after. */
function countsText(result: KpiImportResult, done = false) {
  const schools = (value: number) => count(value, NOUNS.school);
  const parts: [number, (value: number) => string][] = done
    ? [[result.added, value => `أُضيفت ${schools(value)}`], [result.updated, value => `حُدّثت ${schools(value)}`], [result.unchanged, value => `${schools(value)} كما هي`], [result.removed, value => `حُذفت ${schools(value)}`]]
    : [[result.added, value => `تُضاف ${ar(value)}`], [result.updated, value => `تُحدَّث ${ar(value)}`], [result.unchanged, value => `بلا تغيير ${ar(value)}`], [result.removed, value => `تُحذف ${ar(value)}`]];
  const shown = parts.filter(([value]) => value).map(([value, text]) => text(value));
  return shown.join(done ? "، و" : " · ") || (done ? "لم يتغير شيء" : "لا تغيير");
}

/** Rows of the card: what is removed first, then the sheets, the counts, rows left out, and whose schools each name gives. */
function cardRows(result: KpiImportResult): { rows: ProposalChange[]; pinned: number } {
  const removed: ProposalChange[] = result.removed ? [{
    ...REGISTER, fieldLabel: `تُحذف من سجل ${result.year ? `العام ${result.year}` : "المؤشرات"}`, after: "(تُحذف)", source: "استبدال سجل العام بهذا الملف",
    before: `${result.removedNames.slice(0, 15).join("، ")}${result.removedNames.length > 15 ? ` و${ar(result.removedNames.length - 15)} غيرها` : ""}`,
  }] : [];
  const sheets = result.sheets.map(sheet => ({ ...REGISTER, fieldLabel: `ورقة «${sheet.name}»`, before: "", after: sheet.included ? count(sheet.rows, NOUNS.school) : "لن تُستورد" }));
  const skipped: ProposalChange[] = result.skipped.length ? [{
    ...REGISTER, fieldLabel: `صفوف لن تُستورد (${ar(result.skipped.length)})`, before: "",
    after: result.skipped.slice(0, 3).map(item => `«${item.sheet}» الصف ${ar(item.row)}: ${item.reason}`).join("؛ "),
  }] : [];
  const names = result.names.map((item): ProposalChange => ({
    memberId: item.memberId ?? "", memberName: item.memberName ?? "بلا مشرفة", fieldId: REGISTER.fieldId,
    fieldLabel: `«${item.name}» في الملف — ${count(item.count, NOUNS.school)}`, before: "", after: item.memberName ?? "لن تُسند لأحد", source: STATUS[item.status],
  }));
  return { rows: [...removed, ...sheets, { ...REGISTER, fieldLabel: "المدارس", before: "", after: countsText(result) }, ...skipped, ...names], pinned: removed.length };
}

/** Runs the import as a dry run on a district document and stores its 'kpi_import' card. Throws ApiError when the file cannot be read as a register. */
export async function proposeKpiImport(session: Session, head: Actor, document: { id: string; name: string }, options: KpiImportOptions = {}) {
  const preview = await callInternal(head, "POST", "/district/kpis/import", { documentId: document.id, dryRun: true, ...options }, session.audit.ip ?? null);
  if (preview.status >= 400) throw importError(preview);
  const result = preview.data as KpiImportResult;
  const { rows, pinned } = cardRows(result);
  const counts = countsText(result);
  const payload: KpiImportPayload = {
    title: `استيراد مؤشرات الأداء من «${document.name}»`,
    summary: [result.year ? `العام ${result.year}` : "", result.mode === "replace" ? "استبدال سجل العام" : "", counts].filter(Boolean).join(" · "),
    rows, pinnedRows: pinned,
    kpiImport: {
      documentId: document.id, documentName: document.name, mode: result.mode, year: result.year,
      sheets: result.sheets.filter(sheet => sheet.included).map(sheet => sheet.name),
      // The names as the preview matched them, so approving files every school exactly where the card said.
      names: Object.fromEntries(result.names.filter(item => item.memberId && item.status !== "ambiguous").map(item => [item.name, item.memberId!])),
    },
  };
  const proposal = await createProposal(session.db, { userId: session.head.id, districtId: session.head.districtId, conversationId: session.conversationId, kind: "kpi_import", payload });
  return { block: proposalBlock(proposal.id, payload), result, text: `جهّزت استيراد «${document.name}» إلى سجل مؤشرات الأداء: ${counts}. راجعي البطاقة واعتمديها.` };
}

/** On approval: the same import, applied (one transaction in the API), then an undo she can use for a day. */
export async function executeKpiImport(session: Session, payload: KpiImportPayload): Promise<AgentReply> {
  const head = await currentHead(session.head.id);
  const { documentId, documentName, mode, year, sheets, names } = payload.kpiImport;
  const applied = await callInternal(head, "POST", "/district/kpis/import", { documentId, dryRun: false, mode, year, sheets, names }, session.audit.ip ?? null);
  if (applied.status >= 400) throw importError(applied);
  const result = applied.data as KpiImportResult;
  const blocks: ChatBlock[] = [];
  if (result.importId) {
    const undo: ApiRequestsPayload = {
      title: "تراجع", summary: "التراجع عن استيراد مؤشرات الأداء", isUndo: true, doneText: "تم التراجع ✅ أعدت سجل مؤشرات الأداء كما كان قبل الاستيراد.",
      actions: [{ route: "kpi_import_undo", params: { id: result.importId }, title: `التراجع عن استيراد «${documentName}»` }],
    };
    const proposal = await createProposal(session.db, { userId: session.head.id, districtId: session.head.districtId, conversationId: session.conversationId, kind: "api_requests", payload: undo });
    blocks.push({ type: "applied", text: `استيراد «${documentName}» إلى سجل مؤشرات الأداء`, undoProposalId: proposal.id });
  }
  return { text: `تم ✅ استوردت مؤشرات الأداء من «${documentName}»: ${countsText(result, true)}.`, blocks };
}
