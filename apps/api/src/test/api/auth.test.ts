// First sign-in (check → activate → Supabase sign-in → /auth/me), password reset, accounts without invitation, seed:roster,
// and the protections around them (head never claimable, no names leaked, rate limits, expiry, session revocation).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { LOCAL_HEAD_PASSWORD } from "../support/stack.js";
import { testRoster } from "../roster.fixture.js";
import { HEAD_EMAIL, PASSWORD, startApi, type TestApi } from "./harness.js";

let api: TestApi;
let head = "";

const runSeedScript = (env: Record<string, string>) => new Promise<string>((done, fail) => {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/seed-roster.ts"], { cwd: fileURLToPath(new URL("../../../", import.meta.url)), env: { ...process.env, ...env } });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.on("exit", code => (code === 0 ? done(output) : fail(new Error(output))));
});

const profileId = async (email: string) => String((await api.sql`select id from profiles where email = ${email}`)[0].id);

describe("accounts and first sign-in", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
  });
  after(async () => { await api.stop(); });

  test("check: answers exists/activated only — never a name", async () => {
    const { status, data } = await api.call("POST", "/public/auth/check", { email: "  KHULOOD@example.com " });
    assert.equal(status, 200);
    assert.deepEqual(data, { exists: true, activated: true }, "the head got her password at setup");
    assert.deepEqual((await api.call("POST", "/public/auth/check", { email: "maha.member@example.com" })).data, { exists: true, activated: false });
    assert.deepEqual((await api.call("POST", "/public/auth/check", { email: "nobody@gmail.com" })).data, { exists: false, activated: false });
    assert.equal((await api.call("POST", "/public/auth/check", { email: "no-at-sign" })).status, 422);
  });

  test("activate: a member chooses her password once, then signs in with supabase-js and reaches /auth/me", async () => {
    const email = "maha.member@example.com";
    const short = await api.call("POST", "/public/auth/activate", { email, password: "1234567" });
    assert.equal(short.status, 422, "8 characters at least");
    assert.ok(short.error?.fields?.password);
    assert.equal((await api.call("POST", "/public/auth/activate", { email: "nobody@gmail.com", password: PASSWORD })).error?.code, "ACCOUNT_NOT_FOUND");

    const activated = await api.call("POST", "/public/auth/activate", { email, password: PASSWORD });
    assert.equal(activated.status, 200, JSON.stringify(activated.error));
    assert.deepEqual(activated.data, { email });
    const again = await api.call("POST", "/public/auth/activate", { email, password: "another-pass" });
    assert.equal(again.error?.code, "ALREADY_ACTIVATED");

    const { token } = await api.signIn(email);
    const me = await api.call("GET", "/auth/me", undefined, token);
    assert.equal(me.data.user.role, "member");
    assert.equal(me.data.user.email, email);
    assert.equal((await api.call("GET", "/auth/me")).status, 401);
    await assert.rejects(api.signIn(email, "another-pass"));

    const [audit] = await api.sql`select a.actor_id from audit_log a where a.entity_id = ${await profileId(email)} and a.action = 'activate'`;
    assert.ok(audit, "activation is audited with her as actor");
    const [note] = await api.sql`select n.text from notifications n join profiles p on p.id = n.user_id where p.role = 'head' and n.kind = 'activation'`;
    assert.match(String(note?.text), /فعّلت .* حسابها/, "the head is told about every first sign-in");
  });

  test("the head's account can never be claimed through first sign-in", async () => {
    const headId = await profileId(HEAD_EMAIL);
    await api.sql`update profiles set activated_at = null where id = ${headId}`;
    try {
      const attempt = await api.call("POST", "/public/auth/activate", { email: HEAD_EMAIL, password: "attacker-pass" });
      assert.equal(attempt.status, 404);
      await assert.rejects(api.signIn(HEAD_EMAIL, "attacker-pass"));
    } finally {
      await api.sql`update profiles set activated_at = now() where id = ${headId}`;
    }
  });

  test("the session refreshes and getUser works against the local Supabase", async () => {
    const { client } = await api.signIn(HEAD_EMAIL, LOCAL_HEAD_PASSWORD);
    const refreshed = await client.auth.refreshSession();
    assert.ok(refreshed.data.session?.access_token);
    const user = await client.auth.getUser(refreshed.data.session!.access_token);
    assert.equal(user.data.user?.email, HEAD_EMAIL);
    assert.equal((await api.call("GET", "/auth/me", undefined, refreshed.data.session!.access_token)).status, 200);
  });

  test("the head creates a member with a personal email; she activates and signs in", async () => {
    const created = await api.call("POST", "/district/members", { name: "  نورة   سالم  ", email: "Noura.Test@Gmail.com", title: "عضو فريق تنفيذي", phone: "٠٥٥ ١٢٣ ٤٥٦٧" }, head);
    assert.equal(created.status, 201, JSON.stringify(created.error));
    assert.equal(created.data.name, "نورة سالم");
    assert.equal(created.data.email, "noura.test@gmail.com");
    assert.equal(created.data.title, "عضو فريق تنفيذي");
    assert.equal(created.data.activated, false);
    assert.equal(created.data.lastActivityAt, null);
    const [window] = await api.sql`select activation_expires_at from profiles where id = ${created.data.id}`;
    assert.ok((window.activationExpiresAt as Date).getTime() > Date.now() + 13 * 86_400_000, "a 14-day first-sign-in window");

    assert.equal((await api.call("POST", "/district/members", { name: "نورة", email: "noura.test@gmail.com" }, head)).status, 409);
    const invalid = await api.call("POST", "/district/members", { name: "", email: "x" }, head);
    assert.equal(invalid.status, 422);
    assert.deepEqual(Object.keys(invalid.error!.fields!).sort(), ["email", "name"]);

    const profile = await api.sql`select f.field_key, f.value from profile_fields f join clusters c on c.id = f.cluster_id where c.member_id = ${created.data.id} and f.field_key in ('fullName', 'title', 'email', 'phone')`;
    const values = Object.fromEntries(profile.map(row => [row.fieldKey, row.value]));
    assert.deepEqual(values, { fullName: "نورة سالم", title: "عضو فريق تنفيذي", email: "", phone: "055 123 4567" }, "a personal login email is not copied into البريد الوزاري");

    const member = await api.activate("noura.test@gmail.com");
    const me = await api.call("GET", "/auth/me", undefined, member);
    assert.equal(me.data.user.role, "member");
    assert.equal(me.data.user.title, "عضو فريق تنفيذي");
    const summary = (await api.team(head)).find(item => item.email === "noura.test@gmail.com");
    assert.equal(summary.activated, true);
    assert.ok(summary.lastSignInAt, "last sign-in comes from auth.users");
    assert.equal((await api.call("POST", "/district/members", { name: "x", email: "y@z.com" }, member)).status, 403);
  });

  test("an expired first-sign-in window refuses activation until the head resets the account", async () => {
    const email = "faiza.member@example.com";
    await api.sql`update profiles set activation_expires_at = now() - interval '1 minute' where email = ${email}`;
    const expired = await api.call("POST", "/public/auth/activate", { email, password: PASSWORD });
    assert.equal(expired.status, 410);
    assert.equal(expired.error?.code, "ACTIVATION_EXPIRED");
    assert.equal((await api.call("POST", `/district/members/${await profileId(email)}/reset-password`, undefined, head)).status, 200);
    assert.equal((await api.call("POST", "/public/auth/activate", { email, password: PASSWORD })).status, 200);
  });

  test("two simultaneous first sign-ins: exactly one wins", async () => {
    const email = "siham.member@example.com";
    const results = await Promise.all(["first-attempt-1", "second-attempt-2"].map(password => api.call("POST", "/public/auth/activate", { email, password })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results[0].status === 200 ? "first-attempt-1" : "second-attempt-2";
    assert.ok((await api.signIn(email, winner)).token);
  });

  test("activation attempts for one address are rate limited", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await api.call("POST", "/public/auth/activate", { email: "nobody-else@gmail.com", password: PASSWORD })).status);
    assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429], "the sixth attempt for the same address within an hour is refused");
  });

  test("reset-password ends every existing session and opens a short window for a new password", async () => {
    const email = "rasha.member@example.com";
    const id = await profileId(email);
    await api.activate(email, "first-pass");
    const before = await api.signIn(email, "first-pass");
    assert.equal((await api.call("GET", "/auth/me", undefined, before.token)).status, 200);

    // Tokens are compared to the reset by their issue second.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const reset = await api.call("POST", `/district/members/${id}/reset-password`, undefined, head);
    assert.deepEqual(reset.data, { reset: true });
    assert.equal((await api.call("GET", "/auth/me", undefined, before.token)).status, 401, "the old access token stops working");
    const refreshed = await before.client.auth.refreshSession();
    assert.ok(refreshed.error, "the old refresh token cannot mint a new session");
    await assert.rejects(api.signIn(email, "first-pass"), "the old password stops working");

    const [window] = await api.sql`select activated_at, activation_expires_at from profiles where id = ${id}`;
    assert.equal(window.activatedAt, null);
    assert.ok((window.activationExpiresAt as Date).getTime() < Date.now() + 4 * 86_400_000, "a short window after a reset");
    const token = await api.activate(email, "second-pass");
    assert.equal((await api.call("GET", "/auth/me", undefined, token)).status, 200);
    const [audit] = await api.sql`select cluster_id from audit_log where action = 'reset_password' and entity_id = ${id}`;
    assert.ok(audit?.clusterId);
    assert.equal((await api.call("POST", "/district/members/00000000-0000-0000-0000-000000000000/reset-password", undefined, head)).status, 404);
  });

  test("seed:roster created the fictional team and is idempotent", async () => {
    const members = await api.team(head);
    for (const entry of testRoster) {
      const member = members.find(item => item.email === entry.email);
      assert.ok(member, entry.email);
      assert.equal(member.title, entry.title);
    }
    const output = await runSeedScript(api.stack.env);
    assert.match(output, /0 created, 18 already had accounts, 0 failed/);
  });

  test("main's /reset-password flow works, and a password set that way closes first sign-in", async () => {
    const { supabaseAdmin } = await import("../../auth.js");
    const email = "manal.member@example.com";
    const link = await supabaseAdmin.auth.admin.generateLink({ type: "recovery", email });
    assert.ok(link.data.properties?.hashed_token, JSON.stringify(link.error));
    const { client } = await api.signIn(HEAD_EMAIL, LOCAL_HEAD_PASSWORD);
    const verified = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "recovery" });
    assert.equal(verified.data.user?.email, email);
    assert.equal((await client.auth.updateUser({ password: "recovered-pass" })).error, null);
    const reused = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "recovery" });
    assert.ok(reused.error, "a recovery link works once");

    const { token } = await api.signIn(email, "recovered-pass");
    assert.equal((await api.call("GET", "/auth/me", undefined, token)).status, 200);
    assert.deepEqual((await api.call("POST", "/public/auth/check", { email })).data, { exists: true, activated: true });
    assert.equal((await api.call("POST", "/public/auth/activate", { email, password: "attacker-pass" })).status, 409, "nobody can claim it afterwards");
  });

  test("only sign-in accounts Rasd created are reused; any other identity with the address is refused", async () => {
    const { supabaseAdmin } = await import("../../auth.js");
    const foreign = await supabaseAdmin.auth.admin.createUser({ email: "foreign@gmail.com", password: "foreign-pass", email_confirm: true });
    assert.ok(foreign.data.user);
    assert.equal((await api.call("POST", "/district/members", { name: "هوية أخرى", email: "foreign@gmail.com" }, head)).status, 409);
    assert.ok((await api.signIn("foreign@gmail.com", "foreign-pass")).token, "the foreign identity is left untouched");

    const orphan = await supabaseAdmin.auth.admin.createUser({ email: "orphan@gmail.com", password: "orphan-pass", email_confirm: true, app_metadata: { rasd: true } });
    const created = await api.call("POST", "/district/members", { name: "عضوة سابقة", email: "orphan@gmail.com" }, head);
    assert.equal(created.status, 201, JSON.stringify(created.error));
    assert.equal(created.data.id, orphan.data.user!.id);
    await assert.rejects(api.signIn("orphan@gmail.com", "orphan-pass"), "her old password no longer works; she chooses a new one");
  });

  test("invitations accept personal emails and no cluster label", async () => {
    const invited = await api.call("POST", "/district/invitations", { name: "مدعوة", email: "invitee@gmail.com" }, head);
    assert.equal(invited.status, 201, JSON.stringify(invited.error));
    const token = new URL(invited.data.inviteUrl).pathname.split("/").pop()!;
    const accepted = await api.call("POST", `/public/invitations/${token}/accept`, { password: "invite-pass", phone: "+966 5x" });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.error));
    const summary = (await api.team(head)).find(item => item.email === "invitee@gmail.com");
    assert.equal(summary.activated, true, "an accepted invitation already has her password");
  });
});
