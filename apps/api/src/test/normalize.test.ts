// Arabic normalization, name matching and spreadsheet-header recognition.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { testRoster as roster } from "./roster.fixture.js";

process.env.RASD_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), "rasd-test-")), "rasd.sqlite");

let normalize: typeof import("../agent/normalize.js");
let names: typeof import("../agent/names.js");
let importer: typeof import("../agent/importer.js");

describe("normalization and matching", () => {
  before(async () => {
    normalize = await import("../agent/normalize.js");
    names = await import("../agent/names.js");
    importer = await import("../agent/importer.js");
  });

  test("normalizeArabic unifies letters, strips tashkeel/tatweel, converts digits", () => {
    assert.equal(normalize.normalizeArabic("أإآٱ"), "اااا");
    assert.equal(normalize.normalizeArabic("مُشْرِفَـــة"), "مشرفه");
    assert.equal(normalize.normalizeArabic("مستوى"), "مستوي");
    assert.equal(normalize.normalizeArabic("رؤية"), "رويه");
    assert.equal(normalize.normalizeArabic("مسائل"), "مسايل");
    assert.equal(normalize.normalizeArabic("٠٥٥١٢٣٤٥٦٧ ۱۲"), "0551234567 12");
    assert.equal(normalize.normalizeArabic("Rasha@GMAIL.com"), "rasha@gmail.com");
    assert.equal(normalize.normalizeText("  وش   وضع،   الفريق؟ "), "وش وضع الفريق");
  });

  test("tokens carry forms without attached و/ب/ل/ف/ك and ال", () => {
    const [token] = normalize.tokenize("وبالزهراني");
    assert.ok(token.variants.includes("زهراني"));
    assert.ok(normalize.tokenize("لرشا")[0].variants.includes("رشا"));
    assert.equal(normalize.tokenize("جوال رشا؟").at(-1)!.punct, true);
  });

  test("names: first, family (with or without ال), first+family, typos, emails, ties", () => {
    const index = names.buildNameIndex(roster.map((entry, i) => ({ id: String(i), name: entry.name, email: entry.email })));
    const who = (text: string) => names.findMentions(normalize.tokenize(text), index).map(mention => mention.candidates.map(id => roster[Number(id)].name));
    assert.deepEqual(who("ملف رشا"), [["رشا خالد سعد القرني"]]);
    assert.deepEqual(who("الزهراني"), [["فاطمة ناصر علي الزهراني"]]);
    assert.deepEqual(who("زهراني"), [["فاطمة ناصر علي الزهراني"]]);
    assert.deepEqual(who("فاطمة الدوسري"), [["فاطمة عوض الدوسري"]]);
    assert.deepEqual(who("الشهرني"), [["جوهرة عبدالله سعد الشهراني"]]);
    assert.deepEqual(who("jawhara.member"), [["جوهرة عبدالله سعد الشهراني"]]);
    assert.equal(who("فاطمة")[0].length, 3);
    assert.equal(who("هيفاء")[0].length, 2);
    assert.deepEqual(who("السلام عليكم"), [], "greetings are not names");
    assert.deepEqual(who("تقرير شهري للمدارس"), [], "everyday words that are also family names need context");
  });

  test("matchFullName is strict for file cells", () => {
    const index = names.buildNameIndex(roster.map((entry, i) => ({ id: String(i), name: entry.name, email: entry.email })));
    assert.equal(names.matchFullName("منيرة فهد عبدالرحمن الرويلي ", index).id, "4");
    assert.equal(names.matchFullName("رشا القرني", index).id, "0");
    assert.equal(names.matchFullName("فاطمة", index).id, null);
    assert.equal(names.matchFullName("نورة القحطاني", index).id, null);
  });

  test("spreadsheet headers map to profile fields, school fields, or custom fields", () => {
    const kind = (header: string) => {
      const column = importer.classifyHeader(header);
      return column.kind === "profile" ? column.fieldId : column.kind === "school" ? `school.${column.key}` : column.kind;
    };
    assert.equal(kind("الاسم رباعي"), "name");
    assert.equal(kind("البريد الالكتروني الخاص ( gmail )"), "email");
    assert.equal(kind("رقم الجوال"), "phone");
    assert.equal(kind("واتساب"), "phone");
    assert.equal(kind("السجل المدني"), "national_id");
    assert.equal(kind("الرقم الوظيفي"), "employee_no");
    assert.equal(kind("البريد الوزاري"), "moe_email");
    assert.equal(kind("التخصص الإشرافي"), "supervision_major");
    assert.equal(kind("تاريخ التعيين"), "hire_date");
    assert.equal(kind("اسم المدرسة"), "school.name");
    assert.equal(kind("عدد الطالبات"), "school.students");
    assert.equal(kind("مديرة المدرسة"), "school.principal");
    assert.equal(kind("اسم المشرفة"), "member");
    assert.equal(kind("م"), "ignore");
    assert.equal(kind("الدورات التدريبية"), "custom");
  });
});
