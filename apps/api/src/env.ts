import "./load-env.js";

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
  // Supabase secret key (sb_secret_…): server-only, used for Auth admin calls.
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  // Only for projects still on the legacy shared JWT secret; otherwise tokens are verified against the project's JWKS.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET?.trim() || null,
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  resendFrom: process.env.RESEND_FROM?.trim() || null,
  // Private Storage bucket for uploaded files (created on first use).
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "attachments",
  // The head's agent reads OPENAI_API_KEY / OPENAI_CHAT_MODEL first, then ANTHROPIC_* when it runs:
  // without a key it answers with the built-in Arabic engine.
};
