// Test fixture for the agent: a throw-away local stack (embedded PostgreSQL + fake Supabase, see src/test/support) with
// the FICTIONAL team (src/test/roster.fixture.ts — never the real roster), filled with realistic data the way the app
// fills it: members sign in and edit their own files over HTTP, the head sets a cluster label.
// Call setupFixture() before importing anything that touches the database, and stop() when done.
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { riyadhDate, type ChatAttachment } from "@rasd/schemas";
import { HEAD_EMAIL, startApi, xlsxBuffer } from "./api/harness.js";

export { xlsxBuffer };

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

const filesForm = (name: string, content: Buffer | string) => {
  const form = new FormData();
  form.append("files", new Blob([typeof content === "string" ? content : new Uint8Array(content)]), name);
  return form;
};

export type TeamMember = { id: string; name: string; email: string; title: string; clusterId: string };

export async function setupFixture(options: { seedData?: boolean } = {}) {
  const api = await startApi();
  const { sql, call } = api;
  const headToken = await api.signInHead();
  const { loadActor } = await import("../auth.js");
  const agent = await import("../agent/index.js");
  const chat = await import("../chat-store.js");
  const documents = await import("../documents.js");
  const { loadTeam } = await import("../agent/snapshot.js");

  const [headRow] = await sql`select id from profiles where email = ${HEAD_EMAIL}`;
  const head = (await loadActor(String(headRow.id)))!;
  const audit = { actor: head, source: "agent" as const, ip: null };
  const members: TeamMember[] = (await sql`
    select p.id, p.name, p.email, p.title, c.id as cluster_id from profiles p join clusters c on c.member_id = p.id
    where p.role = 'member' order by p.created_at`).map(row => ({ id: String(row.id), name: row.name, email: row.email, title: row.title, clusterId: String(row.clusterId) }));
  const byEmail = (email: string) => members.find(member => member.email === email)!;
  const rasha = byEmail("rasha.member@example.com");
  const muneera = byEmail("munira.member@example.com");
  const maha = byEmail("maha.member@example.com");
  const manal = byEmail("manal.member@example.com");
  const fatimaDosari = byEmail("fatima3.member@example.com");
  const tokens = new Map<string, string>();

  /** A request that must succeed (seeding goes through the same endpoints the app uses). */
  async function must<T = any>(method: string, path: string, body: unknown, token: string): Promise<T> {
    const result = await call<T>(method, path, body, token);
    assert.ok(result.status < 300, `${method} ${path} → ${result.status} ${JSON.stringify(result.error)}`);
    return result.data;
  }

  if (options.seedData !== false) {
    for (const member of [rasha, maha, muneera]) tokens.set(member.id, await api.activate(member.email));
    const as = (member: TeamMember) => <T = any>(method: string, path: string, body?: unknown) => must<T>(method, path, body, tokens.get(member.id)!);

    async function setFields(member: TeamMember, values: Record<string, string>) {
      const workspace = await as(member)("GET", "/member/workspace");
      for (const [key, value] of Object.entries(values)) {
        const field = workspace.profile.find((item: { key: string | null }) => item.key === key);
        await as(member)("PATCH", `/cluster/me/profile-fields/${field.id}`, { value });
      }
    }
    async function addSchool(member: TeamMember, school: Record<string, unknown>, teachers: number, absenceToday = false) {
      const created = await as(member)("POST", "/cluster/me/schools", school);
      const tiles = await as(member)<{ id: string; label: string }[]>("GET", `/schools/${created.id}/staff-tiles`);
      await as(member)("PATCH", `/schools/${created.id}/staff-tiles/${tiles.find(tile => tile.label === "الهيئة التعليمية")!.id}`, { value: teachers });
      if (absenceToday) await as(member)("PUT", `/schools/${created.id}/absence`, { date: riyadhDate(), done: true });
      return created.id as string;
    }
    const upload = (member: TeamMember, name: string, content: Buffer | string) => as(member)("POST", "/cluster/me/documents", filesForm(name, content));

    // رشا: a complete file (every profile field, schools with their core data and today's absence, the five plans).
    await setFields(rasha, {
      nationalId: "1012345678", employeeNo: "445566", email: "r.qarni@moe.gov.sa", phone: "0551112233", rank: "متقدم", qualification: "ماجستير",
      major: "رياضيات", supervisoryMajor: "إشراف تربوي — رياضيات", hireDate: "2010-09-01", supervisionStart: "2019-09-01",
    });
    await as(rasha)("POST", "/cluster/me/profile-fields", { label: "الدورات التدريبية", value: "٣ دورات" });
    await must("PATCH", `/district/members/${rasha.id}/contact`, { clusterLabel: "عنقود ٤" }, headToken);
    const school120 = await addSchool(rasha, { name: "الابتدائية ١٢٠", stage: "ابتدائي", area: "النزهة", ministryNo: "120120", classes: 14, students: 420, tier: "تميز" }, 31, true);
    await addSchool(rasha, { name: "المتوسطة ٣٣", stage: "متوسط", area: "الروضة", ministryNo: "330033", classes: 12, students: 380, tier: "تقدم" }, 28, true);
    for (const plan of await as(rasha)<{ id: string }[]>("GET", "/cluster/me/plans")) await as(rasha)("PATCH", `/plans/${plan.id}`, { url: "https://drive.example/plan" });
    await as(rasha)("POST", "/visits", { schoolId: school120, type: "زيارة إشرافية", text: "متابعة خطة التحسين في الرياضيات وحضور حصتين" });
    await upload(rasha, "خطة التحسين.txt", "خطة التحسين المدرسي للفصل الأول\nالهدف: رفع نتائج نافس في الرياضيات بنسبة ١٠٪\nالمسؤولة: رشا القرني");

    // مها: one school, a visit and a spreadsheet.
    await setFields(maha, { qualification: "بكالوريوس" });
    const school7 = await addSchool(maha, { name: "الثانوية ٧", stage: "ثانوي", students: 510, tier: "انطلاق" }, 40);
    await as(maha)("POST", "/visits", { schoolId: school7, type: "زيارة فنية", text: "مراجعة نتائج اختبارات نافس للصف الثالث" });
    await upload(maha, "حصر المدارس.xlsx", xlsxBuffer({ "المدارس": [["اسم المدرسة", "عدد الطالبات"], ["الثانوية ٧", 510], ["الثانوية ٩", 300]] }));

    // منيرة: two profile values and a CSV.
    await setFields(muneera, { phone: "0509998877", rank: "خبير" });
    await upload(muneera, "تقرير الزيارات.csv", "المدرسة,الملاحظة\nالابتدائية ٥,تحتاج دعماً في القراءة\nالمتوسطة ٢,برنامج الموهوبات ممتاز");
  }

  // ---------- the conversation, exactly as routes/chat.ts drives the agent ----------
  let conversationId: string | null = null;
  const conversation = async () => (conversationId ??= (await chat.createConversation(sql, head.id, "اختبار")).id);
  const chatAttachment = (document: { id: string; name: string; kind: ChatAttachment["kind"]; size: number }): ChatAttachment =>
    ({ id: document.id, name: document.name, kind: document.kind, size: document.size });

  /** Sends a message through the agent and stores both turns like the real route does. */
  async function ask(text: string, attachmentIds: string[] = []) {
    const id = await conversation();
    const attachments = (await Promise.all(attachmentIds.map(item => documents.getDocument(sql, item)))).filter(<T>(item: T | null): item is T => Boolean(item));
    const history = await chat.listMessages(sql, id);
    await chat.addMessage(sql, id, { role: "user", text, attachments: attachments.map(chatAttachment) });
    const reply = await agent.respond({ head, conversationId: id, history, attachments, audit }, text);
    await chat.addMessage(sql, id, { role: "assistant", text: reply.text, blocks: reply.blocks });
    return reply;
  }
  /** The next ask() starts a fresh conversation. */
  const newConversation = () => { conversationId = null; };

  /** A file the head attaches in the chat (POST /chat/attachments). */
  async function upload(name: string, content: Buffer | string) {
    const [attachment] = await must<ChatAttachment[]>("POST", "/chat/attachments", filesForm(name, content), headToken);
    return attachment.id;
  }

  const approve = async (proposalId: string) => agent.applyProposal(head, (await chat.getProposal(sql, proposalId))!, audit);
  const team = () => loadTeam(sql, head);
  const detail = async (memberId: string) => (await team()).details.get(memberId)!;
  const profile = async (memberId: string) => (await detail(memberId)).workspace.profile;
  const valueOf = async (memberId: string, fieldId: string) => (await profile(memberId)).find(field => field.id === fieldId)?.value ?? "";
  const account = async (memberId: string) => (await sql`select id, name, email, phone, title, activated_at from profiles where id = ${memberId}`)[0] ?? null;
  const accountByEmail = async (email: string) => (await sql`select id, name, email, phone, title, activated_at from profiles where email = ${email}`)[0] ?? null;
  const document = (id: string) => documents.getDocument(sql, id);

  return {
    api, sql, head, headToken, audit, tokens, members, rasha, muneera, maha, manal, fatimaDosari, agent, chat, documents,
    ask, newConversation, conversation, upload, approve, team, detail, profile, valueOf, account, accountByEmail, document,
    stop: api.stop,
  };
}

export type Fixture = Awaited<ReturnType<typeof setupFixture>>;
