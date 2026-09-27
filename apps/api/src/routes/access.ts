import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { DEFAULT_PLANS, DEFAULT_PROFILE_FIELDS, toWesternDigits, validators } from "@rasd/schemas";
import { audit } from "../audit.js";
import { requireHead, supabaseAdmin, type AppEnv } from "../auth.js";
import { sql, type Row, type Sql } from "../db.js";
import { env } from "../env.js";
import { emailConfigured, escapeHtml, rtlEmail, sendEmail } from "../email.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { isUuid, readBody } from "../parse.js";

const INVITATION_DAYS = 7;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const invitationUrl = (token: string) => `${env.appUrl}/invite/${token}`;

const invitationDto = (row: Row) => ({
  id: row.id, name: row.name, email: row.email, clusterLabel: row.clusterLabel, status: row.status,
  deliveryStatus: row.deliveryStatus, expiresAt: row.expiresAt, createdAt: row.createdAt,
});

async function deliverInvitation(invitation: Row, link: string, headName: string) {
  try {
    return await sendEmail({
      to: invitation.email,
      subject: "دعوة للانضمام إلى منصة رَصد",
      html: rtlEmail(`<h2>مرحباً ${escapeHtml(invitation.name)}</h2>
        <p>دعتك ${escapeHtml(headName)} للانضمام إلى منصة رَصد وتعبئة ملف ${escapeHtml(invitation.clusterLabel || "عنقودك")}.</p>
        <p><a href="${escapeHtml(link)}">قبول الدعوة وإنشاء الحساب</a></p>
        <p>تنتهي صلاحية الرابط خلال ${INVITATION_DAYS} أيام.</p>`),
    }) === "sent" ? "sent" as const : "link_ready" as const;
  } catch (error) {
    console.error("invitation email failed", error);
    return "failed" as const;
  }
}

/** Creates the member's cluster with the built-in profile fields and the five plans. */
export async function seedMember(db: Sql, input: { userId: string; districtId: string; name: string; email: string; phone: string; clusterLabel: string }) {
  await db`insert into profiles ${db({ id: input.userId, districtId: input.districtId, role: "member", name: input.name, email: input.email, phone: input.phone })}`;
  const [cluster] = await db`insert into clusters ${db({ districtId: input.districtId, memberId: input.userId, label: input.clusterLabel })} returning id`;
  const prefilled: Record<string, string> = { fullName: input.name, email: input.email, phone: input.phone };
  for (const [index, field] of DEFAULT_PROFILE_FIELDS.entries()) {
    await db`insert into profile_fields ${db({
      clusterId: cluster.id, fieldKey: field.key, label: field.label, value: prefilled[field.key] ?? field.value ?? "",
      span: field.span, fieldType: field.type, options: field.options ?? [], sortOrder: index,
    })}`;
  }
  for (const [index, plan] of DEFAULT_PLANS.entries()) {
    await db`insert into plans ${db({ clusterId: cluster.id, kind: plan.kind, label: plan.label, sortOrder: index })}`;
  }
  return String(cluster.id);
}

