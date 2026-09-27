import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Share the repo-root .env with the API in local development (NEXT_PUBLIC_* values are inlined at build time).
// Variables already in the environment (Railway) win; RASD_ENV_FILE points at a different file.
const envFile = process.env.RASD_ENV_FILE?.trim() || resolve(process.cwd(), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const nextConfig: NextConfig = {
  transpilePackages: ["@rasd/i18n", "@rasd/schemas"],
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};
export default nextConfig;
