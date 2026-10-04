import { env } from "./env.js";

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export const emailConfigured = () => Boolean(env.resendApiKey && env.resendFrom);

/** Sends through Resend. Returns "not_configured" when no key is set, throws when Resend rejects the message. */
export async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!env.resendApiKey || !env.resendFrom) return "not_configured" as const;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.resendFrom, to: [input.to], subject: input.subject, html: input.html }),
  });
  if (!response.ok) throw new Error(`RESEND_${response.status}: ${await response.text().catch(() => "")}`);
  return "sent" as const;
}

export const rtlEmail = (body: string) =>
  `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#001d1a">${body}</div>`;
