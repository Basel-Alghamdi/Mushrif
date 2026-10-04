// Arabic text normalization and tokenization shared by every part of the agent.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;
const BIDI = /[​-‏‪-‮⁦-⁩﻿]/g;
const PUNCTUATION_TOKENS = /([:=؟?!،,؛;()«»"“”[\]{}])/g;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to western digits. */
export function westernDigits(text: string) {
  return text
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0));
}

/** Canonical form for comparing Arabic text: no tashkeel/tatweel, unified letters, western digits, lowercase Latin. */
export function normalizeArabic(text: unknown) {
  return westernDigits(String(text ?? ""))
    .replace(BIDI, "")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/ک/g, "ك")
    .toLowerCase();
}

/** Normalized text with punctuation turned into spaces (keeps characters that appear in emails and dates). */
export function normalizeText(text: unknown) {
  return normalizeArabic(text)
    .replace(/[^\p{L}\p{N}@._+\-/\s]/gu, " ")
    .split(/\s+/)
    .map(trimEdges)
    .filter(Boolean)
    .join(" ");
}

const trimEdges = (word: string) => word.replace(/^[._+\-/]+|[._+\-/]+$/g, "");

export type Token = { raw: string; norm: string; variants: string[]; index: number; punct: boolean };

const PREFIX_ARTICLES = ["وبال", "ولل", "وال", "فال", "بال", "كال", "لل", "ال"];
const PREFIX_LETTERS = ["و", "ف", "ب", "ل", "ك"];

/** Forms a word may take once its attached conjunction/preposition and "ال" are removed (الزهراني → زهراني, ورشا → رشا). */
export function variantsOf(word: string) {
  const out = new Set<string>([word]);
  if (!/[؀-ۿ]/.test(word)) return [...out];
  for (const prefix of PREFIX_ARTICLES) {
    if (word.startsWith(prefix) && word.length - prefix.length >= 2) out.add(word.slice(prefix.length));
  }
  for (const letter of PREFIX_LETTERS) {
    if (!word.startsWith(letter) || word.length <= 3) continue;
    const rest = word.slice(1);
    out.add(rest);
    if (rest.startsWith("ال") && rest.length > 4) out.add(rest.slice(2));
  }
  return [...out];
}

export function normalizeToken(raw: string) {
  const norm = normalizeArabic(raw);
  if (/^[:=؟?!،,؛;()«»"“”[\]{}]$/.test(norm)) return norm.replace("؟", "?").replace("،", ",").replace("؛", ";");
  return trimEdges(norm.replace(/[^\p{L}\p{N}@._+\-/]/gu, ""));
}

/** Splits text into tokens (punctuation such as ":" or "؟" become their own tokens). Index i maps back to the raw word. */
export function tokenize(text: string): Token[] {
  const pieces = String(text ?? "").replace(BIDI, "").replace(PUNCTUATION_TOKENS, " $1 ").split(/\s+/).filter(Boolean);
  const tokens: Token[] = [];
  for (const raw of pieces) {
    const norm = normalizeToken(raw);
    if (!norm) continue;
    const punct = /^[:=?!,;()«»"“”[\]{}]$/.test(norm);
    tokens.push({ raw, norm, variants: punct ? [norm] : variantsOf(norm), index: tokens.length, punct });
  }
  return tokens;
}

/** Name token without the definite article (الزهراني → زهراني). */
export const coreWord = (word: string) => (word.startsWith("ال") && word.length > 4 ? word.slice(2) : word);

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/** Lowercase, western digits, trimmed — for comparing cell values with stored values. */
export const comparable = (value: unknown) => normalizeText(value).replace(/\s+/g, " ");

export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
