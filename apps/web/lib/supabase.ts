"use client";

import { createClient } from "@supabase/supabase-js";

// Placeholders such as "PASTE_…" or a non-URL count as "not configured" instead of crashing the build.
const url = /^https?:\/\//.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") ? process.env.NEXT_PUBLIC_SUPABASE_URL! : "";
// Supabase publishable key (sb_publishable_…): safe to ship to the browser.
const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").startsWith("PASTE_") ? "" : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabaseConfigured = Boolean(url && publishableKey);

// The browser only uses Supabase for sign-in and session refresh; all data goes through the Rasd API.
export const supabase = createClient(url || "http://localhost:54321", publishableKey || "missing-key", {
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
