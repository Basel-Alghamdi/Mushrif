import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  transpilePackages: ["@rasd/i18n"],
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};
export default nextConfig;
