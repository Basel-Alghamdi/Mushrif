"use client";

import { signOut, supabase } from "./supabase";

// Empty = same origin: next.config.ts forwards /api/v1 to the API (works from phones on the network, no CORS).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Options = { method?: Method; body?: unknown; source?: "web" | "mobile"; auth?: boolean };

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

async function send<T>(path: string, init: RequestInit, auth: boolean): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(auth ? await authHeader() : {}) } });
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

async function request<T = unknown>(path: string, { method = "GET", body, source = "web", auth = true }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "x-rasd-source": source };
  if (body !== undefined) headers["content-type"] = "application/json";
  return send<T>(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, auth);
}

/** `api(path, options)` as in main, plus shorthands: api.get / post / put / patch / del / upload. */
export const api = Object.assign(request, {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart upload; files are sent under the "files" field. */
  upload: <T>(path: string, files: File[] | FileList) => {
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file, file.name);
    return send<T>(path, { method: "POST", headers: { "x-rasd-source": "web" }, body: form }, true);
  },
});

/** Sends the user to the login page when the session is gone. Returns true if it redirected. */
export function redirectIfSignedOut(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.code === "NO_PROFILE")) {
    window.location.replace("/login");
    return true;
  }
  return false;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "تعذّر الحفظ — أعيدي المحاولة");

// Only these may be previewed in a tab; anything else (html, svg…) is downloaded so it can never run in our origin.
const PREVIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/(plain|csv)|audio\/)/;

/** Downloads (or opens, for safe types) an authenticated file, e.g. /documents/:id/download. */
export async function downloadFile(path: string, filename: string, open = false) {
  const response = await fetch(`${API_URL}/api/v1${path}`, { headers: await authHeader() });
  if (!response.ok) throw new ApiError("تعذّر تنزيل الملف", response.status, "DOWNLOAD");
  const blob = await response.blob();
  const previewable = PREVIEWABLE.test(blob.type);
  const url = URL.createObjectURL(previewable ? blob : new Blob([blob], { type: "application/octet-stream" }));
  if (open && previewable) window.open(url, "_blank", "noopener");
  else {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const logout = signOut;
