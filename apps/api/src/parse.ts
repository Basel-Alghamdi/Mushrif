import type { Context } from "hono";
import { messages, toWesternDigits, validators } from "@rasd/schemas";
import { ApiError, invalid } from "./errors.js";
import type { Row } from "./db.js";

/** A value parser: returns the normalized value or calls `reject` with an Arabic message. */
export type Parser = (value: unknown, row?: Row) => unknown;

class Rejection extends Error {}
export const reject = (message: string): never => { throw new Rejection(message); };

export async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "BAD_REQUEST", "صيغة الطلب غير صحيحة");
  return body as Record<string, unknown>;
}

/** Applies parsers to the keys present in `body`; collects every field error before failing (one 422 for all). */
export function parseFields(body: Record<string, unknown>, parsers: Record<string, Parser>, row?: Row) {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, parse] of Object.entries(parsers)) {
    if (!(key in body)) continue;
    try { values[key] = parse(body[key], row); } catch (error) {
      if (error instanceof Rejection) errors[key] = error.message; else throw error;
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return values;
}

const asString = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : reject("القيمة غير صحيحة"));
const asInteger = (value: unknown, message: string) => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(toWesternDigits(value.trim())) : NaN;
  return Number.isInteger(number) ? number : reject(message);
};
const check = (message: string | null) => (message ? reject(message) : undefined);

export const p = {
  text: (max = 500): Parser => value => { const text = asString(value); return text.length <= max ? text : reject(`النص أطول من ${max} حرفاً`); },
  label: (message: string = messages.label): Parser => value => { const text = asString(value).trim(); check(validators.label(text) ? message : null); return text; },
  count: (): Parser => value => { const number = asInteger(value, messages.count); check(validators.count(number)); return number; },
  percent: (): Parser => value => { const number = asInteger(value, messages.percent); check(validators.percent(number)); return number; },
  bool: (): Parser => value => (typeof value === "boolean" ? value : reject("القيمة غير صحيحة")),
  oneOf: (options: readonly string[]): Parser => value => { const text = asString(value); return options.includes(text) ? text : reject("اختاري قيمة من القائمة"); },
  /** Normalizes digits, then applies one of the shared validators (empty allowed). */
  rule: (validator: (value: string) => string | null): Parser => value => { const text = toWesternDigits(asString(value).trim()); check(validator(text)); return text; },
  nullable: (parser: Parser): Parser => (value, row) => (value === null ? null : parser(value, row)),
};

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** YYYY-MM-DD, not in the future (Riyadh). */
export function parseDate(value: unknown, today: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw invalid({ date: "التاريخ غير صحيح" });
  if (value > today) throw invalid({ date: "لا يمكن التثبيت لتاريخ قادم" });
  return value;
}

/** Optimistic-concurrency check (EDITABILITY §1.5): reject if the row changed after the client loaded it. */
export function assertFresh(body: Record<string, unknown>, row: Row) {
  const expected = body.expectedUpdatedAt;
  if (typeof expected !== "string" || !row.updatedAt) return;
  const loaded = Date.parse(expected);
  if (!Number.isNaN(loaded) && (row.updatedAt as Date).getTime() > loaded) {
    throw new ApiError(409, "CONFLICT", "تم تعديل هذا الحقل من جهاز آخر", undefined, { current: row });
  }
}
