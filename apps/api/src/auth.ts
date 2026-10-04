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
  title: string;
  clusterId: string | null;
  clusterLabel: string;
};
export type AppEnv = { Variables: { actor: Actor; source: ChangeSource; ip: string | null } };

export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const issuer = `${env.supabaseUrl}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const legacySecret = env.supabaseJwtSecret ? new TextEncoder().encode(env.supabaseJwtSecret) : null;

/** Verifies a Supabase access token and returns the user id (`sub`) and when the token was issued (seconds). */
export async function verifyAccessToken(token: string) {
  const options = { issuer, audience: "authenticated" };
  const { payload } = legacySecret ? await jwtVerify(token, legacySecret, options) : await jwtVerify(token, jwks, options);
  if (!payload.sub) throw new Error("TOKEN_WITHOUT_SUBJECT");
  return { userId: payload.sub, issuedAt: typeof payload.iat === "number" ? payload.iat : 0 };
}

type ActorRow = Actor & { activatedAt: Date | null; sessionsValidAfter: Date | null };

export async function loadActor(userId: string): Promise<ActorRow | null> {
  const [row] = await sql`
    select p.id, p.role, p.district_id, p.name, p.email, p.phone, p.title, p.activated_at, p.sessions_valid_after,
      c.id as cluster_id, coalesce(c.label, '') as cluster_label
    from profiles p left join clusters c on c.member_id = p.id
    where p.id = ${userId}`;
  return row ? (row as ActorRow) : null;
}

export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let verified: { userId: string; issuedAt: number } | null = null;
  if (token) {
    try { verified = await verifyAccessToken(token); } catch { verified = null; }
  }
  if (!verified) return c.json(fail("UNAUTHENTICATED", "انتهت الجلسة أو لم يتم تسجيل الدخول"), 401);
  const row = await loadActor(verified.userId);
  if (!row) return c.json(fail("NO_PROFILE", "هذا الحساب غير مرتبط بمنصة رَصد"), 403);
  // A password reset ends every session that started before it.
  if (row.sessionsValidAfter && verified.issuedAt < Math.floor(row.sessionsValidAfter.getTime() / 1000)) {
    return c.json(fail("UNAUTHENTICATED", "انتهت الجلسة — سجّلي الدخول مرة أخرى"), 401);
  }
  // Signing in proves she has a password (first sign-in, an invitation or the recovery link), so the account is no longer claimable.
  if (!row.activatedAt) await sql`update profiles set activated_at = now(), activation_expires_at = null where id = ${row.id} and activated_at is null`;
  const { activatedAt: _activated, sessionsValidAfter: _sessions, ...actor } = row;
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
