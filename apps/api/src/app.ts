import type { ChatAttachment, ChatBlock, ChatSendInput, MemberCreateInput, MemberUpdateInput, VisitInput, WorkspaceSaveInput } from "@rasd/schemas";
import { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  Account, accountForToken, activateAccount, createMember, createSession, deleteMember, findAccountByEmail, findAccountById,
  passwordMatches, publicUser, resetPassword, revokeSession, setPassword, touchActivity, updateMember, updateOwnAccount,
} from "./accounts.js";
import { agentStatus, applyProposal, respond } from "./agent/index.js";
import {
  addMessage, createConversation, deleteConversation, findMessageWithProposal, getConversation, getProposal, listConversations,
  listMessages, renameConversation, resolveProposal, titleFrom, updateMessageBlocks,
} from "./chat-store.js";
import { cleanText } from "./db.js";
import {
  MAX_UPLOAD_BYTES, StoredDocument, deleteDocument, documentsForHead, documentsForOwner, getDocument, linkDocumentsToConversation,
  readDocumentFile, safeContentType, saveDocument, toDocumentInfo,
} from "./documents.js";
import { memberDetail, summarize, teamForHead } from "./team.js";
import { StaleWorkspaceError, createVisit, deleteVisit, getWorkspace, saveWorkspace, submitWorkspace, visitsForUser } from "./workspaces.js";

type AppEnv = { Variables: { authUser: Account; authToken: string } };
export const app = new Hono<AppEnv>();

const ok = (data: unknown, meta?: unknown) => ({ data, ...(meta ? { meta } : {}) });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ error: { code, message, ...extra } });
const deny = (status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422, code: string, message: string): never => {
  throw new HTTPException(status, { res: new Response(JSON.stringify(fail(code, message)), { status, headers: { "content-type": "application/json; charset=utf-8" } }) });
};

app.use("*", cors({ origin: origin => origin || "http://localhost:3000", allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], exposeHeaders: ["Content-Disposition"] }));
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json(fail("SERVER_ERROR", "حدث خطأ غير متوقع — أعيدي المحاولة"), 500);
});
app.get("/health", c => c.json({ status: "ok", service: "rasd-api", version: "v2" }));

const publicPaths = new Set(["/api/v1/auth/check", "/api/v1/auth/login", "/api/v1/auth/activate"]);
app.use("/api/v1/*", async (c, next) => {
  if (c.req.method === "OPTIONS" || publicPaths.has(c.req.path)) return next();
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? accountForToken(token) : null;
  if (!user) return c.json(fail("UNAUTHENTICATED", "انتهت الجلسة — سجّلي الدخول مرة أخرى"), 401);
  c.set("authUser", user);
  c.set("authToken", token);
  return next();
});

const requireHead = (c: Context<AppEnv>) => { const user = c.get("authUser"); if (user.role !== "head") deny(403, "FORBIDDEN", "هذه الصفحة لرئيسة النطاق فقط"); return user; };
const requireMember = (c: Context<AppEnv>) => { const user = c.get("authUser"); if (user.role !== "member") deny(403, "FORBIDDEN", "هذه الصفحة لعضوات الفريق"); return user; };
const body = async <T>(c: Context<AppEnv>) => (await c.req.json().catch(() => ({}))) as T;

function memberOfHead(head: Account, id: string) {
  const account = findAccountById(id);
  if (!account || account.role !== "member" || account.headId !== head.id) deny(404, "NOT_FOUND", "العضوة غير موجودة");
  return account!;
}

async function uploadedFiles(c: Context<AppEnv>) {
  const form = await c.req.parseBody({ all: true }).catch(() => ({} as Record<string, unknown>));
  const raw = [form.files, form["files[]"], form.file].flat().filter((item): item is File => item instanceof File);
  if (!raw.length) deny(422, "NO_FILES", "اختاري ملفاً واحداً على الأقل");
  if (raw.length > 20) deny(413, "TOO_MANY_FILES", "يمكن رفع ٢٠ ملفاً كحد أقصى في المرة الواحدة");
  const tooBig = raw.find(file => file.size > MAX_UPLOAD_BYTES);
  if (tooBig) deny(413, "FILE_TOO_LARGE", `الملف «${tooBig.name}» أكبر من ٢٥ م.ب`);
  return Promise.all(raw.map(async file => ({ name: file.name, mime: file.type, buffer: Buffer.from(await file.arrayBuffer()) })));
}

