// Shared API contracts between apps/api and apps/web.
// Type-only: import with `import type { ... } from "@rasd/schemas"`.

export type Role = "head" | "member";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  title: string; // الصفة
  clusterLabel: string;
};

// ---------- Auth ----------
export type AuthCheckResult = { exists: boolean; activated: boolean; name: string | null };
export type AuthSession = { token: string; expiresAt: string; user: PublicUser };

// ---------- Member workspace ----------
export type FieldKind = "text" | "phone" | "email" | "date" | "number";

export type ProfileField = {
  id: string; // stable ids for built-in fields (see DEFAULT_PROFILE_IDS), random for custom fields
  label: string;
  value: string;
  hint?: string; // placeholder / helper text shown under the input
  kind?: FieldKind;
  options?: string[]; // suggestions only — free text is always allowed
  derived?: boolean; // computed by the system (read-only)
  optional?: boolean; // nice-to-have: shown under "بيانات إضافية" and not counted in completion
  custom?: boolean; // added by a user (optional, not counted in completion)
  updatedAt?: string;
};

export type SchoolLeader = { id: string; role: string; state: string; fields: { id: string; label: string; value: string }[] };

export type School = {
  id: string;
  name: string;
  stage: string;
  area: string;
  ministryNo: string;
  email: string;
  educationType: string;
  specialEducation: string;
  hasGuard: string;
  classes: number;
  students: number;
  giftedClasses: number;
  giftedStudents: number;
  teachesChinese: string;
  teachers: number;
  admin: number;
  deputies: number;
  expert: number;
  advanced: number;
  tier: string; // تميز | تقدم | انطلاق | تهيئة | ""
  support: string;
  nafes: string;
  qudrat: number;
  tahsili: number;
  madrasati: number[]; // 6 values, see metricLabels
  discipline: number[]; // [daily, weekly, monthly]
  absence: boolean; // confirmed for absenceDate
  absenceDate?: string; // YYYY-MM-DD (Asia/Riyadh); absence counts only when it equals today
  principal: string;
  notes?: string;
  customFields?: { id: string; label: string; value: string }[];
  staffTiles?: { id: string; label: string; value: number }[];
  leadership?: SchoolLeader[];
  updatedAt?: string;
};

export type Program = { id: string; label: string; kind: string; count: number; url: string; status: string };
export type CustomSection = { id: string; label: string; fields: { id: string; label: string; value: string }[] };

export type Workspace = {
  userId: string;
  version: number; // optimistic concurrency — send back on PUT
  profile: ProfileField[];
  schools: School[];
  programs: Program[];
  sections: CustomSection[];
  submittedAt: string | null;
  updatedAt: string;
  completion: number; // 0..100, computed server-side
  missing: string[]; // human-readable list of what is still missing
};

// PUT /member/workspace and PUT /district/members/:id/workspace
export type WorkspaceSaveInput = {
  version: number;
  profile?: ProfileField[];
  schools?: School[];
  programs?: Program[];
  sections?: CustomSection[];
};

export type Visit = {
  id: string;
  userId: string;
  schoolId: string;
  schoolName: string;
  type: string;
  text: string;
  beneficiaries: number;
  sessions: number;
  blockers: string;
  createdAt: string;
};
export type VisitInput = { schoolId?: string; schoolName?: string; type: string; text: string; beneficiaries?: number; sessions?: number; blockers?: string };

// ---------- Documents ----------
export type DocumentKind = "spreadsheet" | "pdf" | "word" | "text" | "image" | "audio" | "other";
export type DocumentInfo = {
  id: string;
  ownerId: string | null; // the member this document belongs to (null = head's own / chat upload not yet assigned)
  ownerName: string | null;
  uploadedBy: string;
  uploadedByName: string;
  name: string;
  mime: string;
  size: number;
  kind: DocumentKind;
  status: "ready" | "failed";
  excerpt: string; // first ~280 chars of extracted text
  pages?: number;
  sheets?: string[];
  createdAt: string;
};

// ---------- Head: team ----------
export type MemberSummary = PublicUser & {
  initials: string;
  activated: boolean; // has chosen a password
  lastLoginAt: string | null;
  completion: number;
  missing: string[];
  schoolCount: number;
  studentCount: number;
  teacherCount: number;
  absenceDoneToday: number;
  visitCount: number;
  documentCount: number;
  programCount: number;
  submittedAt: string | null;
  lastActivityAt: string | null; // last time she edited her file, logged a visit or uploaded a file herself
  submittedToday: boolean; // "حدّثت اليوم": she did any of those (or pressed submit) today (Asia/Riyadh)
  workspaceUpdatedAt: string;
};

export type TeamStats = {
  members: number;
  activated: number;
  notActivated: number;
  submittedToday: number; // members who updated something today
  averageCompletion: number;
  completeProfiles: number; // completion >= 85
  schools: number;
  students: number;
  teachers: number;
  visits: number;
  documents: number;
};

export type TeamResponse = { members: MemberSummary[]; stats: TeamStats };

export type MemberDetail = MemberSummary & {
  workspace: Workspace;
  visits: Visit[];
  documents: DocumentInfo[];
};

export type MemberCreateInput = { name: string; email: string; title?: string; phone?: string; clusterLabel?: string };
export type MemberUpdateInput = Partial<{ name: string; email: string; title: string; phone: string; clusterLabel: string }>;

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
export type ChatStatus = { mode: "claude" | "local"; model: string | null };

// ---------- Envelope ----------
export type ApiOk<T> = { data: T; meta?: unknown };
export type ApiError = { error: { code: string; message: string; fields?: Record<string, string>; current?: unknown } };
