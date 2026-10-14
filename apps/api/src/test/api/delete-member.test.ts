// رئيسة النطاق removes a مشرفة: soft delete. She is locked out at once, gone from every list and message, her file stays
// in the database (for the platform owner only), and her address can be added again.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { PASSWORD, startApi, type TestApi } from "./harness.js";

const EMAIL = "jawhara.member@example.com";
let api: TestApi;
let head = "";

describe("deleting a member's account", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
  });
  after(async () => { await api.stop(); });

  test("she is locked out and hidden everywhere, while her file stays in the database", async () => {
    const member = await api.activate(EMAIL);
    const [row] = await api.sql`select p.id, c.id as cluster_id from profiles p join clusters c on c.member_id = p.id where p.email = ${EMAIL}`;
    const memberId = String(row.id);
    const school = await api.call("POST", "/cluster/me/schools", { name: "ثانوية المحذوفة" }, member);
    assert.equal((await api.call("POST", "/visits", { schoolId: school.data.id, type: "تحقق", text: "زيارة قبل الحذف" }, member)).status, 201);
    const form = new FormData();
    form.append("files", new File(["ملف"], "ملفها.txt", { type: "text/plain" }));
    form.append("folder", "professional_development");
    const uploaded = await api.call("POST", "/cluster/me/documents", form, member);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.error));

    // Only the head deletes, and only her own district's members.
    assert.equal((await api.call("DELETE", `/district/members/${memberId}`, undefined, member)).status, 403);
    const removed = await api.call("DELETE", `/district/members/${memberId}`, undefined, head);
    assert.equal(removed.status, 200, JSON.stringify(removed.error));

    // Her open session ends, and she cannot sign in again with her address and password.
    const refused = await api.call("GET", "/member/workspace", undefined, member);
    assert.equal(refused.status, 401);
    await assert.rejects(api.signIn(EMAIL, PASSWORD));
    assert.deepEqual((await api.call("POST", "/public/auth/check", { email: EMAIL })).data, { exists: false, activated: false });

    // Gone from the head's platform: team, her page and mirrors, files, reminders, and a second delete.
    assert.ok(!(await api.team(head)).some(item => item.id === memberId));
    assert.equal((await api.call("GET", `/district/members/${memberId}`, undefined, head)).status, 404);
    assert.equal((await api.call("GET", `/district/members/${memberId}/visits`, undefined, head)).status, 404);
    assert.equal((await api.call("GET", `/attachments/${uploaded.data[0].id}`, undefined, head)).status, 404);
    const files = await api.call<any[]>("GET", "/district/documents", undefined, head);
    assert.ok(!files.data.some(item => item.id === uploaded.data[0].id));
    assert.equal((await api.call("POST", "/district/reminders", { memberIds: [memberId], body: "تذكير" }, head)).status, 422);
    assert.equal((await api.call("DELETE", `/district/members/${memberId}`, undefined, head)).status, 404);

    // Kept in the database: who she was, who removed her and when, and her whole file.
    const [kept] = await api.sql`select deleted_at, deleted_email, email from profiles where id = ${memberId}`;
    assert.ok(kept.deletedAt);
    assert.equal(kept.deletedEmail, EMAIL);
    assert.notEqual(kept.email, EMAIL);
    const [counts] = await api.sql`
      select (select count(*)::int from schools where cluster_id = ${row.clusterId}) as schools,
        (select count(*)::int from visit_reports where cluster_id = ${row.clusterId}) as visits,
        (select count(*)::int from attachments where cluster_id = ${row.clusterId} and deleted_at is null) as files`;
    assert.deepEqual(counts, { schools: 1, visits: 1, files: 1 });
    const [audit] = await api.sql`select after, before from audit_log where action = 'delete' and entity = 'member' and entity_id = ${memberId}`;
    assert.equal(audit.before.email, EMAIL);

    // Her absence of activity no longer counts anywhere, and her address can be given to a new account.
    const overview = await api.call("GET", "/district/overview", undefined, head);
    assert.equal(overview.data.kpis.members, (await api.team(head)).length);
    const again = await api.call("POST", "/district/members", { name: "جوهرة من جديد", email: EMAIL }, head);
    assert.equal(again.status, 201, JSON.stringify(again.error));
    assert.notEqual(again.data.id, memberId);
  });
});