export function accessRoutes(app: Hono<AppEnv>) {
  app.get("/auth/me", c => {
    const actor = c.get("actor");
    const permissions = actor.role === "head"
      ? ["district:read", "members:contact", "imports", "reminders", "reports", "agent"]
      : ["cluster:read", "cluster:write", "ai:ask"];
    return c.json(ok({ user: { id: actor.id, name: actor.name, email: actor.email, phone: actor.phone, role: actor.role, clusterLabel: actor.clusterLabel }, permissions }));
  });

  // Always answers the same way so the endpoint cannot be used to discover which emails have accounts.
  app.post("/public/auth/forgot-password", async c => {
    const body = await readBody(c);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (validators.email(email) || !email) throw invalid({ email: "أدخلي بريدك الوزاري" });
    const [profile] = await sql`select name from profiles where email = ${email}`;
    if (profile) {
      try {
        if (emailConfigured()) {
          const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "recovery", email });
          if (error) throw error;
          const link = `${env.appUrl}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
          await sendEmail({
            to: email,
            subject: "إعادة تعيين كلمة المرور — رَصد",
            html: rtlEmail(`<p>مرحباً ${escapeHtml(String(profile.name))}</p><p>طلبتِ إعادة تعيين كلمة المرور لحسابك في رَصد.</p>
              <p><a href="${escapeHtml(link)}">تعيين كلمة مرور جديدة</a></p><p>إن لم تطلبي ذلك فتجاهلي هذه الرسالة.</p>`),
          });
        } else {
          // No Resend key: fall back to Supabase's built-in mailer.
          const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl}/reset-password` });
          if (error) throw error;
        }
      } catch (error) {
        console.error("password reset email failed", error);
      }
    }
    return c.json(ok({ sent: true }));
  });

  // ───────── invitations (head) ─────────
  app.post("/district/invitations", async c => {
    const actor = requireHead(c);
    const body = await readBody(c);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? toWesternDigits(body.email.trim().toLowerCase()) : "";
    const clusterLabel = typeof body.clusterLabel === "string" ? body.clusterLabel.trim() : "";
    const fields: Record<string, string> = {};
    if (!name) fields.name = "اسم العضوة مطلوب";
    if (!email || validators.email(email)) fields.email = "استخدمي البريد الوزاري المنتهي بـ moe.gov.sa";
    if (!clusterLabel) fields.clusterLabel = "اسم العنقود مطلوب";
    if (Object.keys(fields).length) throw invalid(fields, "أكملي بيانات الدعوة");

    const token = newToken();
    const invitation = await sql.begin(async tx => {
      const [existingAccount] = await tx`select id from profiles where email = ${email}`;
      if (existingAccount) throw new ApiError(409, "ACCOUNT_EXISTS", "يوجد حساب بهذا البريد بالفعل");
      const [pending] = await tx`select id from invitations where district_id = ${actor.districtId} and email = ${email} and status = 'pending' and expires_at > now()`;
      if (pending) throw new ApiError(409, "INVITATION_EXISTS", "هناك دعوة معلقة لهذا البريد — استخدمي إعادة الإرسال");
      await tx`update invitations set status = 'expired' where district_id = ${actor.districtId} and email = ${email} and status = 'pending'`;
      const [row] = await tx`insert into invitations ${tx({
        districtId: actor.districtId, invitedBy: actor.id, name, email, clusterLabel, tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
      })} returning *`;
      await audit(c, tx, { action: "invite", entity: "invitation", entityId: String(row.id), clusterId: null, after: { name, email, clusterLabel } });
      return row;
    });
    const link = invitationUrl(token);
    const deliveryStatus = await deliverInvitation(invitation, link, actor.name);
    const [updated] = await sql`update invitations set delivery_status = ${deliveryStatus} where id = ${invitation.id} returning *`;
    return c.json(ok({ invitation: invitationDto(updated), inviteUrl: link }), 201);
  });

  app.post("/district/invitations/:id/resend", async c => {
    const actor = requireHead(c);
    const id = c.req.param("id");
    const token = newToken();
    const [invitation] = isUuid(id) ? await sql`
      update invitations set token_hash = ${tokenHash(token)}, expires_at = ${new Date(Date.now() + INVITATION_DAYS * 86_400_000)}, delivery_status = 'sending'
      where id = ${id} and district_id = ${actor.districtId} and status in ('pending', 'expired') and accepted_at is null
      returning *` : [];
    if (!invitation) throw notFound("الدعوة غير موجودة");
    await sql`update invitations set status = 'pending' where id = ${invitation.id}`;
    const link = invitationUrl(token);
    const deliveryStatus = await deliverInvitation(invitation, link, actor.name);
    const [updated] = await sql`update invitations set delivery_status = ${deliveryStatus} where id = ${invitation.id} returning *`;
    return c.json(ok({ invitation: invitationDto(updated), inviteUrl: link }));
  });

  app.delete("/district/invitations/:id", async c => {
    const actor = requireHead(c);
    const id = c.req.param("id");
    const revoked = await sql.begin(async tx => {
      const [row] = isUuid(id) ? await tx`update invitations set status = 'revoked' where id = ${id} and district_id = ${actor.districtId} and status = 'pending' returning id` : [];
      if (row) await audit(c, tx, { action: "revoke", entity: "invitation", entityId: id, clusterId: null });
      return Boolean(row);
    });
    if (!revoked) throw notFound("الدعوة غير موجودة");
    return c.json(ok({ revoked: true }));
  });

  // ───────── invitations (public) ─────────
  app.get("/public/invitations/:token", async c => {
    const [row] = await sql`select * from invitations where token_hash = ${tokenHash(c.req.param("token"))}`;
    if (!row) throw notFound("رابط الدعوة غير صحيح");
    const status = row.status === "pending" && (row.expiresAt as Date) <= new Date() ? "expired" : row.status;
    return c.json(ok({ name: row.name, email: row.email, clusterLabel: row.clusterLabel, status, expiresAt: row.expiresAt }));
  });

  app.post("/public/invitations/:token/accept", async c => {
    const body = await readBody(c);
    const password = typeof body.password === "string" ? body.password : "";
    const phone = typeof body.phone === "string" ? toWesternDigits(body.phone.trim()) : "";
    const fields: Record<string, string> = {};
    if (password.length < 8) fields.password = "كلمة المرور يجب ألا تقل عن ٨ أحرف";
    const phoneError = validators.phone(phone);
    if (!phone || phoneError) fields.phone = phoneError ?? "رقم الجوال مطلوب";
    if (Object.keys(fields).length) throw invalid(fields);

    const [invitation] = await sql`select * from invitations where token_hash = ${tokenHash(c.req.param("token"))} and status = 'pending' and expires_at > now()`;
    if (!invitation) throw new ApiError(410, "INVITATION_INVALID", "الدعوة منتهية أو سبق استخدامها");

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: invitation.email, password, email_confirm: true, user_metadata: { name: invitation.name },
    });
    if (error || !data.user) {
      if (error?.code === "email_exists" || /already/i.test(error?.message ?? "")) throw new ApiError(409, "ACCOUNT_EXISTS", "يوجد حساب بهذا البريد بالفعل — سجّلي الدخول");
      if (error?.code === "weak_password") throw invalid({ password: "كلمة المرور ضعيفة — اختاري كلمة أقوى" });
      console.error("createUser failed", error);
      throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر إنشاء الحساب — أعيدي المحاولة");
    }
    const userId = data.user.id;
    try {
      await sql.begin(async tx => {
        const [claimed] = await tx`update invitations set status = 'accepted', accepted_at = now(), accepted_user_id = null where id = ${invitation.id} and status = 'pending' returning id`;
        if (!claimed) throw new ApiError(410, "INVITATION_INVALID", "الدعوة منتهية أو سبق استخدامها");
        const clusterId = await seedMember(tx, {
          userId, districtId: invitation.districtId, name: invitation.name, email: invitation.email, phone, clusterLabel: invitation.clusterLabel,
        });
        await tx`update invitations set accepted_user_id = ${userId} where id = ${invitation.id}`;
        await tx`insert into audit_log ${tx({ districtId: invitation.districtId, clusterId, actorId: userId, action: "accept", entity: "invitation", entityId: invitation.id, source: "web" })}`;
      });
    } catch (failure) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(cleanup => console.error("could not roll back auth user", userId, cleanup));
      throw failure;
    }
    return c.json(ok({ email: invitation.email }), 201);
  });
}