function saveWorkspaceOr409(c: Context<AppEnv>, account: Account, input: WorkspaceSaveInput) {
  try { return c.json(ok(saveWorkspace(account, input))); }
  catch (error) {
    if (error instanceof StaleWorkspaceError) return c.json(fail("STALE_WORKSPACE", "تم تحديث الملف من جهاز أو شخص آخر — حمّلنا أحدث نسخة", { current: error.current }), 409);
    throw error;
  }
}

// ---------- Auth ----------
app.post("/api/v1/auth/check", async c => {
  const { email } = await body<{ email?: string }>(c);
  const found = email ? findAccountByEmail(email) : null;
  return c.json(ok({ exists: Boolean(found), activated: Boolean(found?.passwordHash), name: found?.account.name ?? null }));
});

app.post("/api/v1/auth/login", async c => {
  const input = await body<{ email?: string; password?: string; remember?: boolean }>(c);
  const found = input.email ? findAccountByEmail(input.email) : null;
  if (!found) return c.json(fail("ACCOUNT_NOT_FOUND", "هذا البريد غير مسجّل في المنصة — تأكدي منه أو تواصلي مع رئيسة النطاق"), 404);
  if (!found.passwordHash) return c.json(fail("NOT_ACTIVATED", "هذه أول مرة تدخلين — اختاري كلمة مرور لحسابك"), 409);
  if (!input.password || !passwordMatches(input.password, found.passwordHash)) return c.json(fail("INVALID_CREDENTIALS", "كلمة المرور غير صحيحة"), 401);
  const session = createSession(found.account.id, input.remember !== false);
  return c.json(ok({ ...session, user: publicUser(found.account) }));
});

app.post("/api/v1/auth/activate", async c => {
  const input = await body<{ email?: string; password?: string }>(c);
  if (!input.password || input.password.length < 4) return c.json(fail("VALIDATION_ERROR", "اختاري كلمة مرور من ٤ أحرف أو أرقام على الأقل"), 422);
  try {
    const account = activateAccount(input.email ?? "", input.password);
    return c.json(ok({ ...createSession(account.id, true), user: publicUser(account) }), 201);
  } catch (error) {
    const code = (error as Error).message;
    if (code === "ACCOUNT_NOT_FOUND") return c.json(fail(code, "هذا البريد غير مسجّل في المنصة"), 404);
    if (code === "ALREADY_ACTIVATED") return c.json(fail(code, "الحساب مفعّل مسبقاً — ادخلي بكلمة المرور"), 409);
    throw error;
  }
});

app.get("/api/v1/auth/me", c => c.json(ok({ user: publicUser(c.get("authUser")) })));
app.patch("/api/v1/auth/me", async c => {
  const input = await body<{ name?: string; phone?: string }>(c);
  return c.json(ok({ user: publicUser(updateOwnAccount(c.get("authUser").id, input)) }));
});
app.post("/api/v1/auth/password", async c => {
  const input = await body<{ current?: string; next?: string }>(c);
  const user = c.get("authUser");
  const found = findAccountByEmail(user.email)!;
  if (found.passwordHash && !passwordMatches(input.current ?? "", found.passwordHash)) return c.json(fail("INVALID_CREDENTIALS", "كلمة المرور الحالية غير صحيحة"), 401);
  if (!input.next || input.next.length < 4) return c.json(fail("VALIDATION_ERROR", "اختاري كلمة مرور من ٤ أحرف أو أرقام على الأقل"), 422);
  setPassword(user.id, input.next);
  return c.json(ok({ changed: true }));
});
app.post("/api/v1/auth/logout", c => { revokeSession(c.get("authToken")); return c.json(ok({ loggedOut: true })); });

