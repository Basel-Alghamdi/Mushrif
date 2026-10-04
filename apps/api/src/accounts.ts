import type { MemberCreateInput, MemberUpdateInput, PublicUser, Role } from "@rasd/schemas";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cleanText, db, getMeta, newId, normalizeEmail, now, setMeta, transaction } from "./db.js";
import { env } from "./env.js";
import { loadRoster, rosterFile } from "./seed/roster.js";
import { defaultProfile, getWorkspace, saveWorkspace } from "./workspaces.js";

export type Account = PublicUser & { headId: string | null; activated: boolean; lastLoginAt: string | null; lastActivityAt: string | null; createdAt: string; updatedAt: string };

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function mapAccount(row?: Record<string, unknown>): Account | null {
  if (!row) return null;
  return {
    id: String(row.id), headId: row.head_id ? String(row.head_id) : null,
    email: String(row.email), name: String(row.name), phone: String(row.phone ?? ""),
    role: String(row.role) as Role, title: String(row.title ?? ""), clusterLabel: String(row.cluster_label ?? ""),
    activated: Boolean(String(row.password_hash ?? "")), lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export const publicUser = (user: Account): PublicUser => ({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, title: user.title, clusterLabel: user.clusterLabel });

export function findAccountByEmail(email: string) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
  return row ? { account: mapAccount(row)!, passwordHash: String(row.password_hash ?? "") } : null;
}

export const findAccountById = (id: string) => mapAccount(db.prepare("SELECT * FROM users WHERE id = ?").get(id));

export function membersOfHead(headId: string) {
  return db.prepare("SELECT * FROM users WHERE head_id = ? AND role = 'member' ORDER BY created_at ASC, rowid ASC").all(headId).map(row => mapAccount(row)!);
}

export function headAccount() {
  return mapAccount(db.prepare("SELECT * FROM users WHERE role = 'head' ORDER BY created_at ASC LIMIT 1").get());
}

// ---------- Sessions ----------
export function createSession(userId: string, remember = true) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(tokenHash(token), userId, expiresAt, createdAt);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(createdAt, userId);
  return { token, expiresAt };
}

export function accountForToken(token: string) {
  const at = now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(at);
  return mapAccount(db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), at));
}

/** Records that a member did something herself (edited her file, logged a visit, uploaded a file). */
export const touchActivity = (userId: string) => { db.prepare("UPDATE users SET last_activity_at = ? WHERE id = ?").run(now(), userId); };

export const revokeSession = (token: string) => { db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token)); };

// ---------- Passwords ----------
/** First login: an account without a password chooses one. */
export function activateAccount(email: string, password: string) {
  const found = findAccountByEmail(email);
  if (!found) throw new Error("ACCOUNT_NOT_FOUND");
  if (found.passwordHash) throw new Error("ALREADY_ACTIVATED");
  const at = now();
  db.prepare("UPDATE users SET password_hash = ?, activated_at = ?, updated_at = ? WHERE id = ?").run(passwordHash(password), at, at, found.account.id);
  return findAccountById(found.account.id)!;
}

export function setPassword(userId: string, password: string) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash(password), now(), userId);
}

/** Clears the password so the member chooses a new one on her next login, and signs her out everywhere. */
export function resetPassword(userId: string) {
  transaction(() => {
    db.prepare("UPDATE users SET password_hash = '', activated_at = NULL, updated_at = ? WHERE id = ?").run(now(), userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  });
}

// ---------- Members ----------
export function createMember(headId: string, input: MemberCreateInput) {
  const email = normalizeEmail(input.email);
  const name = cleanText(input.name);
  if (!name) throw new Error("NAME_REQUIRED");
  if (!email) throw new Error("EMAIL_REQUIRED");
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) throw new Error("ACCOUNT_EXISTS");
  const id = newId();
  const at = now();
  const account = { name, email, phone: cleanText(input.phone), title: cleanText(input.title), clusterLabel: cleanText(input.clusterLabel) };
  transaction(() => {
    db.prepare(`INSERT INTO users (id,head_id,email,name,phone,role,cluster_label,password_hash,title,created_at,updated_at)
      VALUES (?,?,?,?,?,'member',?,'',?,?,?)`).run(id, headId, email, name, account.phone, account.clusterLabel, account.title, at, at);
    db.prepare(`INSERT INTO workspaces (user_id,profile_json,schools_json,programs_json,sections_json,submitted_at,updated_at,version)
      VALUES (?,?,'[]','[]','[]',NULL,?,1)`).run(id, JSON.stringify(defaultProfile(account)), at);
  });
  return findAccountById(id)!;
}

