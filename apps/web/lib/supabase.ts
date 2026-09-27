"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = Boolean(url && key);

// The browser only uses Supabase for sign-in and session refresh; all data goes through the Rasd API.
export const supabase = createClient(url || "http://localhost:54321", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const SESSION_ONLY = "rasd:session-only";
const TAB_ALIVE = "rasd:alive";

/** "تذكّرني" unchecked: the session must not survive closing the browser. */
export function rememberDevice(remember: boolean) {
  try {
    if (remember) localStorage.removeItem(SESSION_ONLY);
    else localStorage.setItem(SESSION_ONLY, "1");
    sessionStorage.setItem(TAB_ALIVE, "1");
  } catch { /* storage unavailable: fall back to Supabase's default persistence */ }
}

/** Signs out a session-only login that was carried over into a new browser session. */
export async function enforceSessionOnly() {
  try {
    if (localStorage.getItem(SESSION_ONLY) && !sessionStorage.getItem(TAB_ALIVE)) await supabase.auth.signOut();
    else sessionStorage.setItem(TAB_ALIVE, "1");
  } catch { /* ignore */ }
}

export async function signOut() {
  await supabase.auth.signOut().catch(() => {});
  try { localStorage.removeItem(SESSION_ONLY); } catch { /* ignore */ }
  window.location.replace("/login");
}
