import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Share the repo-root .env with the API in local development (NEXT_PUBLIC_* values are inlined at build time).
// Variables already in the environment (Railway) win; RASD_ENV_FILE points at a different file.
const envFile = process.env.RASD_ENV_FILE?.trim() || resolve(process.cwd(), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// The browser calls the API on the same origin (/api/v1/...) and Next forwards it, so phones on the same
// network only need to reach the web app (and no CORS setup is needed). Set NEXT_PUBLIC_API_URL to call the API directly.
const apiTarget = (process.env.API_PROXY_TARGET?.trim() || "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@rasd/i18n", "@rasd/schemas"],
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiTarget}/api/v1/:path*` }];
  },
};

export default nextConfig;
