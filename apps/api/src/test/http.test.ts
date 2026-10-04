// The chat endpoints end to end through app.fetch: messages, attachments, proposal apply/reject, undo.
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { ChatAttachment, ChatBlock, ChatMessage, ChatSendResult, ChatStatus, ProposalResolveResult } from "@rasd/schemas";
import { setupFixture, xlsxBuffer } from "./fixture.js";

type Fixture = Awaited<ReturnType<typeof setupFixture>>;
let f: Fixture;
let app: (typeof import("../app.js"))["app"];
let token = "";

async function call<T>(method: string, path: string, body?: unknown, auth = token): Promise<{ status: number; data: T; error?: { code: string } }> {
  const headers: Record<string, string> = auth ? { authorization: `Bearer ${auth}` } : {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const response = await app.fetch(new Request(`http://rasd.test/api/v1${path}`, { method, headers, body: payload }));
  const json = await response.json() as { data: T; error?: { code: string } };
  return { status: response.status, data: json.data, error: json.error };
}

const proposalOf = (message: ChatMessage) => message.blocks.find((block): block is Extract<ChatBlock, { type: "proposal" }> => block.type === "proposal");

describe("chat over HTTP", () => {
  before(async () => {
    f = await setupFixture();
    ({ app } = await import("../app.js"));
    const session = await call<{ token: string }>("POST", "/auth/activate", { email: "khulood@rasd.local", password: "1234" }, "");
    assert.equal(session.status, 201);
    token = session.data.token;
  });

  test("status is the local engine without a key", async () => {
    const { data } = await call<ChatStatus>("GET", "/chat/status");
    assert.deepEqual(data, { mode: "local", model: null });
  });

  test("POST /chat/messages creates the conversation and answers from the data", async () => {
    const { status, data } = await call<ChatSendResult>("POST", "/chat/messages", { text: "الأرقام" });
    assert.equal(status, 201);
    assert.equal(data.conversation.title, "الأرقام");
    assert.equal(data.userMessage.text, "الأرقام");
    const stats = data.assistantMessage.blocks.find(block => block.type === "stats");
    assert.ok(stats && stats.type === "stats" && stats.items.some(item => item.label === "المشرفات" && item.value === 18));
    assert.equal("intent" in data.assistantMessage, false, "diagnostics never reach the client");

    const follow = await call<ChatSendResult>("POST", "/chat/messages", { conversationId: data.conversation.id, text: "ملف رشا" });
    assert.ok(follow.data.assistantMessage.blocks.some(block => block.type === "member"));
    const history = await call<ChatMessage[]>("GET", `/chat/conversations/${data.conversation.id}/messages`);
    assert.equal(history.data.length, 4);
  });

  test("an empty message is rejected; an unknown conversation is 404", async () => {
    assert.equal((await call("POST", "/chat/messages", { text: "  " })).status, 422);
    assert.equal((await call("POST", "/chat/messages", { conversationId: "nope", text: "مرحبا" })).status, 404);
  });

  test("attach a roster → proposal → apply rewrites the card and fills the profile → undo", async () => {
    const form = new FormData();
    const roster = xlsxBuffer({ Sheet1: [["الاسم", "البريد الإلكتروني", "رقم الجوال"], ["منيرة فهد عبدالرحمن الرويلي", "munira.member@example.com", "0555443322"]] });
    form.append("files", new File([new Uint8Array(roster)], "كشف.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const uploaded = await call<ChatAttachment[]>("POST", "/chat/attachments", form);
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.data[0].kind, "spreadsheet");

    const sent = await call<ChatSendResult>("POST", "/chat/messages", { text: "", attachmentIds: [uploaded.data[0].id] });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.userMessage.attachments[0].name, "كشف.xlsx");
    assert.equal(sent.data.conversation.title, "ملف: كشف.xlsx");
    const proposal = proposalOf(sent.data.assistantMessage);
    assert.ok(proposal, sent.data.assistantMessage.text);
    assert.equal(proposal.changes[0].after, "0555443322");

    const applied = await call<ProposalResolveResult>("POST", `/chat/proposals/${proposal.proposalId}/apply`);
    assert.equal(applied.status, 200);
    assert.equal(applied.data.status, "applied");
    assert.match(applied.data.assistantMessage.text, /تم ✅/);
    const phone = () => f.workspaces.getWorkspace(f.accounts.findAccountById(f.muneera.id)!).profile.find(field => field.id === "phone")?.value;
    assert.equal(phone(), "0555443322");

    const messages = await call<ChatMessage[]>("GET", `/chat/conversations/${sent.data.conversation.id}/messages`);
    const card = messages.data.map(proposalOf).find(Boolean);
    assert.equal(card?.status, "applied", "the original card now shows it was applied");
    assert.equal((await call("POST", `/chat/proposals/${proposal.proposalId}/apply`)).error?.code, "ALREADY_RESOLVED");

    const undoBlock = applied.data.assistantMessage.blocks.find(block => block.type === "applied");
    assert.ok(undoBlock && undoBlock.type === "applied" && undoBlock.undoProposalId);
    const undone = await call<ProposalResolveResult>("POST", `/chat/proposals/${undoBlock.undoProposalId}/apply`);
    assert.match(undone.data.assistantMessage.text, /تم التراجع/);
    assert.equal(phone(), "0509998877");
    const after = await call<ChatMessage[]>("GET", `/chat/conversations/${sent.data.conversation.id}/messages`);
    const marked = after.data.flatMap(message => message.blocks).find(block => block.type === "applied" && block.text.includes("تم التراجع"));
    assert.ok(marked, "the applied note records the undo");
  });

  test("reject leaves the data untouched", async () => {
    const form = new FormData();
    form.append("files", new File([new Uint8Array(xlsxBuffer({ Sheet1: [["الاسم", "الرتبة"], ["مها سالم محمد السبيعي", "خبير"]] }))], "رتب.xlsx"));
    const uploaded = await call<ChatAttachment[]>("POST", "/chat/attachments", form);
    const sent = await call<ChatSendResult>("POST", "/chat/messages", { text: "", attachmentIds: [uploaded.data[0].id] });
    const proposal = proposalOf(sent.data.assistantMessage)!;
    const rejected = await call<ProposalResolveResult>("POST", `/chat/proposals/${proposal.proposalId}/reject`);
    assert.equal(rejected.data.status, "rejected");
    assert.equal(f.workspaces.getWorkspace(f.accounts.findAccountById(f.maha.id)!).profile.find(field => field.id === "rank")?.value, "");
  });

  test("members cannot use the head's chat", async () => {
    const member = await call<{ token: string }>("POST", "/auth/login", { email: f.rasha.email, password: "1234" }, "");
    assert.equal((await call("POST", "/chat/messages", { text: "الأرقام" }, member.data.token)).status, 403);
  });
});
