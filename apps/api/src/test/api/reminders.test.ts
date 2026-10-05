// Messages to the team (ذكريهن): each member's own text, by email through Resend (one batch call) and in the app.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startApi, type TestApi } from "./harness.js";

let api: TestApi;
let head = "";
let headEmail = "";
let members: { id: string; email: string; name: string }[] = [];

type Sent = { sent: number; emailed: number; emailConfigured: boolean; failed: string[] };
const messagesFor = (bodies: string[]) => ({ kind: "reminder", messages: members.map((member, index) => ({ memberId: member.id, body: bodies[index] })) });

describe("reminders by email", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
    const rows = await api.sql`select p.id, p.email, p.name from profiles p join clusters c on c.member_id = p.id where p.role = 'member' order by p.email limit 2`;
    members = rows.map(row => ({ id: String(row.id), email: String(row.email), name: String(row.name) }));
    const [owner] = await api.sql`select email from profiles where role = 'head'`;
    headEmail = String(owner.email);
    assert.equal(members.length, 2);
  });
  after(async () => { await api.stop(); });

  test("without Resend: each message is kept in the app and the head is told email is not set up", async () => {
    const result = await api.call<Sent>("POST", "/district/reminders", messagesFor(["رسالة الأولى", "رسالة الثانية"]), head);
    assert.equal(result.status, 201, JSON.stringify(result.error));
    assert.deepEqual([result.data.sent, result.data.emailed, result.data.emailConfigured], [2, 0, false]);
    const rows = await api.sql`select body, channel from reminders where to_user_id = any(${api.sql.array(members.map(member => member.id))}::uuid[]) order by body`;
    assert.deepEqual(rows.map(row => [row.body, row.channel]), [["رسالة الأولى", "app"], ["رسالة الثانية", "app"]]);
    const [notification] = await api.sql`select text from notifications where user_id = ${members[0].id} and kind = 'reminder' order by created_at desc limit 1`;
    assert.equal(notification.text, "رسالة الأولى");
  });

  test("with Resend: one batch call, her own text with line breaks, HTML escaped, replies to the head", async () => {
    const { env } = await import("../../env.js");
    const saved = { key: env.resendApiKey, from: env.resendFrom };
    const realFetch = globalThis.fetch;
    const calls: { url: string; body: Record<string, unknown>[] }[] = [];
    let status = 200;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.resend.com")) return realFetch(input, init);
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(status === 200 ? JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }) : "rejected", { status });
    }) as typeof fetch;
    env.resendApiKey = "re_test";
    env.resendFrom = "Rasd <noreply@mail.example.com>";
    try {
      const sent = await api.call<Sent>("POST", "/district/reminders", messagesFor(["السلام عليكم\nينقصك <b>الجوال</b>", "رسالة ثانية"]), head);
      assert.equal(sent.status, 201, JSON.stringify(sent.error));
      assert.deepEqual([sent.data.sent, sent.data.emailed, sent.data.emailConfigured, sent.data.failed], [2, 2, true, []]);
      assert.equal(calls.length, 1, "one batch request for the whole team");
      assert.match(calls[0].url, /\/emails\/batch$/);
      const [first, second] = calls[0].body;
      assert.deepEqual(first.to, [members[0].email]);
      assert.deepEqual(second.to, [members[1].email]);
      assert.equal(first.from, "Rasd <noreply@mail.example.com>");
      assert.equal(first.reply_to, headEmail);
      assert.equal(first.subject, "تذكير من رئيسة النطاق — رَصد");
      assert.match(String(first.html), /السلام عليكم<br>ينقصك &lt;b&gt;الجوال&lt;\/b&gt;/);
      assert.match(String(first.html), /\/login"/, "a button to sign in");
      assert.match(String(second.html), /رسالة ثانية/);
      const [row] = await api.sql`select channel from reminders where to_user_id = ${members[1].id} order by sent_at desc limit 1`;
      assert.equal(row.channel, "email");

      const login = await api.call<Sent>("POST", "/district/reminders", { kind: "login", messages: [{ memberId: members[0].id, body: "حسابك جاهز" }] }, head);
      assert.equal(login.data.emailed, 1);
      assert.equal(calls[1].body[0].subject, "حسابك في منصة رَصد جاهز");

      // Resend refuses: nothing is lost — the messages stay in the app and the head learns who did not get the email.
      status = 422;
      const refused = await api.call<Sent>("POST", "/district/reminders", messagesFor(["أ", "ب"]), head);
      assert.equal(refused.status, 201);
      assert.equal(refused.data.emailed, 0);
      assert.deepEqual(refused.data.failed.sort(), members.map(member => member.name).sort());
    } finally {
      globalThis.fetch = realFetch;
      env.resendApiKey = saved.key;
      env.resendFrom = saved.from;
    }
  });

  test("refused: no messages, an empty text, an unknown member", async () => {
    for (const body of [
      { messages: [] },
      { messages: [{ memberId: members[0].id, body: "  " }] },
      { messages: [{ memberId: "not-a-uuid", body: "x" }] },
      { messages: [{ memberId: "00000000-0000-4000-8000-000000000000", body: "x" }] },
    ]) {
      assert.equal((await api.call("POST", "/district/reminders", body, head)).status, 422, JSON.stringify(body));
    }
    const member = await api.activate(members[0].email);
    assert.equal((await api.call("POST", "/district/reminders", messagesFor(["x", "y"]), member)).status, 403, "members cannot send");
  });
});
