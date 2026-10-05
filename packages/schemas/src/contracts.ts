// API contracts for the head's agent chat, stored documents and accounts (type-only).
// Import with `import type { ... } from "@rasd/schemas"`. Cluster-file shapes (workspace, schools, profile fields,
// member summaries) are defined by the API (apps/api/src/workspace.ts) and mirrored in apps/web/lib/types.ts.

// ---------- Accounts ----------
// POST /public/auth/check
// No name: an address alone must not reveal who it belongs to.
export type AuthCheckResult = { exists: boolean; activated: boolean };
// POST /district/members (and the agent's new_members proposals)
export type MemberCreateInput = { name: string; email: string; title?: string; phone?: string; clusterLabel?: string };

// ---------- Documents ----------
export type DocumentKind = "spreadsheet" | "pdf" | "word" | "text" | "image" | "audio" | "other";
export type DocumentInfo = {
  id: string;
  ownerId: string | null; // the member whose file this is (null = a chat upload not filed yet)
  ownerName: string | null;
  uploadedBy: string;
  uploadedByName: string;
  name: string;
  mime: string;
  size: number;
  kind: DocumentKind;
  status: "ready" | "failed"; // whether text/tables could be read from it
  excerpt: string; // first ~280 chars of extracted text
  pages?: number;
  sheets?: string[];
  createdAt: string;
};

// ---------- Chat (head's agent) ----------
export type ChatTone = "ok" | "warn" | "bad" | "neutral";

export type ChatBlock =
  | { type: "stats"; title?: string; items: { label: string; value: string | number; hint?: string; tone?: ChatTone }[] }
  // memberIds[i] (when present) makes row i clickable → member profile
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; memberIds?: (string | null)[] }
  | { type: "member"; memberId: string; name: string; title: string; email: string; phone: string; activated: boolean; completion: number; missing: string[]; fields: { label: string; value: string }[]; schools: { name: string; stage: string; students: number; teachers: number; tier: string }[]; documents: { id: string; name: string; kind: DocumentKind; createdAt: string }[] }
  // quick replies — clicking an option sends `message` as Khulood's next message
  | { type: "choices"; prompt?: string; options: { label: string; message: string }[] }
  | { type: "proposal"; proposalId: string; title: string; summary: string; changes: ProposalChange[]; newMembers?: MemberCreateInput[]; unmatched?: string[]; status: ProposalStatus; resultText?: string }
  // copyable text — reminders, WhatsApp messages, report paragraphs
  | { type: "copy"; title: string; text: string }
  | { type: "documents"; title?: string; items: { id: string; name: string; kind: DocumentKind; ownerName: string | null; createdAt: string; snippet?: string }[] }
  // a change the agent already applied — offers an undo
  | { type: "applied"; text: string; undoProposalId?: string };

export type ProposalStatus = "pending" | "applied" | "rejected";
export type ProposalChange = {
  memberId: string;
  memberName: string;
  fieldId: string | null; // existing profile field id, or null to create a new field with fieldLabel
  fieldLabel: string;
  before: string;
  after: string;
  source?: string; // e.g. "الملف.xlsx · الصف ٤"
};

export type ChatAttachment = { id: string; name: string; kind: DocumentKind; size: number };

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string; // markdown-lite: **bold**, - lists, 1. lists, ## headings, | tables |, `code`
  blocks: ChatBlock[];
  attachments: ChatAttachment[];
  createdAt: string;
};

export type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; preview: string };

export type ChatSendInput = { conversationId?: string | null; text: string; attachmentIds?: string[] };
export type ChatSendResult = { conversation: Conversation; userMessage: ChatMessage; assistantMessage: ChatMessage };
export type ProposalResolveResult = { proposalId: string; status: ProposalStatus; assistantMessage: ChatMessage };
export type ChatStatus = { mode: "openai" | "claude" | "local"; model: string | null };

// ---------- Envelope ----------
export type ApiOk<T> = { data: T; meta?: unknown };
export type ApiError = { error: { code: string; message: string; fields?: Record<string, string>; details?: unknown } };
