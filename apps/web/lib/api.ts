"use client";

import { signOut, supabase } from "./supabase";
import type { Me } from "./types";

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

const sessionEnded = (status: number, code?: string) => status === 401 || code === "NO_PROFILE";

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
    if (auth && sessionEnded(response.status, error.code)) forgetMe();
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
  /** Multipart upload; files are sent under the "files" field, with optional text fields (e.g. the folder). */
  upload: <T>(path: string, files: File[] | FileList, fields: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
    for (const file of Array.from(files)) form.append("files", file, file.name);
    return send<T>(path, { method: "POST", headers: { "x-rasd-source": "web" }, body: form }, true);
  },
});

const LAST_ROLE = "rasd:lastRole"; // this device: the login page sends her home without waiting for the server
const LAST_ME = "rasd:me"; // this tab: the head's pages open at once and /auth/me confirms in the background

let me: Promise<Me> | null = null;

/** GET /auth/me, asked once and shared (the login page hands its request to HeadGuard); `fresh` asks again. */
export function getMe(fresh = false): Promise<Me> {
  if (fresh || !me) {
    const request = api.get<Me>("/auth/me");
    me = request;
    // A failure is never kept: the next caller asks again.
    request.then(rememberMe, () => { if (me === request) me = null; });
  }
  return me;
}

/** Keeps who signed in (her role on this device, her account in this tab) for the next page to open at once. */
export function rememberMe(value: Me) {
  try {
    localStorage.setItem(LAST_ROLE, value.user.role);
    sessionStorage.setItem(LAST_ME, JSON.stringify(value));
  } catch { /* private mode: every page asks the server */ }
}

export function lastRole(): Me["user"]["role"] | null {
  try {
    const role = localStorage.getItem(LAST_ROLE);
    return role === "head" || role === "member" ? role : null;
  } catch {
    return null;
  }
}

export function lastMe(): Me | null {
  try { return JSON.parse(sessionStorage.getItem(LAST_ME) ?? "null") as Me | null; } catch { return null; }
}

// Forgotten whenever the session ends, so the login page never sends a refused account back home (a redirect loop).
function forgetMe() {
  me = null;
  try {
    localStorage.removeItem(LAST_ROLE);
    sessionStorage.removeItem(LAST_ME);
  } catch { /* ignore */ }
}

/** Sends the user to the login page when the session is gone. Returns true if it redirected. */
export function redirectIfSignedOut(error: unknown) {
  if (error instanceof ApiError && sessionEnded(error.status, error.code)) {
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

export async function logout() {
  forgetMe();
  await signOut();
}
