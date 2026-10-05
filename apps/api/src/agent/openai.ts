import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseInput, ResponseInputContent } from "openai/resources/responses/responses";
import { sql } from "../db.js";
import { historyMessages, SYSTEM_PROMPT, userTurn } from "./claude.js";
import { runTool, toolContext, TOOL_PARAMS } from "./claude-tools.js";
import type { AgentContext, AgentReply } from "./index.js";
import { auditFileReads } from "./snapshot.js";

const setting = (name: string) => process.env[name]?.trim() || undefined;
export const openaiEnabled = () => Boolean(setting("OPENAI_API_KEY"));
export const openaiModel = () => setting("OPENAI_CHAT_MODEL") ?? "gpt-5";
export type OpenAIClient = { responses: { create: (params: ResponseCreateParamsNonStreaming) => Promise<Response> } };
let sharedClient: OpenAIClient | null = null;
export function useOpenAIClient(client: OpenAIClient | null) { sharedClient = client; }
function defaultClient(): OpenAIClient {
  if (!sharedClient) {
    const client = new OpenAI({ apiKey: setting("OPENAI_API_KEY"), maxRetries: 2, timeout: 120_000 });
    sharedClient = { responses: { create: params => client.responses.create(params) } };
  }
  return sharedClient;
}

export function buildRequest(input: ResponseInput): ResponseCreateParamsNonStreaming {
  return {
    model: openaiModel(), instructions: SYSTEM_PROMPT, input,
    max_output_tokens: 16000, reasoning: { effort: "medium" },
    store: false, include: ["reasoning.encrypted_content"],
    tools: TOOL_PARAMS.map(tool => ({
      type: "function", name: tool.name, description: tool.description,
      parameters: tool.input_schema, strict: false,
    })),
  };
}

/** Reuse the assistant's history and untrusted attachment wrappers across providers. */
export async function inputMessages(context: AgentContext, text: string): Promise<ResponseInput> {
  const input: ResponseInput = historyMessages(context.history).map(message => ({
    role: message.role, content: String(message.content),
  }));
  const turn = await userTurn(text, context.attachments);
  const content: ResponseInputContent[] = [];
  if (Array.isArray(turn.content)) for (const block of turn.content) {
    if (block.type === "text") content.push({ type: "input_text", text: block.text });
    if (block.type === "image" && block.source.type === "base64") content.push({
      type: "input_image", image_url: `data:${block.source.media_type};base64,${block.source.data}`, detail: "auto",
    });
    if (block.type === "document" && block.source.type === "base64") content.push({
      type: "input_file", filename: block.title || "attachment.pdf",
      file_data: `data:${block.source.media_type};base64,${block.source.data}`,
    });
  }
  input.push({ role: "user", content });
  return input;
}

export async function openaiRespond(context: AgentContext, text: string, client: OpenAIClient = defaultClient()): Promise<AgentReply> {
  const ctx = toolContext({ db: sql, head: context.head, audit: context.audit, conversationId: context.conversationId }, context.attachments);
  const input = await inputMessages(context, text);
  let answer = "";
  try {
    for (let round = 0; round < 8; round++) {
      const response = await client.responses.create(buildRequest(input));
      if (response.status === "failed") throw new Error(response.error?.message || "OpenAI response failed");
      const messages = response.output.filter(item => item.type === "message");
      if (messages.some(message => message.content.some(item => item.type === "refusal"))) {
        return { text: "عذراً، لا أستطيع المساعدة في هذا الطلب بالذات. جرّبي صياغته بطريقة أخرى.", blocks: ctx.blocks };
      }
      const outputText = messages.flatMap(message => message.content).filter(item => item.type === "output_text").map(item => item.text).join("\n").trim();
      answer = outputText || answer;
      const calls = response.output.filter(item => item.type === "function_call");
      if (!calls.length) break;
      // Retain reasoning items along with tool calls for GPT-5's next round.
      for (const item of response.output) {
        if (item.type === "message" || item.type === "reasoning" || item.type === "function_call") input.push(item);
      }
      for (const call of calls) {
        let argumentsValue: unknown;
        try { argumentsValue = JSON.parse(call.arguments); }
        catch {
          input.push({ type: "function_call_output", call_id: call.call_id, output: "Invalid tool arguments: expected JSON" });
          continue;
        }
        const result = await runTool(call.name, argumentsValue, ctx);
        input.push({ type: "function_call_output", call_id: call.call_id, output: result.content });
      }
    }
    return { text: answer || (ctx.blocks.length ? "تفضلي:" : "جمعت المعلومات لكن لم أكمل الرد — أعيدي السؤال بصيغة أقصر."), blocks: ctx.blocks };
  } finally {
    await auditFileReads(ctx.session, ctx.snapshots);
  }
}

export function openaiFallbackNote(error: unknown) {
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return "تنبيه: مفتاح OpenAI غير صالح أو لا يملك صلاحية، فأجبتك بالمحرك المدمج.";
  if (error instanceof OpenAI.RateLimitError) return "تنبيه: تم بلوغ حد استخدام OpenAI، فأجبتك بالمحرك المدمج.";
  if (error instanceof OpenAI.APIConnectionError) return "تنبيه: تعذّر الاتصال بـ OpenAI، فأجبتك بالمحرك المدمج.";
  return "تنبيه: تعذّر تشغيل OpenAI، فأجبتك بالمحرك المدمج.";
}
