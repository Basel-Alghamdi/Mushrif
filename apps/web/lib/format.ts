const number = new Intl.NumberFormat("ar-SA");
const dateTime = new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "long" });
const time = new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit" });

/** Arabic-Indic digits: 1234 → ١٬٢٣٤ */
export const ar = (value: number | string) => typeof value === "number" ? number.format(value) : String(value).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
export const pct = (value: number) => `${ar(Math.round(value))}٪`;

const valid = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
export const formatDateTime = (value?: string | null) => { const date = valid(value); return date ? dateTime.format(date) : "—"; };

/** Arabic counted noun: (1) دقيقة · (2) دقيقتين · (3–10) ٣ دقائق · (11+) ١٢ دقيقة. */
export function counted(n: number, forms: { one: string; two: string; few: string; many: string }) {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return `${ar(n)} ${n <= 10 ? forms.few : forms.many}`;
}

const MINUTES = { one: "دقيقة", two: "دقيقتين", few: "دقائق", many: "دقيقة" };
const HOURS = { one: "ساعة", two: "ساعتين", few: "ساعات", many: "ساعة" };

/** "الآن" / "قبل دقيقتين" / "قبل ٣ ساعات" / "أمس" / "١٢ سبتمبر" */
export function relativeTime(value?: string | null) {
  const date = valid(value);
  if (!date) return "—";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `قبل ${counted(Math.floor(diff / 60), MINUTES)}`;
  if (diff < 6 * 3600) return `قبل ${counted(Math.floor(diff / 3600), HOURS)}`;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  if (date >= startOfToday) return `اليوم ${time.format(date)}`;
  if (date >= new Date(startOfToday.getTime() - 86_400_000)) return "أمس";
  return dateOnly.format(date);
}

export const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${ar(Math.max(1, Math.round(bytes / 1024)))} ك.ب` : `${ar(Math.round(bytes / 1024 / 102.4) / 10)} م.ب`;

/** Greeting by time of day. */
export function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "صباح الخير" : "مساء الخير";
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