// ---------- Member ----------
app.get("/api/v1/member/workspace", c => c.json(ok(getWorkspace(requireMember(c)))));
app.put("/api/v1/member/workspace", async c => {
  const user = requireMember(c);
  const response = saveWorkspaceOr409(c, user, await body<WorkspaceSaveInput>(c));
  if (response.status === 200) touchActivity(user.id);
  return response;
});
app.post("/api/v1/member/submit", c => { const user = requireMember(c); touchActivity(user.id); return c.json(ok(submitWorkspace(user.id)), 201); });

app.get("/api/v1/member/visits", c => { const user = requireMember(c); return c.json(ok(visitsForUser(user.id, getWorkspace(user).schools))); });
app.post("/api/v1/member/visits", async c => {
  const user = requireMember(c);
  const input = await body<VisitInput>(c);
  if (!cleanText(input.text) && !cleanText(input.schoolName) && !input.schoolId) return c.json(fail("VALIDATION_ERROR", "اكتبي وصفاً مختصراً للزيارة"), 422);
  touchActivity(user.id);
  return c.json(ok(createVisit(user.id, input, getWorkspace(user).schools)), 201);
});
app.delete("/api/v1/member/visits/:id", c => deleteVisit(requireMember(c).id, c.req.param("id")) ? c.json(ok({ deleted: true })) : c.json(fail("NOT_FOUND", "الزيارة غير موجودة"), 404));

app.get("/api/v1/member/documents", c => c.json(ok(documentsForOwner(requireMember(c).id).map(toDocumentInfo))));
// One upload request may carry several files, but never more than 100MB in total (it is read into memory).
const uploadLimit = bodyLimit({ maxSize: 100 * 1024 * 1024, onError: c => c.json(fail("FILE_TOO_LARGE", "حجم الملفات في المرة الواحدة أكبر من ١٠٠ م.ب — ارفعيها على دفعات"), 413) });

app.post("/api/v1/member/documents", uploadLimit, async c => {
  const user = requireMember(c);
  const files = await uploadedFiles(c);
  const saved = [];
  for (const file of files) saved.push(await saveDocument({ ownerId: user.id, uploadedBy: user.id, ...file }));
  touchActivity(user.id);
  return c.json(ok(saved.map(toDocumentInfo)), 201);
});

// ---------- Documents (shared) ----------
function visibleDocument(c: Context<AppEnv>, id: string): StoredDocument {
  const user = c.get("authUser");
  const document = getDocument(id);
  const owner = document?.ownerId ? findAccountById(document.ownerId) : null;
  const allowed = document && (user.role === "head"
    ? document.uploadedBy === user.id || document.ownerId === user.id || owner?.headId === user.id
    : document.ownerId === user.id);
  if (!allowed) deny(404, "NOT_FOUND", "الملف غير موجود");
  return document!;
}

app.get("/api/v1/documents/:id", c => { const document = visibleDocument(c, c.req.param("id")); return c.json(ok({ ...toDocumentInfo(document), text: document.text.slice(0, 20000) })); });
app.get("/api/v1/documents/:id/download", c => {
  const document = visibleDocument(c, c.req.param("id"));
  return new Response(new Uint8Array(readDocumentFile(document)), { headers: {
    "content-type": safeContentType(document.name),
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
  } });
});
app.delete("/api/v1/documents/:id", c => { const document = visibleDocument(c, c.req.param("id")); deleteDocument(document.id); return c.json(ok({ deleted: true })); });

