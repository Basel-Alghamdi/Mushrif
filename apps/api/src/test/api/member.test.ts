// No blocking formats, الصفة sync, the head's mirrors on a member's file, and "updated today" from her own work.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { riyadhDate } from "@rasd/schemas";
import { HEAD_EMAIL, startApi, type TestApi } from "./harness.js";

let api: TestApi;
let head = "";
let rasha = "";
let rashaId = "";
let rashaCluster = "";
const field = (workspace: any, key: string) => workspace.profile.find((item: any) => item.key === key);

describe("member file", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
    rasha = await api.activate("rasha.member@example.com");
    const [row] = await api.sql`select p.id, c.id as cluster_id from profiles p join clusters c on c.member_id = p.id where p.email = 'rasha.member@example.com'`;
    rashaId = String(row.id);
    rashaCluster = String(row.clusterId);
  });
  after(async () => { await api.stop(); });

  test("signing in alone does not count as updating today", async () => {
    const summary = (await api.team(head)).find(item => item.id === rashaId);
    assert.equal(summary.submission, "missing");
    assert.equal(summary.lastActivityAt, null);
  });

  test("free-form phone, national id, dates and select values are accepted (digits normalized)", async () => {
    const workspace = (await api.call("GET", "/member/workspace", undefined, rasha)).data;
    const phone = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "phone").id}`, { value: "+966 ٥٥ 123-45" }, rasha);
    assert.equal(phone.status, 200, JSON.stringify(phone.error));
    assert.equal(phone.data.value, "+966 55 123-45");
    const nationalId = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "nationalId").id}`, { value: "١٢٣" }, rasha);
    assert.equal(nationalId.status, 200);
    assert.equal(nationalId.data.value, "123");
    const email = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "email").id}`, { value: "rasha@gmail.com" }, rasha);
    assert.equal(email.status, 200, "البريد الوزاري accepts any address");
    const rank = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "rank").id}`, { value: "رتبة غير موجودة في القائمة" }, rasha);
    assert.equal(rank.status, 200, "select fields accept free text");
    const hire = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "hireDate").id}`, { value: "2010-05-10" }, rasha);
    assert.equal(hire.status, 200);
    const label = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "major").id}`, { label: "ت".repeat(150) }, rasha);
    assert.equal(label.status, 200, "labels up to 200 characters");

    const after = (await api.call("GET", "/member/workspace", undefined, rasha)).data;
    assert.ok(Number(field(after, "yearsOfExperience").value) >= 16, "a Gregorian hire date still gives the years of experience");
  });

  test("schools and visits take any text; visits may have an empty description", async () => {
    const school = await api.call("POST", "/cluster/me/schools", { name: "الابتدائية ١٢٠", ministryNo: "رقم ١٢", ministryEmail: "school@gmail.com", educationType: "مسائي" }, rasha);
    assert.equal(school.status, 201, JSON.stringify(school.error));
    assert.equal(school.data.ministryNo, "رقم 12");
    const visit = await api.call("POST", "/visits", { schoolId: school.data.id, type: "زيارة صفية" }, rasha);
    assert.equal(visit.status, 201, JSON.stringify(visit.error));
    assert.equal(visit.data.text, "");
    const noType = await api.call("POST", "/visits", { schoolId: school.data.id, text: "x" }, rasha);
    assert.equal(noType.status, 422);
    const pd = await api.call("POST", "/pd", { label: "برنامج", reportsUrl: "ليس رابطاً" }, rasha);
    assert.equal(pd.status, 201);
  });

  test("her own writes mark her as updated today with her last activity", async () => {
    const [submission] = await api.sql`select date::text as date, submitted_at from daily_submissions where member_id = ${rashaId}`;
    assert.equal(submission.date, riyadhDate());
    const summary = (await api.team(head)).find(item => item.id === rashaId);
    assert.equal(summary.submission, "submitted");
    assert.ok(summary.lastActivityAt);
    assert.ok(summary.submittedAt);
  });

  test("الصفة stays in sync between the profile field and profiles.title", async () => {
    const workspace = (await api.call("GET", "/member/workspace", undefined, rasha)).data;
    const title = await api.call("PATCH", `/cluster/me/profile-fields/${field(workspace, "title").id}`, { value: "عضو نواتج تعلم" }, rasha);
    assert.equal(title.status, 200);
    assert.equal((await api.call("GET", "/auth/me", undefined, rasha)).data.user.title, "عضو نواتج تعلم");
    const contact = await api.call("PATCH", `/district/members/${rashaId}/contact`, { title: "قائدة فريق", phone: "٠٥٠٠" }, head);
    assert.equal(contact.status, 200, JSON.stringify(contact.error));
    const fresh = (await api.call("GET", "/member/workspace", undefined, rasha)).data;
    assert.equal(field(fresh, "title").value, "قائدة فريق");
    assert.equal(field(fresh, "phone").value, "0500");
  });

  test("the head edits a member's file through the mirror routes, audited with her cluster", async () => {
    const workspace = (await api.call("GET", `/district/members/${rashaId}`, undefined, head)).data.workspace;
    const nationalId = field(workspace, "nationalId");
    const edit = await api.call("PATCH", `/district/members/${rashaId}/profile-fields/${nationalId.id}`, { value: "2-ABC" }, head);
    assert.equal(edit.status, 200, JSON.stringify(edit.error));
    assert.equal(edit.data.value, "2-ABC");
    const [audit] = await api.sql`
      select a.cluster_id, p.email from audit_log a join profiles p on p.id = a.actor_id
      where a.entity = 'profile_field' and a.entity_id = ${nationalId.id} and a.action = 'update' order by a.at desc limit 1`;
    assert.equal(audit.clusterId, rashaCluster);
    assert.equal(audit.email, HEAD_EMAIL);

    const added = await api.call("POST", `/district/members/${rashaId}/profile-fields`, { label: "حقل من رئيسة النطاق", value: "قيمة" }, head);
    assert.equal(added.status, 201);
    const listed = await api.call("GET", `/district/members/${rashaId}/profile-fields`, undefined, head);
    assert.ok(listed.data.some((item: any) => item.id === added.data.id));

    const school = await api.call("POST", `/district/members/${rashaId}/schools`, { name: "متوسطة من رئيسة النطاق", students: 300 }, head);
    assert.equal(school.status, 201);
    const tiles = await api.call("GET", `/district/members/${rashaId}/schools/${school.data.id}/staff-tiles`, undefined, head);
    assert.equal(tiles.data.length, 2);
    const roles = await api.call("GET", `/district/members/${rashaId}/schools/${school.data.id}/leadership`, undefined, head);
    const roleFields = await api.call("GET", `/district/members/${rashaId}/leadership/${roles.data[0].id}/fields`, undefined, head);
    const principal = await api.call("PATCH", `/district/members/${rashaId}/leadership/${roles.data[0].id}/fields/${roleFields.data[0].id}`, { value: "أ. هند" }, head);
    assert.equal(principal.status, 200);
    const pd = await api.call("POST", `/district/members/${rashaId}/pd`, { label: "مجتمع تعلم", kind: "plc", count: 3 }, head);
    assert.equal(pd.status, 201);
    const section = await api.call("POST", `/district/members/${rashaId}/sections`, { label: "قسم" }, head);
    const sectionField = await api.call("POST", `/district/members/${rashaId}/sections/${section.data.id}/fields`, { label: "بند", value: "١" }, head);
    assert.equal(sectionField.status, 201);

    const evaluation = await api.call("PUT", `/district/members/${rashaId}/indicators/evaluation`, { schoolId: school.data.id, supportType: "دعم مكثف", nafesValue: 81, qudrat: 70, tahsili: 65 }, head);
    assert.equal(evaluation.status, 200, JSON.stringify(evaluation.error));
    assert.equal(evaluation.data.nafesValue, 81);
    const memberEvaluation = await api.call("PUT", "/cluster/me/indicators/evaluation", { schoolId: school.data.id, nafesValue: 10 }, rasha);
    assert.equal(memberEvaluation.status, 200);
    const [stored] = await api.sql`select nafes_value from evaluation_indicators where school_id = ${school.data.id}`;
    assert.equal(stored.nafesValue, 81, "members still cannot set imported evaluation values");
    const madrasati = await api.call("PUT", `/district/members/${rashaId}/indicators/madrasati`, { schoolId: school.data.id, metrics: [1, 2, 3, 4, 5, 6] }, head);
    assert.equal(madrasati.status, 200);
    const discipline = await api.call("PUT", `/district/members/${rashaId}/indicators/discipline`, { schoolId: school.data.id, daily: 90 }, head);
    assert.equal(discipline.status, 200);
    const outOfRange = await api.call("PUT", `/district/members/${rashaId}/indicators/discipline`, { schoolId: school.data.id, daily: 120 }, head);
    assert.equal(outOfRange.status, 422, "percentages keep their 0–100 range");

    const detail = (await api.call("GET", `/district/members/${rashaId}`, undefined, head)).data.workspace;
    const headSchool = detail.schools.find((item: any) => item.id === school.data.id);
    assert.equal(headSchool.evaluation.supportType, "دعم مكثف");
    assert.equal(headSchool.discipline.daily, 90);
  });

  test("the head's edits are not the member's activity, and members cannot use the mirrors", async () => {
    const [maha] = await api.sql`select id from profiles where email = 'maha.member@example.com'`;
    const workspace = (await api.call("GET", `/district/members/${maha.id}`, undefined, head)).data.workspace;
    const edit = await api.call("PATCH", `/district/members/${maha.id}/profile-fields/${field(workspace, "phone").id}`, { value: "0555" }, head);
    assert.equal(edit.status, 200);
    const summary = (await api.team(head)).find(item => item.id === maha.id);
    assert.equal(summary.submission, "missing");
    assert.equal(summary.lastActivityAt, null);
    assert.equal((await api.call("GET", `/district/members/${maha.id}/profile-fields`, undefined, rasha)).status, 403);
    assert.equal((await api.call("GET", "/district/members/00000000-0000-0000-0000-000000000000/profile-fields", undefined, head)).status, 404);
    const otherField = await api.call("PATCH", `/district/members/${maha.id}/profile-fields/${field((await api.call("GET", "/member/workspace", undefined, rasha)).data, "phone").id}`, { value: "x" }, head);
    assert.equal(otherField.status, 404, "a field of another member's file is not found under this member");
  });
});
