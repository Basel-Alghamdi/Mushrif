// The head's chat over HTTP: conversations, messages (answered by the agent), attachments, proposal apply/reject.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatAttachment, ChatBlock, ChatMessage, ChatSendResult, Conversation, ProposalResolveResult } from "@rasd/schemas";
import { HEAD_EMAIL, startApi, type TestApi } from "./harness.js";

let api: TestApi;
let head = "";
let headId = "";
let districtId = "";
let conversation: Conversation;
let store: typeof import("../../chat-store.js");

async function proposalMessage(title: string) {
  const proposal = await store.createProposal(api.sql, { userId: headId, districtId, conversationId: conversation.id, kind: "profile_updates", payload: { title, summary: "تغيير واحد", changes: [] } });
  const block: ChatBlock = { type: "proposal", proposalId: proposal.id, title, summary: "تغيير واحد", status: "pending",
    changes: [{ memberId: headId, memberName: "رشا", fieldId: null, fieldLabel: "الجوال", before: "", after: "0555", source: "ملف.xlsx · الصف ٢" }] };
  const message = await store.addMessage(api.sql, conversation.id, { role: "assistant", text: "جهزت التغييرات", blocks: [block] });
  return { proposal, message };
}

describe("head chat", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
    const [row] = await api.sql`select id, district_id from profiles where email = ${HEAD_EMAIL}`;
    headId = String(row.id);
    districtId = String(row.districtId);
    store = await import("../../chat-store.js");
  });
  after(async () => { await api.stop(); });

  test("status, and only the head may chat", async () => {
    assert.deepEqual((await api.call("GET", "/chat/status", undefined, head)).data, { mode: "local", model: null });
    const member = await api.activate("rasha.member@example.com");
    assert.equal((await api.call("GET", "/chat/conversations", undefined, member)).status, 403);
    assert.equal((await api.call("POST", "/chat/messages", { text: "مرحبا" }, member)).status, 403);
  });

  test("sending without a conversation creates one titled after the message", async () => {
    const sent = await api.call<ChatSendResult>("POST", "/chat/messages", { text: "  كم مشرفة فعّلت حسابها؟  " }, head);
    assert.equal(sent.status, 201, JSON.stringify(sent.error));
    conversation = sent.data.conversation;
    assert.equal(conversation.title, "كم مشرفة فعّلت حسابها؟");
    assert.equal(sent.data.userMessage.role, "user");
    assert.equal(sent.data.userMessage.text, "كم مشرفة فعّلت حسابها؟");
    assert.equal(sent.data.assistantMessage.role, "assistant");
    assert.match(sent.data.assistantMessage.text, /من ١٨/, "the agent answers from the team's data");
    assert.ok(sent.data.assistantMessage.blocks.some(block => block.type === "table"), "with the list of members");
    assert.equal("intent" in sent.data.assistantMessage, false, "diagnostics never reach the client");
    assert.equal(sent.data.conversation.preview, sent.data.assistantMessage.text.replace(/\s+/g, " ").slice(0, 120));

    const follow = await api.call<ChatSendResult>("POST", "/chat/messages", { conversationId: conversation.id, text: "ومن لم تفعّل؟" }, head);
    assert.equal(follow.data.conversation.id, conversation.id);
    const messages = await api.call<ChatMessage[]>("GET", `/chat/conversations/${conversation.id}/messages`, undefined, head);
    assert.deepEqual(messages.data.map(message => message.role), ["user", "assistant", "user", "assistant"]);
    assert.equal((await api.call("POST", "/chat/messages", { text: "" }, head)).status, 422);
    assert.equal((await api.call("POST", "/chat/messages", { conversationId: "00000000-0000-0000-0000-000000000000", text: "x" }, head)).status, 404);
  });

  test("attachments are uploaded first, then sent by id and handed to the agent", async () => {
    const form = new FormData();
    form.append("files", new Blob(["الاسم,الجوال\nرشا,0555"], { type: "text/csv" }), "جوالات.csv");
    const uploaded = await api.call<ChatAttachment[]>("POST", "/chat/attachments", form, head);
    assert.equal(uploaded.status, 201);
    assert.deepEqual(Object.keys(uploaded.data[0]).sort(), ["id", "kind", "name", "size"]);
    assert.equal(uploaded.data[0].kind, "spreadsheet");
    const sent = await api.call<ChatSendResult>("POST", "/chat/messages", { text: "", attachmentIds: [uploaded.data[0].id, "not-an-id"] }, head);
    assert.equal(sent.status, 201);
    assert.equal(sent.data.conversation.title, "ملف: جوالات.csv");
    assert.deepEqual(sent.data.userMessage.attachments, uploaded.data);
    assert.match(sent.data.assistantMessage.text, /جوالات\.csv/, "the agent received the stored document");
    const [row] = await api.sql`select conversation_id, cluster_id, owner_type from attachments where id = ${uploaded.data[0].id}`;
    assert.equal(row.conversationId, sent.data.conversation.id);
    assert.equal(row.clusterId, null);
    assert.equal(row.ownerType, "chat");
  });

  test("conversations: create, list newest first, rename, delete", async () => {
    const created = await api.call<Conversation>("POST", "/chat/conversations", undefined, head);
    assert.equal(created.status, 201);
    assert.equal(created.data.title, "محادثة جديدة");
    const listed = await api.call<Conversation[]>("GET", "/chat/conversations", undefined, head);
    assert.equal(listed.data[0].id, created.data.id);
    assert.equal(listed.data.length, 3);
    const first = await api.call<ChatSendResult>("POST", "/chat/messages", { conversationId: created.data.id, text: "سؤال أول" }, head);
    assert.equal(first.data.conversation.title, "سؤال أول", "an empty new conversation takes its first message as title");
    const renamed = await api.call<Conversation>("PATCH", `/chat/conversations/${created.data.id}`, { title: "  تقرير الأسبوع " }, head);
    assert.equal(renamed.data.title, "تقرير الأسبوع");
    assert.equal((await api.call("DELETE", `/chat/conversations/${created.data.id}`, undefined, head)).status, 200);
    assert.equal((await api.call("GET", `/chat/conversations/${created.data.id}/messages`, undefined, head)).status, 404);
    assert.equal((await api.call("DELETE", `/chat/conversations/${created.data.id}`, undefined, head)).status, 404);
    const [{ count }] = await api.sql`select count(*)::int as count from chat_messages where conversation_id = ${created.data.id}`;
    assert.equal(count, 0);
  });

  test("applying a proposal rewrites its card and answers in the conversation", async () => {
    const { proposal, message } = await proposalMessage("تحديث الجوالات");
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.kind, "profile_updates");
    const applied = await api.call<ProposalResolveResult>("POST", `/chat/proposals/${proposal.id}/apply`, undefined, head);
    assert.equal(applied.status, 200, JSON.stringify(applied.error));
    assert.equal(applied.data.proposalId, proposal.id);
    assert.equal(applied.data.status, "applied");
    assert.equal(applied.data.assistantMessage.conversationId, conversation.id);
    const messages = (await api.call<ChatMessage[]>("GET", `/chat/conversations/${conversation.id}/messages`, undefined, head)).data;
    const card = messages.find(item => item.id === message.id)!.blocks[0];
    assert.equal(card.type === "proposal" && card.status, "applied");
    assert.equal(card.type === "proposal" && card.changes[0].source, "ملف.xlsx · الصف ٢", "block contents survive the round trip unchanged");
    assert.equal(messages.at(-1)!.id, applied.data.assistantMessage.id);
    const stored = await store.getProposal(api.sql, proposal.id);
    assert.equal(stored!.status, "applied");
    assert.ok(stored!.resolvedAt);
    const again = await api.call("POST", `/chat/proposals/${proposal.id}/apply`, undefined, head);
    assert.equal(again.status, 409);
    assert.equal(again.error?.code, "ALREADY_RESOLVED");
  });

  test("rejecting a proposal changes nothing and says so", async () => {
    const { proposal, message } = await proposalMessage("إضافة مدارس");
    const rejected = await api.call<ProposalResolveResult>("POST", `/chat/proposals/${proposal.id}/reject`, undefined, head);
    assert.equal(rejected.data.status, "rejected");
    assert.match(rejected.data.assistantMessage.text, /ألغيت/);
    const updated = await store.findMessageWithProposal(api.sql, proposal.id);
    assert.equal(updated!.id, message.id);
    const card = updated!.blocks[0];
    assert.equal(card.type === "proposal" && card.status, "rejected");
    assert.equal((await api.call("POST", `/chat/proposals/${proposal.id}/apply`, undefined, head)).status, 409);
    assert.equal((await api.call("POST", "/chat/proposals/00000000-0000-0000-0000-000000000000/apply", undefined, head)).status, 404);
    assert.equal((await api.call("POST", `/chat/proposals/${proposal.id}/approve`, undefined, head)).status, 404);
  });

  test("a claimed proposal cannot be applied twice at once", async () => {
    const { proposal } = await proposalMessage("مرتين");
    assert.equal(await store.claimProposal(api.sql, proposal.id), true);
    const busy = await api.call("POST", `/chat/proposals/${proposal.id}/apply`, undefined, head);
    assert.equal(busy.status, 409);
    await store.releaseProposal(api.sql, proposal.id);
    assert.equal((await api.call("POST", `/chat/proposals/${proposal.id}/apply`, undefined, head)).status, 200);
  });
});
