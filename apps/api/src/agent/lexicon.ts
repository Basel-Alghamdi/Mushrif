// Word lists (written in natural Arabic, normalized at load) and the phrase matcher used for intent detection.
import { normalizeArabic, type Token } from "./normalize.js";

type Word = { text: string; prefix: boolean };
export type Phrase = { source: string; words: Word[] };

/** "رقم الجوال" → two words; a trailing "*" means prefix match (جوال* matches جوالها). "ال" is dropped — tokens carry article-free variants. */
export function phrase(source: string): Phrase {
  const words = source.trim().split(/\s+/).map(part => {
    const prefix = part.endsWith("*");
    let text = normalizeArabic(prefix ? part.slice(0, -1) : part).replace(/[^\p{L}\p{N}@._+-]/gu, "");
    if (text.startsWith("ال") && text.length > 4) text = text.slice(2);
    return { text, prefix };
  }).filter(word => word.text);
  return { source, words };
}

export const phrases = (list: string[]) => list.map(phrase).sort(byLength);

function byLength(a: Phrase, b: Phrase) {
  return b.words.length - a.words.length || Number(a.words[0]?.prefix) - Number(b.words[0]?.prefix) || b.source.length - a.source.length;
}

const SUFFIXES = ["ها", "هن", "هم", "ه", "ي", "ك", "نا"];

/** Exact word, the word with an attached pronoun (جوال → جوالها, مدرسه → مدرستها), or a prefix when marked with "*". */
export function wordMatches(token: Token, word: Word) {
  if (token.punct) return false;
  return token.variants.some(variant => {
    if (word.prefix) return variant.startsWith(word.text);
    if (variant === word.text) return true;
    const stems = word.text.endsWith("ه") ? [word.text, `${word.text.slice(0, -1)}ت`] : [word.text];
    return stems.some(stem => SUFFIXES.some(suffix => variant === stem + suffix));
  });
}

export type Span = { start: number; end: number };

export function findPhrase(tokens: Token[], target: Phrase, from = 0): Span | null {
  const size = target.words.length;
  outer: for (let i = from; i <= tokens.length - size; i++) {
    for (let k = 0; k < size; k++) if (!wordMatches(tokens[i + k], target.words[k])) continue outer;
    return { start: i, end: i + size - 1 };
  }
  return null;
}

export const hasAny = (tokens: Token[], list: Phrase[]) => list.some(item => findPhrase(tokens, item) !== null);

export function firstSpan(tokens: Token[], list: Phrase[]): Span | null {
  let best: Span | null = null;
  for (const item of list) {
    const span = findPhrase(tokens, item);
    if (span && (!best || span.start < best.start)) best = span;
  }
  return best;
}

/** Scans left to right and returns non-overlapping matches, longest phrase first at each position. */
export function scan<T extends string>(tokens: Token[], table: { key: T; phrase: Phrase }[]) {
  const found: { key: T; span: Span }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const entry of table) {
      const size = entry.phrase.words.length;
      if (i + size > tokens.length) continue;
      if (entry.phrase.words.every((word, k) => wordMatches(tokens[i + k], word))) {
        found.push({ key: entry.key, span: { start: i, end: i + size - 1 } });
        i += size - 1;
        break;
      }
    }
  }
  return found;
}

function table<T extends string>(source: Record<T, string[]>) {
  return (Object.entries(source) as [T, string[]][])
    .flatMap(([key, list]) => list.map(item => ({ key, phrase: phrase(item) })))
    .sort((a, b) => byLength(a.phrase, b.phrase));
}

