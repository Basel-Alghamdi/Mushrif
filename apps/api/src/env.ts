import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local development reads the repo-root .env; on Railway the variables come from the service settings.
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  appUrl,
  corsOrigins: (process.env.CORS_ORIGINS?.trim() || appUrl).split(",").map(origin => origin.trim()).filter(Boolean),
  databaseUrl: required("DATABASE_URL"),
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Only for projects still on the legacy shared JWT secret; otherwise tokens are verified against the project's JWKS.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET?.trim() || null,
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  resendFrom: process.env.RESEND_FROM?.trim() || null,
};
