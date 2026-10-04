import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load apps/api/.env (if present) before anything reads process.env.
// Values still holding a "PASTE_..." placeholder are treated as unset.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* malformed .env: keep process env as-is */ }
}

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("PASTE_")) return undefined;
  return value;
}
