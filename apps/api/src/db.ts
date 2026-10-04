import "./env.js";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.RASD_DATABASE_FILE
  ? resolve(process.env.RASD_DATABASE_FILE)
  : fileURLToPath(new URL("../data/rasd.sqlite", import.meta.url));
mkdirSync(dirname(databasePath), { recursive: true });

export const uploadsDir = join(dirname(databasePath), "uploads");
mkdirSync(uploadsDir, { recursive: true });

export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    head_id TEXT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('head','member')),
    cluster_label TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(head_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    user_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL DEFAULT '[]',
    schools_json TEXT NOT NULL DEFAULT '[]',
    programs_json TEXT NOT NULL DEFAULT '[]',
    sections_json TEXT NOT NULL DEFAULT '[]',
    submitted_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    school_id TEXT NOT NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    uploaded_by TEXT NOT NULL,
    conversation_id TEXT,
    name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '',
    tables_json TEXT NOT NULL DEFAULT '[]',
    pages INTEGER,
    status TEXT NOT NULL DEFAULT 'ready',
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner_id);
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    text TEXT NOT NULL DEFAULT '',
    blocks_json TEXT NOT NULL DEFAULT '[]',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at);
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("users", "title", "TEXT NOT NULL DEFAULT ''");
addColumn("users", "activated_at", "TEXT");
addColumn("users", "last_login_at", "TEXT");
addColumn("users", "last_activity_at", "TEXT");
addColumn("workspaces", "version", "INTEGER NOT NULL DEFAULT 1");
addColumn("visits", "details_json", "TEXT NOT NULL DEFAULT '{}'");

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

const riyadhDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
/** Calendar date (YYYY-MM-DD) in Riyadh for an ISO timestamp, or today when omitted. */
export const riyadhDay = (iso?: string | null) => riyadhDate.format(iso ? new Date(iso) : new Date());
export const today = () => riyadhDay();

export function getMeta(key: string) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key);
  return row ? String(row.value) : null;
}
export function setMeta(key: string, value: string) {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; }
}

/** Runs fn inside a write transaction. */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Trims, removes bidi/zero-width marks, and collapses whitespace in display names. */
export function cleanText(value: unknown) {
  return String(value ?? "").replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").replace(/\s+/g, " ").trim();
}
export const normalizeEmail = (value: unknown) => cleanText(value).toLowerCase();
