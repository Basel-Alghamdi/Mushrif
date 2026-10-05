// Documents on attachments + Storage: upload, extraction, safe downloads, permissions, soft delete.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DocumentInfo } from "@rasd/schemas";
import { HEAD_EMAIL, startApi, xlsxBuffer, type TestApi } from "./harness.js";

let api: TestApi;
let head = "";
let rasha = "";
let maha = "";
let rashaId = "";
let uploaded: DocumentInfo[] = [];

const filesForm = (files: { name: string; type: string; content: BlobPart }[]) => {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([file.content], { type: file.type }), file.name);
  return form;
};

describe("documents", () => {
  before(async () => {
    api = await startApi();
    head = await api.signInHead();
    rasha = await api.activate("rasha.member@example.com");
    maha = await api.activate("maha.member@example.com");
    const [row] = await api.sql`select id from profiles where email = 'rasha.member@example.com'`;
    rashaId = String(row.id);
  });
  after(async () => { await api.stop(); });

  test("a member uploads a spreadsheet and an HTML file; text and tables are extracted", async () => {
    const xlsx = xlsxBuffer({ "المدارس": [["المدرسة", "الطالبات"], ["الابتدائية ١٢٠", 540], ["المتوسطة ٣", 320]] });
    const result = await api.call<DocumentInfo[]>("POST", "/cluster/me/documents", filesForm([
      { name: "مدارسي.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: new Uint8Array(xlsx) },
      // The browser claims text/html but also lies elsewhere: the server never trusts the client type.
      { name: "page.html", type: "image/png", content: "<html><script>alert(1)</script><p>مرحبا</p></html>" },
    ]), rasha);
    assert.equal(result.status, 201, JSON.stringify(result.error));
    uploaded = result.data;
    const sheet = uploaded.find(item => item.name === "مدارسي.xlsx")!;
    assert.equal(sheet.kind, "spreadsheet");
    assert.equal(sheet.status, "ready");
    assert.deepEqual(sheet.sheets, ["المدارس"]);
    assert.equal(sheet.ownerId, rashaId);
    assert.equal(sheet.uploadedBy, rashaId);
    assert.match(sheet.excerpt, /الابتدائية ١٢٠ \| 540/);
    const html = uploaded.find(item => item.name === "page.html")!;
    assert.equal(html.kind, "text");
    assert.equal(html.mime, "application/octet-stream");

    const [content] = await api.sql`select tables::text as tables, status from attachment_contents where attachment_id = ${sheet.id}`;
    assert.equal(content.status, "ready");
    assert.deepEqual(JSON.parse(content.tables), [{ sheet: "المدارس", rows: [["المدرسة", "الطالبات"], ["الابتدائية ١٢٠", "540"], ["المتوسطة ٣", "320"]] }]);
    const detail = await api.call("GET", `/attachments/${sheet.id}`, undefined, rasha);
    assert.match(detail.data.text, /المتوسطة ٣/);

    const list = await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha);
    assert.equal(list.data.length, 2);
    const summary = (await api.team(head)).find(item => item.id === rashaId);
    assert.equal(summary.documentCount, 2);
    assert.equal(summary.submission, "submitted", "an upload counts as updating today");
  });

  test("downloads use a safe content type and sandbox headers", async () => {
    const html = uploaded.find(item => item.name === "page.html")!;
    const download = await api.call("GET", `/attachments/${html.id}/download`, undefined, rasha);
    assert.equal(download.status, 200);
    assert.equal(download.response.headers.get("content-type"), "application/octet-stream");
    assert.equal(download.response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(download.response.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    assert.match(download.response.headers.get("content-disposition")!, /^attachment; filename="page.html"; filename\*=UTF-8''page.html$/);
    assert.match(await download.response.text(), /<script>/, "the bytes come back unchanged from Storage");
    const preview = await api.call("GET", `/attachments/${html.id}/preview`, undefined, rasha);
    assert.match(preview.response.headers.get("content-disposition")!, /^attachment;/, "HTML is never shown inline");

    const sheet = uploaded.find(item => item.name === "مدارسي.xlsx")!;
    const sheetDownload = await api.call("GET", `/attachments/${sheet.id}/download`, undefined, rasha);
    assert.equal(sheetDownload.response.headers.get("content-type"), "application/octet-stream");
    assert.match(sheetDownload.response.headers.get("content-disposition")!, /filename\*=UTF-8''%D9%85%D8%AF%D8%A7%D8%B1%D8%B3%D9%8A\.xlsx/);

    const csv = await api.call<DocumentInfo[]>("POST", "/cluster/me/documents", filesForm([{ name: "list.csv", type: "text/html", content: "a,b\n1,2" }]), rasha);
    const csvPreview = await api.call("GET", `/attachments/${csv.data[0].id}/preview`, undefined, rasha);
    assert.equal(csvPreview.response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.match(csvPreview.response.headers.get("content-disposition")!, /^inline;/);
  });

  test("another member gets 404; the head of the district can read them", async () => {
    const sheet = uploaded[0];
    for (const path of [`/attachments/${sheet.id}`, `/attachments/${sheet.id}/download`, `/attachments/${sheet.id}/preview`]) {
      assert.equal((await api.call("GET", path, undefined, maha)).status, 404, path);
    }
    assert.equal((await api.call("DELETE", `/attachments/${sheet.id}`, undefined, maha)).status, 404);
    assert.equal((await api.call("GET", `/attachments/${sheet.id}/download`, undefined, head)).status, 200);
    const memberFiles = await api.call<DocumentInfo[]>("GET", `/district/members/${rashaId}/attachments`, undefined, head);
    assert.equal(memberFiles.data.length, 3);
    assert.ok(memberFiles.data.every(item => item.ownerName === "رشا خالد سعد القرني" && typeof item.excerpt === "string"));
    assert.equal((await api.call("GET", "/attachments/not-a-uuid", undefined, head)).status, 404);
  });

  test("the head uploads into a member's file; limits are enforced", async () => {
    const result = await api.call<DocumentInfo[]>("POST", `/district/members/${rashaId}/documents`, filesForm([{ name: "تقرير.txt", type: "text/plain", content: "تقرير الزيارة" }]), head);
    assert.equal(result.status, 201);
    assert.equal(result.data[0].ownerId, rashaId);
    assert.equal(result.data[0].uploadedByName, "خلود");
    assert.equal((await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha)).data.length, 4);
    const district = await api.call<DocumentInfo[]>("GET", "/district/documents", undefined, head);
    assert.equal(district.data.length, 4);
    const none = await api.call("POST", "/cluster/me/documents", new FormData(), rasha);
    assert.equal(none.status, 422);
    const many = await api.call("POST", "/cluster/me/documents", filesForm(Array.from({ length: 21 }, (_, index) => ({ name: `${index}.txt`, type: "text/plain", content: "x" }))), rasha);
    assert.equal(many.status, 413);
  });

  test("ملف الإنجاز: files go into her folders and her schools' folders, move, and never land in another member's school", async () => {
    const school = await api.call<{ id: string }>("POST", "/cluster/me/schools", { name: "الثانوية التاسعة بعد المائة" }, rasha);
    const otherSchool = await api.call<{ id: string }>("POST", "/cluster/me/schools", { name: "مدرسة مها" }, maha);
    assert.ok(school.data?.id && otherSchool.data?.id, JSON.stringify(school.error ?? otherSchool.error));
    const into = (folder: string, schoolId = "") => {
      const form = filesForm([{ name: "خطة.txt", type: "text/plain", content: "خطة" }]);
      form.append("folder", folder);
      if (schoolId) form.append("schoolId", schoolId);
      return form;
    };

    const own = await api.call<DocumentInfo[]>("POST", "/cluster/me/documents", into("professional_development"), rasha);
    assert.equal(own.status, 201, JSON.stringify(own.error));
    assert.deepEqual([own.data[0].folder, own.data[0].schoolId, own.data[0].schoolName], ["professional_development", null, null]);
    const inSchool = await api.call<DocumentInfo[]>("POST", "/cluster/me/documents", into("discipline", school.data.id), rasha);
    assert.equal(inSchool.status, 201, JSON.stringify(inSchool.error));
    assert.deepEqual([inSchool.data[0].folder, inSchool.data[0].schoolId, inSchool.data[0].schoolName], ["discipline", school.data.id, "الثانوية التاسعة بعد المائة"]);
    const byHead = await api.call<DocumentInfo[]>("POST", `/district/members/${rashaId}/documents`, into("visit_reports", school.data.id), head);
    assert.equal(byHead.status, 201, JSON.stringify(byHead.error));
    assert.equal(byHead.data[0].folder, "visit_reports");

    // Refused before anything is stored: unknown folders, «مدارس المشرفة» itself, a school folder without its school,
    // her own folder inside a school, a school without a folder, and another member's school.
    const before = (await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha)).data.length;
    const refusals: [string, string, number][] = [
      ["random", "", 422], ["schools", "", 422], ["discipline", "", 422], ["professional_development", school.data.id, 422],
      ["", school.data.id, 422], ["discipline", otherSchool.data.id, 404], ["discipline", "not-a-uuid", 404],
    ];
    for (const [folder, schoolId, status] of refusals) {
      assert.equal((await api.call("POST", "/cluster/me/documents", into(folder, schoolId), rasha)).status, status, `${folder} ${schoolId}`);
    }
    assert.equal((await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha)).data.length, before);

    // Moving: within her tree only; the head can move her files too; every move is audited.
    const id = own.data[0].id;
    const moved = await api.call<DocumentInfo>("PATCH", `/attachments/${id}`, { folder: "support_plan", schoolId: school.data.id }, rasha);
    assert.equal(moved.status, 200, JSON.stringify(moved.error));
    assert.deepEqual([moved.data.folder, moved.data.schoolId], ["support_plan", school.data.id]);
    assert.equal((await api.call("PATCH", `/attachments/${id}`, { folder: "discipline", schoolId: otherSchool.data.id }, rasha)).status, 404);
    assert.equal((await api.call("PATCH", `/attachments/${id}`, { folder: "initiatives" }, maha)).status, 404, "not her file");
    assert.equal((await api.call("PATCH", `/attachments/${id}`, {}, rasha)).status, 422);
    const back = await api.call<DocumentInfo>("PATCH", `/attachments/${id}`, { folder: "performance_charter" }, head);
    assert.deepEqual([back.data.folder, back.data.schoolId], ["performance_charter", null]);
    const [audit] = await api.sql`select after from audit_log where entity = 'document' and action = 'move' and entity_id = ${id} order by at desc limit 1`;
    assert.deepEqual(audit.after, { folder: "performance_charter", schoolId: null });

    // Files from before the folders stay listed (folder null) until they are moved; a removed school takes no new files.
    const list = await api.call<DocumentInfo[]>("GET", "/cluster/me/documents", undefined, rasha);
    assert.ok(list.data.some(item => item.folder === null && item.schoolId === null));
    await api.sql`update schools set deleted_at = now() where id = ${school.data.id}`;
    assert.equal((await api.call("POST", "/cluster/me/documents", into("discipline", school.data.id), rasha)).status, 404);
  });

  test("delete is a soft delete", async () => {
    const target = uploaded.find(item => item.name === "page.html")!;
    const deleted = await api.call("DELETE", `/attachments/${target.id}`, undefined, rasha);
    assert.deepEqual(deleted.data, { deleted: true });
    assert.equal((await api.call("GET", `/attachments/${target.id}`, undefined, rasha)).status, 404);
    const [row] = await api.sql`select deleted_at from attachments where id = ${target.id}`;
    assert.ok(row.deletedAt);
  });
});
