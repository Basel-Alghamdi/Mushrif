"use client";

import type { ApiError } from "@rasd/schemas";

const TOKEN_KEY = "rasd:token";
const BASE = "/api/v1"; // same-origin; next.config.ts proxies to the API server

export const getToken = () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY));
export const setToken = (token: string | null) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export class ApiRequestError extends Error {
  constructor(message: string, public status: number, public code: string, public payload: ApiError | null) { super(message); }
}

const AUTH_PATHS = ["/auth/check", "/auth/login", "/auth/activate"];

/** Sends the session to /login (used when the API answers 401). */
export function goToLogin() {
  setToken(null);
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) window.location.replace("/login");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body && !isForm ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiRequestError("تعذّر الاتصال بالخادم — تأكدي من الإنترنت وأعيدي المحاولة", 0, "NETWORK", null);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !AUTH_PATHS.includes(path)) goToLogin();
    const error = (payload as ApiError | null)?.error;
    throw new ApiRequestError(error?.message ?? "حدث خطأ — أعيدي المحاولة", response.status, error?.code ?? "ERROR", payload as ApiError | null);
  }
  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart upload; files are sent under the "files" field. */
  upload: <T>(path: string, files: File[] | FileList) => {
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file, file.name);
    return request<T>(path, { method: "POST", body: form });
  },
};

// Only these may be previewed in a tab; anything else (html, svg…) is downloaded so it can never run in our origin.
const PREVIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/(plain|csv)|audio\/)/;

/** Downloads (or opens, for safe types) an authenticated file, e.g. /documents/:id/download. */
export async function downloadFile(path: string, filename: string, open = false) {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new ApiRequestError("تعذّر تنزيل الملف", response.status, "DOWNLOAD", null);
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
  try { await api.post("/auth/logout"); } catch { /* already signed out */ }
  setToken(null);
  window.location.replace("/login");
}
