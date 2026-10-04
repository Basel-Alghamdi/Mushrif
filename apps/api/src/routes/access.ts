import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { toWesternDigits, validators } from "@rasd/schemas";
import { MIN_PASSWORD, seedMember } from "../accounts.js";
import { audit, auditWith } from "../audit.js";
import { requireHead, supabaseAdmin, type AppEnv } from "../auth.js";
import { sql, type Row } from "../db.js";
import { env } from "../env.js";
import { emailConfigured, escapeHtml, rtlEmail, sendEmail } from "../email.js";
import { ApiError, invalid, notFound, ok } from "../errors.js";
import { cleanText, isUuid, normalizeEmail, readBody } from "../parse.js";
import { clientIp, HOUR, limit, MINUTE } from "../rate-limit.js";

const INVITATION_DAYS = 7;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const invitationUrl = (token: string) => `${env.appUrl}/invite/${token}`;
const passwordError = (password: string) => (password.length < MIN_PASSWORD ? `اختاري كلمة مرور من ${MIN_PASSWORD.toLocaleString("ar-SA")} أحرف أو أرقام على الأقل` : null);

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

export function accessRoutes(app: Hono<AppEnv>) {
  app.get("/auth/me", c => {
    const actor = c.get("actor");
    const permissions = actor.role === "head"
      ? ["district:read", "district:write", "members:contact", "imports", "reminders", "reports", "agent"]
      : ["cluster:read", "cluster:write", "ai:ask"];
    return c.json(ok({
      user: { id: actor.id, name: actor.name, email: actor.email, phone: actor.phone, title: actor.title, role: actor.role, clusterLabel: actor.clusterLabel },
      permissions,
    }));
  });

  // ───────── first sign-in (decision 2): she types her email, then chooses her password ─────────
  // Members only: the head's account always gets its password at setup (bootstrap:head), so it can never be claimed here.
  // Rate limits per IP and per address keep the unauthenticated endpoints from being used to scan or claim accounts.
  app.post("/public/auth/check", async c => {
    limit(`check:${clientIp(c)}`, 60, 10 * MINUTE);
    const body = await readBody(c);
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    if (validators.loginEmail(email)) throw invalid({ email: validators.loginEmail(email)! });
    const [profile] = await sql`select activated_at from profiles where email = ${email}`;
    // No name in the answer: the address alone must not reveal who it belongs to.
    return c.json(ok({ exists: Boolean(profile), activated: Boolean(profile?.activatedAt) }));
  });

  app.post("/public/auth/activate", async c => {
    const ip = clientIp(c);
    limit(`activate:${ip}`, 30, HOUR);
    const body = await readBody(c);
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const password = typeof body.password === "string" ? body.password : "";
    const fields: Record<string, string> = {};
    if (validators.loginEmail(email)) fields.email = validators.loginEmail(email)!;
    if (passwordError(password)) fields.password = passwordError(password)!;
    if (Object.keys(fields).length) throw invalid(fields);
    limit(`activate:${email}`, 5, HOUR);

    const [profile] = await sql`
      select p.id, p.district_id, p.role, p.name, p.activated_at, p.activation_expires_at, c.id as cluster_id
      from profiles p left join clusters c on c.member_id = p.id where p.email = ${email}`;
    const notFound = new ApiError(404, "ACCOUNT_NOT_FOUND", "هذا البريد غير مسجّل في المنصة — تأكدي منه أو تواصلي مع رئيسة النطاق");
    if (!profile || profile.role !== "member") throw notFound;
    if (profile.activatedAt) throw new ApiError(409, "ALREADY_ACTIVATED", "الحساب مفعّل مسبقاً — ادخلي بكلمة المرور");
    if (profile.activationExpiresAt && (profile.activationExpiresAt as Date) <= new Date()) {
      throw new ApiError(410, "ACTIVATION_EXPIRED", "انتهت مهلة تفعيل الحساب — اطلبي من رئيسة النطاق إعادة تعيين كلمة المرور");
    }
    // Claim the account first (only one of two simultaneous attempts wins), then talk to Supabase outside any transaction.
    const [claimed] = await sql`
      update profiles set activated_at = now(), activation_expires_at = null
      where id = ${profile.id} and role = 'member' and activated_at is null returning id`;
    if (!claimed) throw new ApiError(409, "ALREADY_ACTIVATED", "الحساب مفعّل مسبقاً — ادخلي بكلمة المرور");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(String(profile.id), { password, email_confirm: true });
    if (error) {
      await sql`update profiles set activated_at = null, activation_expires_at = ${profile.activationExpiresAt} where id = ${profile.id}`;
      if (error.code === "weak_password") throw invalid({ password: "كلمة المرور ضعيفة — اختاري كلمة أطول" });
      console.error("activation failed", error);
      throw new ApiError(502, "AUTH_PROVIDER_ERROR", "تعذّر تفعيل الحساب — أعيدي المحاولة");
    }
    await sql.begin(async tx => {
      await auditWith(tx, {
        actor: { id: String(profile.id), districtId: String(profile.districtId), role: "member", clusterId: profile.clusterId },
        source: c.get("source") ?? "web", ip: ip === "unknown" ? null : ip,
      }, { action: "activate", entity: "account", entityId: String(profile.id), clusterId: profile.clusterId });
      // The head sees every first sign-in, so a claim she did not expect stands out.
      const heads = await tx`select id from profiles where district_id = ${profile.districtId} and role = 'head'`;
      for (const head of heads) {
        await tx`insert into notifications ${tx({ userId: head.id, kind: "activation", text: `فعّلت ${profile.name} حسابها`, level: "info" })}`;
      }
    });
    return c.json(ok({ email }));
  });

  // Always answers the same way so the endpoint cannot be used to discover which emails have accounts.
  app.post("/public/auth/forgot-password", async c => {
    limit(`forgot:${clientIp(c)}`, 10, HOUR);
    const body = await readBody(c);
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    if (validators.loginEmail(email)) throw invalid({ email: "أدخلي بريدك" });
    limit(`forgot:${email}`, 3, HOUR);
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
    const name = typeof body.name === "string" ? cleanText(body.name) : "";
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const clusterLabel = typeof body.clusterLabel === "string" ? cleanText(body.clusterLabel) : "";
    const fields: Record<string, string> = {};
    if (!name) fields.name = "اسم العضوة مطلوب";
    if (validators.loginEmail(email)) fields.email = validators.loginEmail(email)!;
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
    limit(`invite:${clientIp(c)}`, 60, 10 * MINUTE);
    const [row] = await sql`select * from invitations where token_hash = ${tokenHash(c.req.param("token"))}`;
    if (!row) throw notFound("رابط الدعوة غير صحيح");
    const status = row.status === "pending" && (row.expiresAt as Date) <= new Date() ? "expired" : row.status;
    return c.json(ok({ name: row.name, email: row.email, clusterLabel: row.clusterLabel, status, expiresAt: row.expiresAt }));
  });

  app.post("/public/invitations/:token/accept", async c => {
    limit(`invite:${clientIp(c)}`, 60, 10 * MINUTE);
    const body = await readBody(c);
    const password = typeof body.password === "string" ? body.password : "";
    const phone = typeof body.phone === "string" ? toWesternDigits(cleanText(body.phone)).slice(0, 40) : "";
    if (passwordError(password)) throw invalid({ password: passwordError(password)! });

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
          activated: true,
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
