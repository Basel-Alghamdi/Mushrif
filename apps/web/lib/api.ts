"use client";

import { supabase } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, string>,
    readonly details?: { current?: Record<string, unknown> },
  ) {
    super(message);
  }
}

type Options = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; source?: "web" | "mobile"; auth?: boolean };

export async function api<T = unknown>(path: string, { method = "GET", body, source = "web", auth = true }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "x-rasd-source": source };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("تعذّر الاتصال بالخادم — تحققي من الشبكة", 0, "NETWORK");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? "تعذّر الحفظ — أعيدي المحاولة", response.status, error.code ?? "UNKNOWN", error.fields, error.details);
  }
  return payload?.data as T;
}

/** Sends the user to the login page when the session is gone. Returns true if it redirected. */
export function redirectIfSignedOut(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.code === "NO_PROFILE")) {
    window.location.replace("/login");
    return true;
  }
  return false;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "تعذّر الحفظ — أعيدي المحاولة");
