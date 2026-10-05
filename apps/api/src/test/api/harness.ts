// Test harness: a throw-away local stack (embedded PostgreSQL + fake Supabase, migrated, head + fictional team seeded)
// and the API in-process through app.fetch. Call startApi() before anything imports the API modules.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { LOCAL_HEAD_PASSWORD, startStack } from "../support/stack.js";

export const HEAD_EMAIL = "khulood@example.com";
export const PASSWORD = "test-pass-1";

export async function freePort() {
  return new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

export function xlsxBuffer(sheets: Record<string, (string | number)[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

export type CallResult<T> = { status: number; data: T; error?: { code: string; message: string; fields?: Record<string, string> }; response: Response };

export async function startApi() {
  const dir = mkdtempSync(join(tmpdir(), "rasd-api-test-"));
  const [pgPort, supabasePort, apiPort, webPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
  const stack = await startStack({ dir, pgPort, supabasePort, apiPort, webPort, persistent: false });
  // The stack's values win over anything in the shell (and the repo-root .env is never read).
  Object.assign(process.env, stack.env, { OPENAI_API_KEY: "", OPENAI_CHAT_MODEL: "gpt-5", ANTHROPIC_API_KEY: "", RESEND_API_KEY: "" });
  const { app } = await import("../../app.js");
  const { sql } = await import("../../db.js");

  async function call<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<CallResult<T>> {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const response = await app.fetch(new Request(`http://rasd.test/api/v1${path}`, { method, headers, body: payload }));
    const json = (response.headers.get("content-type") ?? "").includes("json") ? await response.clone().json() as { data: T; error?: CallResult<T>["error"] } : null;
    return { status: response.status, data: json?.data as T, error: json?.error, response };
  }

  /** Signs in exactly like the web app: supabase-js against (fake) Supabase Auth. */
  async function signIn(email: string, password = PASSWORD) {
    const client = createClient(stack.env.SUPABASE_URL, stack.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
    return { token: data.session.access_token, client, session: data.session };
  }

  /** First sign-in: choose the password, then sign in. */
  async function activate(email: string, password = PASSWORD) {
    const result = await call("POST", "/public/auth/activate", { email, password });
    if (result.status !== 200) throw new Error(`activation failed for ${email}: ${JSON.stringify(result.error)}`);
    return (await signIn(email, password)).token;
  }

  /** The head signs in with the password she got at setup (heads never use first sign-in). */
  async function signInHead() {
    return (await signIn(HEAD_EMAIL, LOCAL_HEAD_PASSWORD)).token;
  }

  async function team(token: string) {
    return (await call<{ members: any[] }>("GET", "/district/team", undefined, token)).data.members;
  }

  async function stop() {
    await sql.end({ timeout: 2 });
    await stack.stop();
    rmSync(dir, { recursive: true, force: true });
  }

  return { app, sql, stack, call, signIn, signInHead, activate, team, stop };
}

export type TestApi = Awaited<ReturnType<typeof startApi>>;
