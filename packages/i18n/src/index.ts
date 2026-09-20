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
  tagline: "منصة الإشراف المدرسي الذكية",
  district: "إدارة تعليم الرياض",
  cluster: "مجموعة الإشراف الرابعة",
  welcome: "مرحباً بعودتك",
  overview: "نظرة عامة على أداء مدارس المجموعة اليوم",
} as const;