// ---------- Profile fields (ids match BUILT_IN_FIELDS in model.ts) ----------
export const PROFILE_FIELD_WORDS: Record<string, string[]> = {
  supervision_major: ["التخصص الإشرافي", "تخصصها الإشرافي", "تخصص إشرافي"],
  moe_email: ["البريد الوزاري", "بريدها الوزاري", "الإيميل الوزاري", "ايميلها الوزاري", "ايميل الوزارة", "بريد الوزارة", "البريد الرسمي", "الإيميل الرسمي"],
  employee_no: ["الرقم الوظيفي", "رقمها الوظيفي", "رقم وظيفي"],
  national_id: ["السجل المدني", "سجلها المدني", "رقم السجل", "السجل", "رقم الهوية", "الهوية الوطنية", "الهوية", "هويتها"],
  hire_date: ["تاريخ التعيين", "تاريخ تعيينها", "متى تعينت", "التعيين", "تاريخ التوظيف"],
  assignment_date: ["تاريخ التكليف", "تاريخ تكليفها", "متى تكلفت", "التكليف"],
  experience_years: ["عدد سنوات الخبرة", "سنوات الخبرة", "سنين الخبرة", "الخبرة", "خبرتها"],
  qualification: ["المؤهل العلمي", "المؤهل", "مؤهلها", "الشهادة", "الدرجة العلمية"],
  major: ["التخصص", "تخصصها"],
  rank: ["الرتبة", "رتبتها"],
  cluster: ["العنقود", "عنقودها"],
  title: ["المسمى الوظيفي", "الصفة", "صفتها", "الصفات", "المسمى", "مسماها", "الوظيفة", "وظيفتها", "المنصب"],
  phone: ["رقم الجوال", "رقم جوالها", "أرقام الجوالات", "ارقام الجوالات", "الجوالات", "جوالات", "رقم الهاتف", "رقم التواصل", "رقم الواتس", "الجوال", "جوالها", "الهاتف", "التلفون", "تلفونها", "الموبايل", "موبايلها", "واتساب", "الواتس", "رقمها", "الرقم"],
  email: ["البريد الإلكتروني", "الإيميلات", "ايميلات", "بريدهن", "البريد الالكتروني الخاص", "البريد الشخصي", "البريد", "بريدها", "الإيميل", "ايميلها", "إيميل", "الجيميل", "جيميل", "gmail", "email", "e-mail", "mail", "الميل"],
  name: ["الاسم الرباعي", "الاسم الكامل", "الاسم", "اسمها", "اسم"],
};
export const PROFILE_FIELD_TABLE = table(PROFILE_FIELD_WORDS);

// ---------- Per-member and team metrics ----------
export type MetricId =
  | "schools" | "students" | "teachers" | "visits" | "documents" | "programs" | "completion"
  | "activated" | "lastLogin" | "lastUpdate" | "submitted" | "missing" | "absence" | "members";

export const METRIC_WORDS: Record<MetricId, string[]> = {
  teachers: ["المعلمات", "معلمات", "معلمة", "معلماتها", "المعلمين", "معلمين", "المدرسات", "مدرسات", "الكادر التعليمي"],
  students: ["الطالبات", "طالبات", "طالبة", "طالباتها", "الطلاب", "طلاب", "طالب", "الطلبة"],
  schools: ["المدارس", "مدارس", "مدارسها", "مدارسهن", "المدراس", "مدراس", "مدرسة", "مدرستها", "مدرسه*"],
  visits: ["الزيارات", "زيارات", "زيارة", "زياراتها", "الزيارات الإشرافية"],
  documents: ["الملفات المرفوعة", "الملفات", "ملفات", "ملفاتها", "المرفقات", "مرفقات", "مرفقاتها", "المستندات", "مستندات", "الشواهد", "شواهد", "التقارير المرفوعة"],
  programs: ["البرامج", "برامج", "برنامج", "برامجها", "المبادرات", "مبادرات"],
  completion: ["نسبة الاكتمال", "نسبة الإنجاز", "الاكتمال", "اكتمال", "الإنجاز", "إنجاز", "النسبة", "نسبتها", "اكتمال*"],
  lastLogin: ["آخر دخول", "متى دخلت", "اخر مرة دخلت"],
  lastUpdate: ["آخر تحديث", "متى حدثت", "متى عدلت", "آخر تعديل", "اخر مرة حدثت", "حدثت ملفها"],
  activated: ["فعلت حسابها", "فعلت", "تفعيل", "مفعل", "مفعلة", "دخلت", "سجلت دخول", "الدخول", "دخول"],
  submitted: ["أرسلت", "ارسلت", "الإرسال", "أرسلن", "رفعت التحديث", "سلمت"],
  missing: ["النواقص", "نواقص", "نواقصها", "ناقص", "ناقصة", "ناقصها", "ناقصهن", "المتبقي", "الباقي", "باقي", "ينقصها", "ينقص", "تنقصها"],
  absence: ["الغياب", "غياب", "رصد الغياب"],
  members: ["المشرفات", "مشرفات", "المشرفة", "العضوات", "عضوات", "الأعضاء", "أعضاء", "الفريق"],
};
export const METRIC_TABLE = table(METRIC_WORDS);

export const METRIC_LABELS: Record<MetricId, string> = {
  schools: "المدارس", students: "الطالبات", teachers: "المعلمات", visits: "الزيارات", documents: "الملفات", programs: "البرامج",
  completion: "الاكتمال", activated: "تفعيل الحساب", lastLogin: "آخر دخول", lastUpdate: "آخر تحديث", submitted: "الإرسال",
  missing: "النواقص", absence: "رصد الغياب اليوم", members: "المشرفات",
};

