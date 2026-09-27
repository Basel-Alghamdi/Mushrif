const arabicDigits = new Intl.NumberFormat("ar-SA");

export const ar = (value: number) => arabicDigits.format(value);
export const arPct = (value: number) => `${ar(value)}٪`;

export const hijri = (date: Date | string = new Date()) =>
  new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date));

export const copy = {
  brand: "رَصد",
  tagline: "منصة متابعة الفريق التنفيذي",
  district: "إدارة التعليم · النطاق الإشرافي",
  cluster: "عنقود ٤",
  welcome: "مرحباً بعودتك",
  overview: "صورة مباشرة لأداء مدارس العنقود اليوم",
} as const;