/** Updates account fields and mirrors them into the member's built-in profile fields. */
export function updateMember(id: string, input: MemberUpdateInput) {
  const account = findAccountById(id);
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  const email = input.email !== undefined ? normalizeEmail(input.email) : account.email;
  if (!email) throw new Error("EMAIL_REQUIRED");
  if (email !== account.email && db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(email, id)) throw new Error("ACCOUNT_EXISTS");
  const next = {
    name: input.name !== undefined ? cleanText(input.name) || account.name : account.name,
    phone: input.phone !== undefined ? cleanText(input.phone) : account.phone,
    title: input.title !== undefined ? cleanText(input.title) : account.title,
    clusterLabel: input.clusterLabel !== undefined ? cleanText(input.clusterLabel) : account.clusterLabel,
  };
  db.prepare("UPDATE users SET email=?, name=?, phone=?, title=?, cluster_label=?, updated_at=? WHERE id=?")
    .run(email, next.name, next.phone, next.title, next.clusterLabel, now(), id);
  const updated = findAccountById(id)!;
  if (updated.role === "member") {
    const workspace = getWorkspace(updated);
    const mirror: Record<string, string | undefined> = {
      name: input.name !== undefined ? next.name : undefined,
      phone: input.phone !== undefined ? next.phone : undefined,
      title: input.title !== undefined ? next.title : undefined,
      cluster: input.clusterLabel !== undefined ? next.clusterLabel : undefined,
      email: input.email !== undefined ? email : undefined,
    };
    const profile = workspace.profile.map(field => mirror[field.id] !== undefined ? { ...field, value: mirror[field.id]!, updatedAt: now() } : field);
    saveWorkspace(updated, { profile });
  }
  return findAccountById(id)!;
}

export function updateOwnAccount(id: string, input: { name?: string; phone?: string }) {
  return updateMember(id, { name: input.name, phone: input.phone });
}

export function deleteMember(id: string) {
  return Number(db.prepare("DELETE FROM users WHERE id = ? AND role = 'member'").run(id).changes) > 0;
}

// ---------- Seed ----------
const LEGACY_PLACEHOLDER_EMAIL = "s.alqahtani@moe.gov.sa";

/** Ensures the district head (خلود) exists and seeds the roster file once (see seed/roster.ts). Safe to run on every start. */
export function seedAccounts() {
  const headEmail = normalizeEmail(env("RASD_ADMIN_EMAIL") ?? "khulood@rasd.local");
  const headName = cleanText(env("RASD_ADMIN_NAME") ?? "خلود");
  const headPassword = env("RASD_ADMIN_PASSWORD");
  const at = now();

  let head = findAccountByEmail(headEmail)?.account ?? null;
  if (!head) {
    const legacy = findAccountByEmail(LEGACY_PLACEHOLDER_EMAIL)?.account;
    if (legacy && legacy.role === "head") {
      // Replace the old placeholder head (سارة القحطاني) with خلود, keeping its id so every link survives.
      db.prepare("UPDATE users SET email=?, name=?, title='رئيسة النطاق', password_hash=?, activated_at=NULL, updated_at=? WHERE id=?")
        .run(headEmail, headName, headPassword ? passwordHash(headPassword) : "", at, legacy.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(legacy.id);
    } else {
      db.prepare(`INSERT INTO users (id,head_id,email,name,phone,role,cluster_label,password_hash,title,created_at,updated_at)
        VALUES (?,NULL,?,?,'','head','',?,'رئيسة النطاق',?,?)`).run(newId(), headEmail, headName, headPassword ? passwordHash(headPassword) : "", at, at);
    }
    head = findAccountByEmail(headEmail)!.account;
  }

  if (getMeta("roster_seeded_v1")) return;
  const roster = loadRoster();
  if (!roster.length) {
    // No roster file yet: seed later (or خلود uploads the team sheet in the chat and the assistant creates the accounts).
    console.log("Roster: no file found — add apps/api/data/roster.xlsx (or set RASD_ROSTER_FILE) to seed the team.");
    return;
  }
  transaction(() => {
    for (const entry of roster) {
      const email = normalizeEmail(entry.email);
      if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) continue;
      const id = newId();
      const account = { name: cleanText(entry.name), email, phone: "", title: cleanText(entry.title), clusterLabel: "" };
      db.prepare(`INSERT INTO users (id,head_id,email,name,phone,role,cluster_label,password_hash,title,created_at,updated_at)
        VALUES (?,?,?,?,'','member','','',?,?,?)`).run(id, head!.id, email, account.name, account.title, at, at);
      db.prepare(`INSERT INTO workspaces (user_id,profile_json,schools_json,programs_json,sections_json,submitted_at,updated_at,version)
        VALUES (?,?,'[]','[]','[]',NULL,?,1)`).run(id, JSON.stringify(defaultProfile(account)), at);
    }
    setMeta("roster_seeded_v1", at);
  });
  console.log(`Roster: seeded ${roster.length} members from ${rosterFile()}`);
}