// ---------- Head: team ----------
app.get("/api/v1/district/team", c => c.json(ok(teamForHead(requireHead(c).id))));
app.post("/api/v1/district/members", async c => {
  const head = requireHead(c);
  const input = await body<MemberCreateInput>(c);
  try { return c.json(ok(summarize(createMember(head.id, input))), 201); }
  catch (error) {
    const code = (error as Error).message;
    if (code === "NAME_REQUIRED") return c.json(fail(code, "اكتبي اسم العضوة"), 422);
    if (code === "EMAIL_REQUIRED") return c.json(fail(code, "اكتبي بريد العضوة"), 422);
    if (code === "ACCOUNT_EXISTS") return c.json(fail(code, "يوجد حساب بهذا البريد بالفعل"), 409);
    throw error;
  }
});
app.get("/api/v1/district/members/:id", c => {
  const detail = memberDetail(requireHead(c).id, c.req.param("id"));
  return detail ? c.json(ok(detail)) : c.json(fail("NOT_FOUND", "العضوة غير موجودة"), 404);
});
app.patch("/api/v1/district/members/:id", async c => {
  const head = requireHead(c);
  const member = memberOfHead(head, c.req.param("id"));
  try { updateMember(member.id, await body<MemberUpdateInput>(c)); }
  catch (error) {
    const code = (error as Error).message;
    if (code === "ACCOUNT_EXISTS") return c.json(fail(code, "هذا البريد مستخدم لحساب آخر"), 409);
    if (code === "EMAIL_REQUIRED") return c.json(fail(code, "البريد مطلوب لتسجيل الدخول"), 422);
    throw error;
  }
  return c.json(ok(memberDetail(head.id, member.id)));
});
app.put("/api/v1/district/members/:id/workspace", async c => {
  const member = memberOfHead(requireHead(c), c.req.param("id"));
  return saveWorkspaceOr409(c, member, await body<WorkspaceSaveInput>(c));
});
app.post("/api/v1/district/members/:id/reset-password", c => { resetPassword(memberOfHead(requireHead(c), c.req.param("id")).id); return c.json(ok({ reset: true })); });
app.delete("/api/v1/district/members/:id", c => {
  const member = memberOfHead(requireHead(c), c.req.param("id"));
  for (const document of documentsForOwner(member.id)) deleteDocument(document.id);
  return c.json(ok({ deleted: deleteMember(member.id) }));
});
app.post("/api/v1/district/members/:id/documents", uploadLimit, async c => {
  const head = requireHead(c);
  const member = memberOfHead(head, c.req.param("id"));
  const saved = [];
  for (const file of await uploadedFiles(c)) saved.push(await saveDocument({ ownerId: member.id, uploadedBy: head.id, ...file }));
  return c.json(ok(saved.map(toDocumentInfo)), 201);
});
app.get("/api/v1/district/documents", c => c.json(ok(documentsForHead(requireHead(c).id).map(toDocumentInfo))));

// ---------- Head: chat with the agent ----------
app.get("/api/v1/chat/status", c => { requireHead(c); return c.json(ok(agentStatus())); });
app.get("/api/v1/chat/conversations", c => c.json(ok(listConversations(requireHead(c).id))));
app.post("/api/v1/chat/conversations", async c => { const head = requireHead(c); const { title } = await body<{ title?: string }>(c); return c.json(ok(createConversation(head.id, title)), 201); });
app.patch("/api/v1/chat/conversations/:id", async c => {
  const head = requireHead(c);
  const { title } = await body<{ title?: string }>(c);
  const conversation = renameConversation(head.id, c.req.param("id"), title ?? "");
  return conversation ? c.json(ok(conversation)) : c.json(fail("NOT_FOUND", "المحادثة غير موجودة"), 404);
});
app.delete("/api/v1/chat/conversations/:id", c => deleteConversation(requireHead(c).id, c.req.param("id")) ? c.json(ok({ deleted: true })) : c.json(fail("NOT_FOUND", "المحادثة غير موجودة"), 404));
app.get("/api/v1/chat/conversations/:id/messages", c => {
  const head = requireHead(c);
  const conversation = getConversation(head.id, c.req.param("id"));
  return conversation ? c.json(ok(listMessages(conversation.id))) : c.json(fail("NOT_FOUND", "المحادثة غير موجودة"), 404);
});

app.post("/api/v1/chat/attachments", uploadLimit, async c => {
  const head = requireHead(c);
  const saved: ChatAttachment[] = [];
  for (const file of await uploadedFiles(c)) {
    const document = await saveDocument({ ownerId: null, uploadedBy: head.id, ...file });
    saved.push({ id: document.id, name: document.name, kind: document.kind, size: document.size });
  }
  return c.json(ok(saved), 201);
});

