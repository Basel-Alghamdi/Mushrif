import type { NextConfig } from "next";

// The browser always calls the API on the same origin (/api/v1/...), and Next proxies it to the API server.
// This keeps phones on the same Wi-Fi working: they only need to reach the web app.
const apiTarget = (process.env.API_PROXY_TARGET ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@rasd/i18n"],
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiTarget}/api/v1/:path*` }];
  },
};

export default nextConfig;
