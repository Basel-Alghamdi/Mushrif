import { isIP } from "node:net";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "./db.js";
import { env } from "./env.js";
import { fail, forbidden } from "./errors.js";

export type ChangeSource = "web" | "mobile" | "ingest" | "agent" | "system";
export type Actor = {
  id: string;
  role: "head" | "member";
  districtId: string;
  name: string;
  email: string;
  phone: string;
  clusterId: string | null;
  clusterLabel: string;
};
export type AppEnv = { Variables: { actor: Actor; source: ChangeSource; ip: string | null } };

export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const issuer = `${env.supabaseUrl}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const legacySecret = env.supabaseJwtSecret ? new TextEncoder().encode(env.supabaseJwtSecret) : null;

/** Verifies a Supabase access token and returns the user id (`sub`). */
export async function verifyAccessToken(token: string) {
  const options = { issuer, audience: "authenticated" };
  const { payload } = legacySecret ? await jwtVerify(token, legacySecret, options) : await jwtVerify(token, jwks, options);
  if (!payload.sub) throw new Error("TOKEN_WITHOUT_SUBJECT");
  return payload.sub;
}

export async function loadActor(userId: string): Promise<Actor | null> {
  const [row] = await sql`
    select p.id, p.role, p.district_id, p.name, p.email, p.phone, c.id as cluster_id, coalesce(c.label, '') as cluster_label
    from profiles p left join clusters c on c.member_id = p.id
    where p.id = ${userId}`;
  return row ? (row as Actor) : null;
}

export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let userId: string | null = null;
  if (token) {
    try { userId = await verifyAccessToken(token); } catch { userId = null; }
  }
  if (!userId) return c.json(fail("UNAUTHENTICATED", "انتهت الجلسة أو لم يتم تسجيل الدخول"), 401);
  const actor = await loadActor(userId);
  if (!actor) return c.json(fail("NO_PROFILE", "هذا الحساب غير مرتبط بمنصة رَصد"), 403);
  c.set("actor", actor);
  c.set("source", c.req.header("x-rasd-source") === "mobile" ? "mobile" : "web");
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  c.set("ip", isIP(forwarded) ? forwarded : null);
  await next();
});

export type MemberActor = Actor & { role: "member"; clusterId: string };

export function requireMember(c: Context<AppEnv>): MemberActor {
  const actor = c.get("actor");
  if (actor.role !== "member" || !actor.clusterId) throw forbidden("هذه العملية متاحة لعضوة الفريق على ملفها فقط");
  return actor as MemberActor;
}

export function requireHead(c: Context<AppEnv>): Actor {
  const actor = c.get("actor");
  if (actor.role !== "head") throw forbidden("هذه العملية متاحة لرئيسة النطاق فقط");
  return actor;
}