app.post("/api/v1/chat/messages", async c => {
  const head = requireHead(c);
  const input = await body<ChatSendInput>(c);
  const text = String(input.text ?? "").trim();
  const attachments = (input.attachmentIds ?? []).map(id => getDocument(id)).filter((document): document is StoredDocument => Boolean(document && document.uploadedBy === head.id));
  if (!text && !attachments.length) return c.json(fail("VALIDATION_ERROR", "اكتبي سؤالك أو أرفقي ملفاً"), 422);

  let conversation = input.conversationId ? getConversation(head.id, input.conversationId) : null;
  if (input.conversationId && !conversation) return c.json(fail("NOT_FOUND", "المحادثة غير موجودة"), 404);
  const history = conversation ? listMessages(conversation.id) : [];
  const title = titleFrom(text, attachments.map(document => document.name));
  if (!conversation) conversation = createConversation(head.id, title);
  else if (!history.length && conversation.title === "محادثة جديدة") renameConversation(head.id, conversation.id, title);
  linkDocumentsToConversation(attachments.map(document => document.id), conversation.id);

  const userMessage = addMessage(conversation.id, { role: "user", text, attachments: attachments.map(document => ({ id: document.id, name: document.name, kind: document.kind, size: document.size })) });
  let reply: { text: string; blocks: ChatBlock[] };
  try { reply = await respond({ head, conversationId: conversation.id, history, attachments }, text); }
  catch (error) {
    console.error("agent failed", error);
    reply = { text: "عذراً، واجهت مشكلة أثناء تجهيز الرد. أعيدي المحاولة أو صيغي السؤال بطريقة أخرى.", blocks: [] };
  }
  const assistantMessage = addMessage(conversation.id, { role: "assistant", text: reply.text, blocks: reply.blocks });
  return c.json(ok({ conversation: getConversation(head.id, conversation.id), userMessage, assistantMessage }), 201);
});

function markProposalBlocks(proposalId: string, status: "applied" | "rejected", resultText: string) {
  const message = findMessageWithProposal(proposalId);
  if (!message) return;
  updateMessageBlocks(message.id, message.blocks.map(block => {
    if (block.type === "proposal" && block.proposalId === proposalId) return { ...block, status, resultText };
    if (block.type === "applied" && block.undoProposalId === proposalId) return { type: "applied", text: `${block.text} — ${status === "applied" ? "تم التراجع" : "أُبقي التغيير"}` };
    return block;
  }));
}

app.post("/api/v1/chat/proposals/:id/:action{apply|reject}", async c => {
  const head = requireHead(c);
  const proposal = getProposal(c.req.param("id"));
  if (!proposal || proposal.userId !== head.id) return c.json(fail("NOT_FOUND", "الاقتراح غير موجود"), 404);
  if (proposal.status !== "pending") return c.json(fail("ALREADY_RESOLVED", proposal.status === "applied" ? "تم تنفيذ هذا الاقتراح مسبقاً" : "تم إلغاء هذا الاقتراح"), 409);
  const conversationId = proposal.conversationId;
  if (c.req.param("action") === "reject") {
    resolveProposal(proposal.id, "rejected");
    markProposalBlocks(proposal.id, "rejected", "أُلغي — لم يتم تغيير أي بيانات");
    const assistantMessage = conversationId ? addMessage(conversationId, { role: "assistant", text: "تمام، ألغيت التغييرات ولم أعدّل أي بيانات." }) : null;
    return c.json(ok({ proposalId: proposal.id, status: "rejected", assistantMessage }));
  }
  const reply = await applyProposal(head, proposal);
  resolveProposal(proposal.id, "applied", reply.text);
  markProposalBlocks(proposal.id, "applied", reply.text);
  const assistantMessage = conversationId ? addMessage(conversationId, { role: "assistant", text: reply.text, blocks: reply.blocks }) : null;
  return c.json(ok({ proposalId: proposal.id, status: "applied", assistantMessage }));
});
