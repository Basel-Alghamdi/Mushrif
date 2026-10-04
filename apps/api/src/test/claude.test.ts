// The Claude brain without the network: request building, the manual tool loop, tool validation, and fallback.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaToolResultBlockParam, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatMessage } from "@rasd/schemas";
import { setupFixture } from "./fixture.js";

type Fixture = Awaited<ReturnType<typeof setupFixture>>;
let f: Fixture;
let claude: typeof import("../agent/claude.js");
let tools: typeof import("../agent/claude-tools.js");

function message(stop_reason: BetaMessage["stop_reason"], content: unknown[]): BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`, type: "message", role: "assistant", model: "claude-opus-5-5",
    content: content as BetaContentBlock[], stop_reason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  } as unknown as BetaMessage;
}
const text = (value: string) => ({ type: "text", text: value, citations: null });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

/** A scripted client: returns the given responses in order and records every request. */
function fakeClient(responses: (BetaMessage | Error)[]) {
  const requests: MessageCreateParamsNonStreaming[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: MessageCreateParamsNonStreaming) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error("no more scripted responses");
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
  return { client, requests };
}

const context = (history: ChatMessage[] = []) => ({ head: f.head, conversationId: f.chat.createConversation(f.head.id, "claude").id, history, attachments: [] });

describe("Claude brain", () => {
  before(async () => {
    f = await setupFixture();
    claude = await import("../agent/claude.js");
    tools = await import("../agent/claude-tools.js");
  });
  after(() => { claude.useClaudeClient(null); });

  test("the request uses the documented shape and nothing that 400s on this model", () => {
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_EFFORT;
    const request = claude.buildRequest([{ role: "user", content: "مرحبا" }]) as unknown as Record<string, unknown>;
    assert.equal(request.model, "claude-opus-5-5");
    assert.equal(request.max_tokens, 16000);
    assert.deepEqual(request.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(request.fallbacks, "default");
    assert.deepEqual(request.output_config, { effort: "medium" });
    const system = request.system as { type: string; text: string; cache_control: unknown }[];
    assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
    assert.match(system[0].text, /خلود/);
    assert.doesNotMatch(system[0].text, /\d{4}-\d{2}-\d{2}/, "no date in the cached system prompt");
    for (const banned of ["thinking", "temperature", "top_p", "top_k", "tool_choice", "budget_tokens"]) assert.equal(banned in request, false, banned);
    const toolParams = request.tools as { name: string; input_schema: { type: string } }[];
    assert.ok(toolParams.length >= 15);
    for (const tool of toolParams) assert.equal(tool.input_schema.type, "object", tool.name);
  });

  test("model and effort come from the environment (invalid effort falls back to medium)", () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    process.env.ANTHROPIC_EFFORT = "high";
    let request = claude.buildRequest([]);
    assert.equal(request.model, "claude-sonnet-5-5");
    assert.deepEqual(request.output_config, { effort: "high" });
    process.env.ANTHROPIC_EFFORT = "extreme";
    request = claude.buildRequest([]);
    assert.deepEqual(request.output_config, { effort: "medium" });
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_EFFORT;
  });

  test("history is rebuilt as text, starts with a user turn, and remembers earlier cards", () => {
    const at = new Date().toISOString();
    const history: ChatMessage[] = [
      { id: "0", conversationId: "c", role: "assistant", text: "تمام", blocks: [], attachments: [], createdAt: at },
      { id: "1", conversationId: "c", role: "user", text: "الأرقام", blocks: [], attachments: [], createdAt: at },
      { id: "2", conversationId: "c", role: "assistant", text: "تفضلي", blocks: [{ type: "stats", title: "أرقام الفريق", items: [{ label: "المشرفات", value: 18 }] }], attachments: [], createdAt: at },
    ];
    const messages = claude.historyMessages(history);
    assert.equal(messages[0].role, "user");
    assert.equal(messages.length, 2);
    assert.match(String(messages[1].content), /المشرفات: 18/);
    assert.equal(claude.historyMessages(Array.from({ length: 40 }, (_, i) => ({ ...history[1], id: String(i), role: i % 2 ? "assistant" : "user" }) as ChatMessage)).length, 24);
  });

  test("the user turn carries attachments (original PDF + text) and today's date", async () => {
    const pdf = await f.documents.saveDocument({ ownerId: null, uploadedBy: f.head.id, name: "تقرير.pdf", mime: "application/pdf", buffer: Buffer.from("%PDF-1.4 not really a pdf") });
    const turn = claude.userTurn("لخصي الملف", [pdf]);
    const content = turn.content as { type: string; text?: string; source?: { media_type: string } }[];
    assert.equal(content[0].type, "document");
    assert.equal(content[0].source?.media_type, "application/pdf");
    assert.match(content[1].text ?? "", new RegExp(`document_id=${pdf.id}`));
    assert.match(content.at(-1)!.text ?? "", /^اليوم: /);
    assert.match(content.at(-1)!.text ?? "", /لخصي الملف/);
  });

  test("tool loop: parallel tool calls come back in ONE user message, then UI blocks reach the reply", async () => {
    const { client, requests } = fakeClient([
      message("tool_use", [text("أجمع البيانات"), toolUse("t1", "team_overview", {}), toolUse("t2", "get_member", { member: "رشا" })]),
      message("tool_use", [toolUse("t3", "show_stats", { items: [{ label: "المشرفات", value: 18 }] }), toolUse("t4", "suggest_replies", { options: [{ label: "نواقص الفريق" }] })]),
      message("end_turn", [text("عندك **١٨ مشرفة**، وأعلى ملف لرشا القرني.")]),
    ]);
    const reply = await claude.claudeRespond(context(), "وش وضع الفريق؟", client);
    assert.equal(requests.length, 3);
    const second = requests[1].messages;
    assert.equal(second.at(-2)?.role, "assistant");
    const results = second.at(-1)!.content as BetaToolResultBlockParam[];
    assert.equal(second.at(-1)!.role, "user");
    assert.deepEqual(results.map(result => result.tool_use_id), ["t1", "t2"]);
    assert.ok(results.every(result => !result.is_error));
    const overview = JSON.parse(String(results[0].content));
    assert.equal(overview.stats.members, 18);
    const rasha = JSON.parse(String(results[1].content));
    assert.equal(rasha.email, "rasha.member@example.com");
    assert.equal(reply.text, "عندك **١٨ مشرفة**، وأعلى ملف لرشا القرني.");
    assert.deepEqual(reply.blocks.map(block => block.type), ["stats", "choices"]);
  });

  test("invalid tool input, unknown tools and ambiguous names come back as is_error results", async () => {
    const { client, requests } = fakeClient([
      message("tool_use", [toolUse("a", "get_member", {}), toolUse("b", "show_table", { columns: "x" }), toolUse("c", "no_such_tool", {}), toolUse("d", "get_member", { member: "فاطمة" })]),
      message("end_turn", [text("أي فاطمة تقصدين؟")]),
    ]);
    await claude.claudeRespond(context(), "ملف فاطمة", client);
    const results = requests[1].messages.at(-1)!.content as BetaToolResultBlockParam[];
    assert.deepEqual(results.map(result => result.is_error), [true, true, true, true]);
    assert.match(String(results[0].content), /Invalid input/);
    assert.match(String(results[2].content), /Unknown tool/);
    assert.match(String(results[3].content), /فاطمة عوض الدوسري/);
  });

  test("update_member_fields applies at once and attaches an undo", async () => {
    const { client } = fakeClient([
      message("tool_use", [toolUse("u", "update_member_fields", { member: "منيرة الرويلي", fields: [{ field: "الرتبة", value: "متقدم" }] })]),
      message("end_turn", [text("تم تحديث رتبة منيرة.")]),
    ]);
    const reply = await claude.claudeRespond(context(), "غيري رتبة منيرة إلى متقدم", client);
    const rank = f.workspaces.getWorkspace(f.accounts.findAccountById(f.muneera.id)!).profile.find(field => field.id === "rank")?.value;
    assert.equal(rank, "متقدم");
    const applied = reply.blocks.find(block => block.type === "applied");
    assert.ok(applied && applied.type === "applied" && applied.undoProposalId);
  });

  test("propose_profile_updates makes a pending proposal card", async () => {
    const result = tools.runTool("propose_profile_updates", { changes: [{ member: "مها السبيعي", field: "phone", value: "0561234567" }] }, { head: f.head, conversationId: "c", attachments: [], blocks: [] });
    assert.equal(result.isError, false);
    assert.equal(JSON.parse(result.content).created, true);
  });

  test("pause_turn resends, max_tokens answers with what it has, refusal is polite", async () => {
    const paused = fakeClient([message("pause_turn", [text("…")]), message("end_turn", [text("انتهيت")])]);
    assert.equal((await claude.claudeRespond(context(), "سؤال", paused.client)).text, "انتهيت");
    assert.equal(paused.requests[1].messages.at(-1)!.role, "assistant", "the paused turn is sent back as-is");

    const truncated = fakeClient([message("max_tokens", [text("جواب جزئي")])]);
    assert.equal((await claude.claudeRespond(context(), "سؤال", truncated.client)).text, "جواب جزئي");

    const refused = fakeClient([message("refusal", [])]);
    assert.match((await claude.claudeRespond(context(), "سؤال", refused.client)).text, /لا أستطيع/);
  });

  test("API errors fall back to the local engine with a one-line note; status reports claude", async () => {
    const { respond, agentStatus } = await import("../agent/index.js");
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      assert.deepEqual(agentStatus(), { mode: "claude", model: "claude-opus-5-5" });
      const cases: [Error, RegExp][] = [
        [new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers()), /مشغول/],
        [new Anthropic.AuthenticationError(401, { type: "error" }, "bad key", new Headers()), /غير صالح/],
        [new Anthropic.APIConnectionError({ message: "offline" }), /الاتصال/],
        [new Anthropic.InternalServerError(500, { type: "error" }, "boom", new Headers()), /خطأ في خدمة Claude/],
      ];
      for (const [error, note] of cases) {
        claude.useClaudeClient(fakeClient([error]).client);
        const reply = await respond(context(), "الأرقام");
        assert.ok(reply.blocks.some(block => block.type === "stats"), "the local engine answered");
        assert.match(reply.text, note);
      }
    } finally {
      process.env.ANTHROPIC_API_KEY = "";
      claude.useClaudeClient(null);
    }
  });
});
