// Test fixture: a throw-away database seeded with a fictional roster plus realistic profiles, schools, visits and files.
// Call setupFixture() before importing anything that touches the database.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { testRoster } from "./roster.fixture.js";

export function xlsxBuffer(sheets: Record<string, (string | number)[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

type ZipWriter = {
  utils: { cfb_new: (options: { root: string }) => unknown; cfb_add: (zip: unknown, path: string, content: Buffer) => void };
  write: (zip: unknown, options: { fileType: "zip"; type: "buffer"; compression: boolean }) => Uint8Array;
};

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A minimal real .docx (paragraphs, then an optional table) built with the zip writer bundled in SheetJS. */
export function docxBuffer(paragraphs: string[], table: string[][] = []) {
  const zip = (XLSX as unknown as { CFB: ZipWriter }).CFB;
  const run = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const rows = table.map(row => `<w:tr>${row.map(cell => `<w:tc>${run(cell)}</w:tc>`).join("")}</w:tr>`).join("");
  const body = `${paragraphs.map(run).join("")}${rows ? `<w:tbl>${rows}</w:tbl>` : ""}`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  };
  const archive = zip.utils.cfb_new({ root: "R" });
  for (const [path, content] of Object.entries(files)) zip.utils.cfb_add(archive, path, Buffer.from(content, "utf8"));
  return Buffer.from(zip.write(archive, { fileType: "zip", type: "buffer", compression: true }));
}

export async function setupFixture(options: { seedData?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rasd-test-"));
  process.env.RASD_DATABASE_FILE = join(dir, "rasd.sqlite");
  // Seed the fictional team, never the real roster file in apps/api/data.
  process.env.RASD_ROSTER_FILE = join(dir, "roster.json");
  writeFileSync(process.env.RASD_ROSTER_FILE, JSON.stringify(testRoster));
  process.env.ANTHROPIC_API_KEY = ""; // the local engine, even when apps/api/.env has a key
  process.env.APP_URL = "https://rasd.example";

  const accounts = await import("../accounts.js");
  const workspaces = await import("../workspaces.js");
  const documents = await import("../documents.js");
  const agent = await import("../agent/index.js");
  const chat = await import("../chat-store.js");
  accounts.seedAccounts();
  const head = accounts.headAccount()!;
  const members = accounts.membersOfHead(head.id);
  const byEmail = (email: string) => members.find(member => member.email === email)!;

  const rasha = byEmail("rasha.member@example.com");
  const muneera = byEmail("munira.member@example.com");
  const maha = byEmail("maha.member@example.com");
  const manal = byEmail("manal.member@example.com");
  const fatimaDosari = byEmail("fatima3.member@example.com");

  if (options.seedData !== false) {
    accounts.activateAccount(rasha.email, "1234");
    accounts.activateAccount(maha.email, "1234");
    accounts.activateAccount(muneera.email, "1234");

    workspaces.setProfileValues(rasha, [
      { fieldId: "phone", fieldLabel: "رقم الجوال", value: "0551112233" },
      { fieldId: "national_id", fieldLabel: "السجل المدني", value: "1012345678" },
      { fieldId: "employee_no", fieldLabel: "الرقم الوظيفي", value: "445566" },
      { fieldId: "moe_email", fieldLabel: "البريد الوزاري", value: "r.qarni@moe.gov.sa" },
      { fieldId: "cluster", fieldLabel: "العنقود", value: "عنقود ٤" },
      { fieldId: "rank", fieldLabel: "الرتبة", value: "متقدم" },
      { fieldId: "qualification", fieldLabel: "المؤهل", value: "ماجستير" },
      { fieldId: "major", fieldLabel: "التخصص", value: "رياضيات" },
      { fieldId: "supervision_major", fieldLabel: "التخصص الإشرافي", value: "إشراف تربوي — رياضيات" },
      { fieldId: "hire_date", fieldLabel: "تاريخ التعيين", value: "2010-09-01" },
      { fieldId: "assignment_date", fieldLabel: "تاريخ التكليف بالإشراف", value: "2019-09-01" },
      { fieldId: null, fieldLabel: "الدورات التدريبية", value: "٣ دورات" },
    ]);
    workspaces.setProfileValues(muneera, [
      { fieldId: "phone", fieldLabel: "رقم الجوال", value: "0509998877" },
      { fieldId: "rank", fieldLabel: "الرتبة", value: "خبير" },
    ]);
    workspaces.setProfileValues(maha, [{ fieldId: "qualification", fieldLabel: "المؤهل", value: "بكالوريوس" }]);

    const school = (name: string, stage: string, students: number, teachers: number, tier: string) => ({
      ...emptySchoolLike(name), stage, students, teachers, tier,
    });
    workspaces.saveWorkspace(rasha, { schools: [school("الابتدائية ١٢٠", "ابتدائي", 420, 31, "تميز"), school("المتوسطة ٣٣", "متوسط", 380, 28, "تقدم")] });
    workspaces.saveWorkspace(maha, { schools: [school("الثانوية ٧", "ثانوي", 510, 40, "انطلاق")] });

    workspaces.createVisit(rasha.id, { type: "زيارة إشرافية", text: "متابعة خطة التحسين في الرياضيات وحضور حصتين", schoolName: "الابتدائية ١٢٠" }, []);
    workspaces.createVisit(maha.id, { type: "زيارة فنية", text: "مراجعة نتائج اختبارات نافس للصف الثالث", schoolName: "الثانوية ٧" }, []);

    await documents.saveDocument({
      ownerId: rasha.id, uploadedBy: rasha.id, name: "خطة التحسين.txt", mime: "text/plain",
      buffer: Buffer.from("خطة التحسين المدرسي للفصل الأول\nالهدف: رفع نتائج نافس في الرياضيات بنسبة ١٠٪\nالمسؤولة: رشا القرني", "utf8"),
    });
    await documents.saveDocument({
      ownerId: maha.id, uploadedBy: maha.id, name: "حصر المدارس.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxBuffer({ "المدارس": [["اسم المدرسة", "عدد الطالبات"], ["الثانوية ٧", 510], ["الثانوية ٩", 300]] }),
    });
    await documents.saveDocument({
      ownerId: muneera.id, uploadedBy: muneera.id, name: "تقرير الزيارات.csv", mime: "text/csv",
      buffer: Buffer.from("المدرسة,الملاحظة\nالابتدائية ٥,تحتاج دعماً في القراءة\nالمتوسطة ٢,برنامج الموهوبات ممتاز", "utf8"),
    });
  }

  let conversationId = chat.createConversation(head.id, "اختبار").id;
  /** Sends a message through the agent and stores both turns like the real route does. */
  async function ask(text: string, attachmentIds: string[] = []) {
    const attachments = attachmentIds.map(id => documents.getDocument(id)!).filter(Boolean);
    const history = chat.listMessages(conversationId);
    chat.addMessage(conversationId, { role: "user", text, attachments: attachments.map(item => ({ id: item.id, name: item.name, kind: item.kind, size: item.size })) });
    const reply = await agent.respond({ head, conversationId, history, attachments }, text);
    chat.addMessage(conversationId, { role: "assistant", text: reply.text, blocks: reply.blocks });
    return reply;
  }
  const newConversation = () => { conversationId = chat.createConversation(head.id, "اختبار").id; };

  return { head, members, rasha, muneera, maha, manal, fatimaDosari, accounts, workspaces, documents, agent, chat, ask, newConversation };
}

function emptySchoolLike(name: string) {
  return {
    id: `school-${name}`, name, stage: "", area: "", ministryNo: "", email: "", educationType: "", specialEducation: "", hasGuard: "",
    classes: 0, students: 0, giftedClasses: 0, giftedStudents: 0, teachesChinese: "", teachers: 0, admin: 0, deputies: 0, expert: 0, advanced: 0,
    tier: "", support: "", nafes: "", qudrat: 0, tahsili: 0, madrasati: [0, 0, 0, 0, 0, 0], discipline: [0, 0, 0], absence: false, principal: "",
  };
}
