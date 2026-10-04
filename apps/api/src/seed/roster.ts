import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { cleanText, normalizeEmail } from "../db.js";

// The team roster (names, titles, personal emails) is personal data, so it never lives in git.
// It is read from RASD_ROSTER_FILE, or apps/api/data/roster.xlsx (or roster.json) — the data folder is git-ignored.
// The sign-up form export works as-is: a sheet with columns like «الاسم رباعي», «الصفة», «البريد الالكتروني».
export type RosterEntry = { name: string; title: string; email: string };

const dataDir = new URL("../../data/", import.meta.url);
const DEFAULT_FILES = ["roster.xlsx", "roster.csv", "roster.json"].map(name => fileURLToPath(new URL(name, dataDir)));

export function rosterFile() {
  const configured = process.env.RASD_ROSTER_FILE?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return DEFAULT_FILES.find(file => existsSync(file)) ?? null;
}

function fromRows(rows: string[][]): RosterEntry[] {
  const headerIndex = rows.slice(0, 10).findIndex(row => row.some(cell => /اسم/.test(cell)) && row.some(cell => /بريد|ايميل|إيميل|email/i.test(cell)));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex];
  const column = (pattern: RegExp) => header.findIndex(cell => pattern.test(cell));
  const name = column(/اسم/);
  const email = column(/بريد|ايميل|إيميل|email/i);
  const title = column(/صفة|الصفه|المسمى|الوظيفة/);
  return rows.slice(headerIndex + 1)
    .map(row => ({ name: cleanText(row[name]), email: normalizeEmail(row[email]), title: title >= 0 ? cleanText(row[title]) : "" }))
    .filter(entry => entry.name && entry.email.includes("@"));
}

/** The roster to seed, or [] when no roster file is present. */
export function loadRoster(): RosterEntry[] {
  const file = rosterFile();
  if (!file) return [];
  if (extname(file).toLowerCase() === ".json") {
    const entries = JSON.parse(readFileSync(file, "utf8")) as Partial<RosterEntry>[];
    return entries.map(entry => ({ name: cleanText(entry.name), title: cleanText(entry.title), email: normalizeEmail(entry.email) })).filter(entry => entry.name && entry.email);
  }
  const workbook = XLSX.read(readFileSync(file), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return fromRows(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false }).map(row => row.map(cell => cleanText(cell))));
}
