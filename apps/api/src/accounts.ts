import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { DEFAULT_PLANS, DEFAULT_PROFILE_FIELDS, toWesternDigits, validators, type MemberCreateInput } from "@rasd/schemas";
import { auditWith, type AuditContext } from "./audit.js";
import { supabaseAdmin } from "./auth.js";
import { atomically, type Sql } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { cleanText, normalizeEmail } from "./parse.js";

/** Minimum password length (main's rule; above Supabase Auth's default of 6). */
export const MIN_PASSWORD = 8;

/** A new account can be claimed at first sign-in for this long; afterwards the head resets it to open a new window. */
export const ACTIVATION_DAYS = 14;
export const activationDeadline = (days = ACTIVATION_DAYS) => new Date(Date.now() + days * 86_400_000);

/** Marks sign-in accounts created by Rasd, so an unrelated identity in the same Supabase project is never adopted. */
const RASD_MARKER = { rasd: true };

/** A password nobody knows: the account exists, and its owner chooses her own at first sign-in. */
export const randomPassword = () => randomBytes(24).toString("base64url");

export async function findAuthUserByEmail(email: string): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find(item => item.email?.toLowerCase() === email);
    if (user || data.users.length < 1000) return user ?? null;
  }
}

/** Creates the member's profile and cluster with the built-in profile fields and the five plans. */
export async function seedMember(db: Sql, input: {
  userId: string; districtId: string; name: string; email: string; phone: string; clusterLabel: string;
  title?: string; activated?: boolean;
}) {
  const title = input.title ?? "";
  await db`insert into profiles ${db({
    id: input.userId, districtId: input.districtId, role: "member", name: input.name, email: input.email, phone: input.phone,
    title, activatedAt: input.activated ? new Date() : null, activationExpiresAt: input.activated ? null : activationDeadline(),
  })}`;
  const [cluster] = await db`insert into clusters ${db({ districtId: input.districtId, memberId: input.userId, label: input.clusterLabel })} returning id`;
  // البريد الوزاري is prefilled only when she signs in with her ministry address, never with a personal one.
  const ministryEmail = /@moe\.gov\.sa$/i.test(input.email) ? input.email : "";
  const prefilled: Record<string, string> = { fullName: input.name, title, email: ministryEmail, phone: input.phone };
  for (const [index, field] of DEFAULT_PROFILE_FIELDS.entries()) {
    await db`insert into profile_fields ${db({
      clusterId: cluster.id, fieldKey: field.key, label: field.label, value: prefilled[field.key] || field.value || "",
      span: field.span, fieldType: field.type, options: field.options ?? [], sortOrder: index,
    })}`;
  }
  for (const [index, plan] of DEFAULT_PLANS.entries()) {
    await db`insert into plans ${db({ clusterId: cluster.id, kind: plan.kind, label: plan.label, sortOrder: index })}`;
  }
  return String(cluster.id);
}

/** Normalizes and checks a new member's details (only the name and an address with "@" are required). */
export function parseMemberInput(body: Record<string, unknown>): MemberCreateInput {
  const text = (value: unknown, max: number) => cleanText(typeof value === "string" || typeof value === "number" ? value : "").slice(0, max);
  const input = {
    name: text(body.name, 200), email: normalizeEmail(typeof body.email === "string" ? body.email : ""), title: text(body.title, 200),
    phone: toWesternDigits(text(body.phone, 40)), clusterLabel: text(body.clusterLabel, 200),
  };
  const fields: Record<string, string> = {};
  if (!input.name) fields.name = "اكتبي اسم العضوة";
  const emailError = validators.loginEmail(input.email);
  if (emailError) fields.email = emailError;
  if (Object.keys(fields).length) throw invalid(fields, "أكملي بيانات العضوة");
  return input;
}

/**
 * Creates a member account without an invitation (decision 3): a confirmed Supabase user with a random password,
 * then her profile and cluster (seedMember) — not activated, so she chooses her password at first sign-in.
 * The auth user is removed again if the database part fails. Used by POST /district/members, seed:roster and the agent.
 */
export async function createMemberAccount(db: Sql, input: MemberCreateInput & { districtId: string }, context?: AuditContext) {
  const member = parseMemberInput(input as unknown as Record<string, unknown>);
  const [taken] = await db`select id from profiles where email = ${member.email}`;
  if (taken) throw new ApiError(409, "ACCOUNT_EXISTS", "يوجد حساب بهذا البريد بالفعل", { email: "يوجد حساب بهذا البريد بالفعل" });

  let userId: string;
  let createdHere = true;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: member.email, email_confirm: true, password: randomPassword(), user_metadata: { name: member.name }, app_metadata: RASD_MARKER,
  });
  if (data.user) userId = data.user.id;
  else if (error?.code === "email_exists" || /already/i.test(error?.message ?? "")) {
    // A sign-in account Rasd created earlier but never finished (e.g. a run stopped half-way): reuse it.
    // Any other identity with this address (a self sign-up, another app in the project) is never adopted.
    const existing = await findAuthUserByEmail(member.email);
    if (!existing || existing.app_metadata?.rasd !== true) throw new ApiError(409, "ACCOUNT_EXISTS", "يوجد حساب بهذا البريد بالفعل", { email: "يوجد حساب بهذا البريد بالفعل" });
    const reset = await supabaseAdmin.auth.admin.updateUserById(existing.id, { password: randomPassword(), email_confirm: true });
    if (reset.error) throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر تجهيز حساب الدخول — أعيدي المحاولة");
    userId = existing.id;
    createdHere = false;
  } else {
    console.error("createUser failed", error);
    throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر إنشاء الحساب — أعيدي المحاولة");
  }

  try {
    return await atomically(db, async tx => {
      const clusterId = await seedMember(tx, {
        userId, districtId: input.districtId, name: member.name, email: member.email, phone: member.phone ?? "",
        clusterLabel: member.clusterLabel ?? "", title: member.title ?? "",
      });
      if (context) {
        await auditWith(tx, context, {
          action: "create", entity: "member", entityId: userId, clusterId,
          after: { name: member.name, email: member.email, title: member.title ?? "" },
        });
      }
      return { userId, clusterId };
    });
  } catch (failure) {
    // Only remove a sign-in account this request created, and never one that a parallel request has since attached to a profile.
    const [attached] = createdHere ? await db`select id from profiles where id = ${userId}` : [{ id: userId }];
    if (!attached) await supabaseAdmin.auth.admin.deleteUser(userId).catch(cleanup => console.error("could not roll back auth user", userId, cleanup));
    throw failure;
  }
}

/**
 * Ends every session of a user: tokens issued before now are refused by authenticate(), and her refresh tokens are
 * revoked so they cannot mint new ones. The auth-schema statements are best effort (they need the postgres role).
 */
export async function revokeSessions(db: Sql, userId: string) {
  await db`update profiles set sessions_valid_after = now() where id = ${userId}`;
  // A savepoint each, so a statement this database role may not run never aborts the caller's transaction.
  await atomically(db, tx => tx`update auth.refresh_tokens set revoked = true where user_id::text = ${userId}`).catch(() => undefined);
  await atomically(db, tx => tx`delete from auth.sessions where user_id::text = ${userId}`).catch(() => undefined);
}
