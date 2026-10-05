// The local stack: real PostgreSQL + the fake Supabase + main's migrations + the head (not activated) + a FICTIONAL team
// (src/test/roster.fixture.ts, through the real seed-roster script), and an env file for the API and `next dev`.
// Nothing here talks to a real Supabase project.
//
//   pnpm --filter @rasd/api stack:local            (keeps running until Ctrl+C)
//   STACK_DIR, STACK_PG_PORT, STACK_SUPABASE_PORT, STACK_API_PORT, STACK_WEB_PORT override the defaults.
//
// Then, in other terminals:  RASD_ENV_FILE=<STACK_DIR>/stack.env pnpm --filter @rasd/api dev
//                            RASD_ENV_FILE=<STACK_DIR>/stack.env pnpm --filter @rasd/web dev -p <web port>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testRoster } from "../roster.fixture.js";
import { startFakeSupabase } from "./fake-supabase.js";
import { startPostgres } from "./postgres.js";

const apiDir = fileURLToPath(new URL("../../../", import.meta.url));

/** The local head password (test data only): the head always gets hers at setup, like on the real project. */
export const LOCAL_HEAD_PASSWORD = "khulood-local-1";

export type StackOptions = {
  dir: string;
  pgPort: number;
  supabasePort: number;
  apiPort: number;
  webPort: number;
  /** false: the database is deleted when the stack stops (tests). Default true. */
  persistent?: boolean;
  /** Seed the fictional team (default true). */
  seedRoster?: boolean;
  log?: (line: string) => void;
};
export type Stack = { env: Record<string, string>; envFile: string; stop: () => Promise<void> };

/** Keys and the JWT secret survive restarts of a persistent stack, so browser sessions stay valid. */
function stackSecrets(dir: string) {
  const file = join(dir, "secrets.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as { jwtSecret: string; publishableKey: string; secretKey: string };
  const secrets = {
    jwtSecret: randomBytes(32).toString("base64url"),
    publishableKey: `sb_publishable_local_${randomBytes(12).toString("base64url")}`,
    secretKey: `sb_secret_local_${randomBytes(18).toString("base64url")}`,
  };
  writeFileSync(file, JSON.stringify(secrets, null, 2));
  return secrets;
}

const envLine = (key: string, value: string) => `${key}=${value === "" ? "" : `"${value.replace(/"/g, "'")}"`}`;

/** Runs one of apps/api/scripts with the stack's environment (it wins over anything inherited from the shell). */
function runScript(script: string, env: Record<string, string>) {
  return new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], { cwd: apiDir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", fail);
    child.on("exit", code => (code === 0 ? done(output.trim()) : fail(new Error(`${script} failed (exit ${code}):\n${output}`))));
  });
}

export async function startStack(options: StackOptions): Promise<Stack> {
  const log = options.log ?? (() => {});
  const dir = resolve(options.dir);
  mkdirSync(dir, { recursive: true });
  const secrets = stackSecrets(dir);
  const forward = (path: string) => path.replace(/\\/g, "/");

  const pg = await startPostgres({ dir, port: options.pgPort, persistent: options.persistent });
  let fake: Awaited<ReturnType<typeof startFakeSupabase>> | null = null;
  try {
    fake = await startFakeSupabase({ port: options.supabasePort, databaseUrl: pg.url, storageDir: join(dir, "storage"), ...secrets, log });
    const rosterFile = join(dir, "roster.json");
    writeFileSync(rosterFile, JSON.stringify(testRoster, null, 2));
    const webOrigin = `http://localhost:${options.webPort}`;
    const env: Record<string, string> = {
      DATABASE_URL: pg.url,
      DIRECT_DATABASE_URL: pg.url,
      DATABASE_POOL_SIZE: "5",
      SUPABASE_URL: fake.url,
      SUPABASE_SECRET_KEY: secrets.secretKey,
      SUPABASE_JWT_SECRET: secrets.jwtSecret,
      SUPABASE_STORAGE_BUCKET: "attachments",
      NEXT_PUBLIC_SUPABASE_URL: fake.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secrets.publishableKey,
      NEXT_PUBLIC_API_URL: "",
      API_PROXY_TARGET: `http://localhost:${options.apiPort}`,
      PORT: String(options.apiPort),
      APP_URL: webOrigin,
      CORS_ORIGINS: `${webOrigin},http://127.0.0.1:${options.webPort}`,
      TZ: "Asia/Riyadh",
      RESEND_API_KEY: "",
      RESEND_FROM: "",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENAI_CHAT_MODEL: "gpt-5",
      RASD_ADMIN_EMAIL: "khulood@example.com",
      RASD_ADMIN_NAME: "خلود",
      RASD_ADMIN_PASSWORD: LOCAL_HEAD_PASSWORD,
      RASD_DISTRICT_NAME: "النطاق الإشرافي",
      RASD_ROSTER_FILE: forward(rosterFile),
    };
    const envFile = join(dir, "stack.env");
    writeFileSync(envFile, [
      "# Local Rasd stack (pnpm --filter @rasd/api stack:local): embedded PostgreSQL + fake Supabase. Test data only.",
      "# Use as RASD_ENV_FILE for the API and for `next dev`. Never point production at these values.",
      ...Object.entries(env).map(([key, value]) => envLine(key, value)),
      "",
    ].join("\n"));

    const scriptEnv = { ...env, RASD_ENV_FILE: forward(envFile) };
    log(await runScript("scripts/migrate.ts", scriptEnv));
    log(await runScript("scripts/bootstrap-head.ts", scriptEnv));
    if (options.seedRoster !== false) log(await runScript("scripts/seed-roster.ts", scriptEnv));

    const running = fake;
    return {
      env: scriptEnv,
      envFile,
      stop: async () => {
        await running.stop().catch(() => {});
        await pg.stop().catch(() => {});
      },
    };
  } catch (error) {
    await fake?.stop().catch(() => {});
    await pg.stop().catch(() => {});
    throw error;
  }
}

// ───────── CLI: pnpm --filter @rasd/api stack:local ─────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const number = (name: string, fallback: number) => Number(process.env[name]?.trim() || fallback);
  const options: StackOptions = {
    dir: process.env.STACK_DIR?.trim() || join(apiDir, "data", "stack"),
    pgPort: number("STACK_PG_PORT", 54340),
    supabasePort: number("STACK_SUPABASE_PORT", 54341),
    apiPort: number("STACK_API_PORT", 4000),
    webPort: number("STACK_WEB_PORT", 3000),
    log: line => console.log(line),
  };
  const stack = await startStack(options);
  const envFile = stack.envFile.replace(/\\/g, "/");
  console.log(`
  Local stack is running (Ctrl+C to stop)
    PostgreSQL       ${stack.env.DATABASE_URL}
    Supabase (fake)  ${stack.env.SUPABASE_URL}
    Env file         ${envFile}
    Head             khulood@example.com — password ${LOCAL_HEAD_PASSWORD}
    Team             ${testRoster.length} fictional members (src/test/roster.fixture.ts), none activated

  Start the API:  RASD_ENV_FILE=${envFile} pnpm --filter @rasd/api dev        (port ${options.apiPort})
  Start the web:  RASD_ENV_FILE=${envFile} pnpm --filter @rasd/web dev -p ${options.webPort}
`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await stack.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