// ---------- Intent words ----------
export const W = {
  greet: phrases(["السلام عليكم", "السلام", "سلام", "مرحبا", "مرحبتين", "هلا", "اهلين", "أهلا", "هاي", "hi", "hello", "صباح الخير", "مساء الخير", "صباح", "مساء", "هلا والله"]),
  thanks: phrases(["شكرا", "شكراً", "مشكورة", "مشكور", "يعطيك العافية", "تسلمين", "تسلم", "جزاك الله", "الله يعافيك", "ممتاز", "تمام", "حلو", "رائع", "thanks"]),
  help: phrases(["مساعدة", "ساعديني", "وش تقدرين", "وش تقدر", "ايش تقدرين", "تقدرين تسوين", "وش تسوين", "ايش تسوين", "كيف استخدم*", "help", "قدراتك", "ماذا تستطيع*", "ماذا تفعل*", "وش أسأل", "ايش أسأل", "الأوامر", "كيف أبدأ", "وش اكتب"]),
  overview: phrases(["الأرقام", "أرقام", "ارقام الفريق", "احصائيات*", "إحصائيات*", "إحصاءات", "احصاء*", "ملخص", "ملخص الفريق", "وضع الفريق", "حال الفريق", "حالة الفريق", "نظرة عامة", "لوحة", "المؤشرات", "مؤشرات", "dashboard", "وش الوضع", "ايش الوضع", "كيف الوضع", "كيف الفريق", "وين وصلنا", "وين وصل الفريق", "الوضع العام", "الصورة العامة", "الإجمالي", "اجمالي الفريق", "ارقام", "الارقام كلها"]),
  report: phrases(["تقرير*", "التقرير"]),
  reportVerb: phrases(["جهزي", "جهز*", "اكتبي", "سوي*", "اعدي", "أعدي", "ابي", "أبي", "ابغى", "ودي", "أعطيني", "عطيني", "شامل", "موحد", "أسبوعي", "اسبوعي", "يومي", "ختامي", "شهري", "للإدارة", "للمدير*", "مجمع"]),
  reminder: phrases(["تذكير", "تذكيرات", "ذكري*", "ذكريها", "ذكريهم", "نبهي*", "تنبيه", "رسالة متابعة", "حثي*"]),
  login: phrases(["رسالة دخول", "رسائل دخول", "رسايل دخول", "رسائل الدخول", "رسالة الدخول", "رسايل الدخول", "بيانات الدخول", "بيانات دخول", "طريقة الدخول", "طريقة دخول", "رابط الدخول", "رابط المنصة", "كيف تدخل*", "كيف يدخل*", "معلومات الدخول", "تعليمات الدخول", "رسالة تفعيل", "رسائل التفعيل"]),
  message: phrases(["رسالة", "رسائل", "رسايل", "رساله*", "واتساب", "واتس", "جهزي", "اكتبي"]),
  compare: phrases(["قارني", "قارن*", "مقارنة", "مقارنه*", "الفرق بين", "وازني", "موازنة"]),
  search: phrases(["ابحثي", "ابحث*", "بحث", "دوري", "دوري لي", "فتشي", "فتش*", "وين ذكر", "وين مكتوب", "يذكر", "مذكور", "تحتوي", "يحتوي", "فيها كلمة", "فيه كلمة", "عن كلمة", "search", "find"]),
  documentWords: phrases(["ملف", "الملف", "ملفات", "الملفات", "مرفق*", "مستند*", "وثيقة", "وثائق", "التقارير", "تقارير", "شواهد", "المرفوعة", "مرفوعة", "المرفوعات"]),
  edit: phrases(["غيري", "غير", "غيّري", "عدلي", "عدل", "عدّلي", "حدثي", "حدّثي", "حدث", "سجلي", "سجّلي", "حطي", "حطيها", "ضعي", "خلي", "اكتبي", "بدلي", "بدّلي", "صححي", "صحّحي", "ثبتي", "عبي", "عبّي", "املئي", "املي", "update", "set", "change"]),
  clear: phrases(["امسحي", "احذفي", "فرغي", "فرّغي", "شيلي", "الغي", "ألغي"]),
  add: phrases(["أضيفي", "اضيفي", "ضيفي", "ضيّفي", "أضف", "اضف", "سجلي", "أنشئي", "انشئي", "افتحي", "add"]),
  newMemberNoun: phrases(["عضوة", "عضوه", "عضو", "مشرفة", "مشرفه", "حساب", "زميلة", "موظفة"]),
  customFieldNoun: phrases(["حقل", "خانة", "بند"]),
  list: phrases(["قائمة", "قايمة", "أسماء", "اسماء", "كل المشرفات", "جميع المشرفات", "المشرفات", "العضوات", "الفريق كامل", "الفريق كله", "اعرضي", "اعرض", "وريني", "ورني", "عرض", "مين هن", "من هن", "مين المشرفات", "list"]),
  count: phrases(["كم", "عدد", "مجموع", "اجمالي", "إجمالي", "كمية", "متوسط", "معدل", "المجموع", "count"]),
  average: phrases(["متوسط", "معدل", "average"]),
  rankHigh: phrases(["الأعلى", "أعلى", "الأكثر", "أكثر", "أفضل", "الأفضل", "أكبر", "الأكبر", "المتصدرات", "تتصدر", "أعلاهن", "الأولى", "top"]),
  rankLow: phrases(["الأقل", "أقل", "أضعف", "الأضعف", "أصغر", "الأصغر", "الأخيرة", "متأخرة", "متأخرات", "المتأخرات", "تصاعدي"]),
  rankVerb: phrases(["رتبي", "رتب", "رتّبي", "رتبيهن", "رتبيهم", "ترتيب", "sort", "حسب"]), // not "رتب*": that would catch "رتبتها" (her rank)
  negation: phrases(["لم", "ما", "مو", "مب", "غير", "بدون", "ليس", "ليست", "مافيه", "ماعندها", "ما عندها", "ماعندهم", "لسه ما", "للحين ما", "بلا", "مافعلت", "مادخلت", "ماسجلت", "ماعبت", "ماكملت", "ماارسلت", "ماأرسلت", "مارفعت"]),
  enter: phrases(["دخلت", "دخلن", "دخلوا", "دخلو", "تدخل", "يدخلن", "دخول", "فعلت", "فعّلت", "فعلن", "فعلوا", "تفعل", "مفعل*", "تفعيل*", "سجلت دخول", "سجلن دخول", "نشط*"]),
  complete: phrases(["أكملت", "اكملت", "كملت", "أكملن", "اكملن", "كملن", "مكتمل*", "كامل", "كاملة", "خلصت", "خلصن", "أنهت", "انهت"]),
  incomplete: phrases(["ناقص", "ناقصة", "ناقصه", "نواقص", "النواقص", "ما كملت", "لم تكمل", "ماكملت", "غير مكتمل*", "ما اكملت", "لم تكتمل"]),
  submit: phrases(["أرسلت", "ارسلت", "أرسلن", "ارسلن", "رفعت", "رفعن", "سلمت", "سلمن", "ترسل", "ارسال", "إرسال"]),
  today: phrases(["اليوم", "هذا اليوم", "today"]),
  updated: phrases(["حدثت", "حدّثت", "حدثن", "عدلت", "عدّلت", "حدث*", "تحديث*"]),
  fill: phrases(["تعبي", "عبت", "عبّت", "تعبئ", "عبأت", "تكتب", "كتبت", "تسجل", "سجلت", "أدخلت", "ادخلت", "تضيف", "اضافت", "أضافت", "ضافت", "ترفع", "رفعت", "حطت", "تحط"]),
  summarize: phrases(["لخصي", "لخص*", "ملخص", "وش فيه", "ايش فيه", "وش في", "ايش في", "اقري", "اقرئي", "اقرأي", "محتوى", "مضمون", "وش مكتوب", "ايش مكتوب"]),
  whoAmI: phrases(["مين انت", "من انت", "من أنت", "عرفي بنفسك", "وش اسمك"]),
  who: phrases(["مين", "من", "منهن", "اللي", "التي", "الي"]),
  undo: phrases(["تراجعي", "تراجع*", "رجعي", "رجّعي", "ارجعي", "الغي التعديل", "الغي التغيير", "undo"]),
  deleteMember: phrases(["احذفي العضوة", "احذفي المشرفة", "احذفي حساب", "امسحي حساب", "احذفي عضوة"]),
};

export const TITLE_FILTERS: { phrase: Phrase; match: string; label: string }[] = [
  { phrase: phrase("نواتج تعلم"), match: "نواتج", label: "عضوات نواتج التعلم" },
  { phrase: phrase("نواتج"), match: "نواتج", label: "عضوات نواتج التعلم" },
  { phrase: phrase("نشاط"), match: "نشاط", label: "أخصائيات النشاط الطلابي" },
  { phrase: phrase("توجيه"), match: "توجيه", label: "أخصائيات التوجيه الطلابي" },
  { phrase: phrase("أخصائي*"), match: "اخصاي", label: "الأخصائيات" },
  { phrase: phrase("اخصائي*"), match: "اخصاي", label: "الأخصائيات" },
  { phrase: phrase("تنفيذي"), match: "تنفيذي", label: "عضوات الفريق التنفيذي" },
  { phrase: phrase("التنفيذي"), match: "تنفيذي", label: "عضوات الفريق التنفيذي" },
];
