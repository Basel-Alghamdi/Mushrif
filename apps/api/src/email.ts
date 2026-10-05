import { env } from "./env.js";

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export const emailConfigured = () => Boolean(env.resendApiKey && env.resendFrom);

type Email = { to: string; subject: string; html: string; replyTo?: string | null };

const RESEND = "https://api.resend.com";
const BATCH_SIZE = 100;
const resendBody = (email: Email) =>
  ({ from: env.resendFrom, to: [email.to], subject: email.subject, html: email.html, ...(email.replyTo ? { reply_to: email.replyTo } : {}) });

async function post(path: string, body: unknown) {
  const response = await fetch(`${RESEND}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`RESEND_${response.status}: ${await response.text().catch(() => "")}`);
}

/** Sends through Resend. Returns "not_configured" when no key is set, throws when Resend rejects the message. */
export async function sendEmail(input: Email) {
  if (!emailConfigured()) return "not_configured" as const;
  await post("/emails", resendBody(input));
  return "sent" as const;
}

/** Many emails in one Resend call per 100 (Resend allows only a few requests a second). Throws when a batch is rejected. */
export async function sendEmails(emails: Email[]) {
  if (!emailConfigured()) return "not_configured" as const;
  for (let start = 0; start < emails.length; start += BATCH_SIZE) await post("/emails/batch", emails.slice(start, start + BATCH_SIZE).map(resendBody));
  return "sent" as const;
}

/** Every email: right-to-left, with the رَصد logo (a PNG served by the web app — email clients do not show SVG). */
export const rtlEmail = (body: string) =>
  `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#001d1a">` +
  `<img src="${escapeHtml(env.appUrl.replace(/\/$/, ""))}/logo-email.png" width="44" height="44" alt="رَصد" style="display:block;margin:0 0 16px;border:0">` +
  `${body}</div>`;

/** A message written as plain text (the same text the head sees) as an email: line breaks and links kept, plus a button. */
export function messageEmail(text: string, button?: { url: string; label: string }) {
  const body = escapeHtml(text)
    .replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" style="color:#007970">${url}</a>`)
    .replace(/\n/g, "<br>");
  const action = button
    ? `<p style="margin:22px 0 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:10px 22px;border-radius:10px;background:#007970;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(button.label)}</a></p>`
    : "";
  return rtlEmail(`<p style="margin:0">${body}</p>${action}`);
}
