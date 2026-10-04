import { isIP } from "node:net";
import type { Context } from "hono";
import { ApiError } from "./errors.js";

// In-memory fixed-window counters for the public (unauthenticated) routes. One API instance per deployment today;
// with several instances each keeps its own counts, which still bounds abuse per instance.
const windows = new Map<string, { count: number; resetAt: number }>();

/** The caller's IP as the platform reports it (first x-forwarded-for hop), or "unknown". */
export function clientIp(c: Context) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return isIP(forwarded) ? forwarded : "unknown";
}

/** Counts one attempt for `key`; throws 429 once more than `limit` attempts happened within `windowMs`. */
export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  if (windows.size > 50_000) for (const [entry, value] of windows) if (value.resetAt <= now) windows.delete(entry);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > max) throw new ApiError(429, "TOO_MANY_ATTEMPTS", "محاولات كثيرة — انتظري قليلاً ثم أعيدي المحاولة");
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
