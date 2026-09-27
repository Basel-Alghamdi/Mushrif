import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Role = "head" | "member";
export type Account = {
  id: string;
  headId: string | null;
  email: string;
  name: string;
  phone: string;
  role: Role;
  clusterLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfileField = { id: string; label: string; value: string; derived?: boolean; updatedAt?: string };
export type Workspace = {
  userId: string;
  profile: ProfileField[];
  schools: Record<string, unknown>[];
  programs: Record<string, unknown>[];
  sections: Record<string, unknown>[];
  submittedAt: string | null;
  updatedAt: string;
};

export type Invitation = {
  id: string;
  headId: string;
  name: string;
  email: string;
  clusterLabel: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  deliveryStatus: "sending" | "sent" | "link_ready" | "failed";
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

const databasePath = process.env.RASD_DATABASE_FILE
  ? resolve(process.env.RASD_DATABASE_FILE)
  : fileURLToPath(new URL("../data/rasd.sqlite", import.meta.url));
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);

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
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    head_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    cluster_label TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    delivery_status TEXT NOT NULL DEFAULT 'sending',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    FOREIGN KEY(head_id) REFERENCES users(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_email
    ON invitations(head_id, email) WHERE status = 'pending';
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
`);

const now = () => new Date().toISOString();
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
    role: String(row.role) as Role, clusterLabel: String(row.cluster_label ?? ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapInvitation(row: Record<string, unknown>): Invitation {
  return {
    id: String(row.id), headId: String(row.head_id), name: String(row.name), email: String(row.email),
    clusterLabel: String(row.cluster_label ?? ""), status: String(row.status) as Invitation["status"],
    deliveryStatus: String(row.delivery_status) as Invitation["deliveryStatus"], expiresAt: String(row.expires_at),
    createdAt: String(row.created_at), acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
  };
}

function defaultProfile(name: string, email: string): ProfileField[] {
  const rows: Array<[string, string, boolean?]> = [
    ["الاسم الرباعي", name], ["السجل المدني", ""], ["الرقم الوظيفي", ""], ["البريد الوزاري", email],
    ["رقم الجوال", ""], ["الرتبة", "ممارس"], ["المؤهل", ""], ["التخصص", ""],
    ["التخصص الإشرافي", ""], ["تاريخ التعيين", ""], ["تاريخ التكليف بالإشراف", ""], ["عدد سنوات الخبرة", "", true],
  ];
  return rows.map(([label, value, derived], index) => ({ id: `field-${index}`, label, value, ...(derived ? { derived } : {}) }));
}

function ensureAdmin() {
  const email = (process.env.RASD_ADMIN_EMAIL ?? "s.alqahtani@moe.gov.sa").trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return;
  const createdAt = now();
  db.prepare(`INSERT INTO users (id,head_id,email,name,phone,role,cluster_label,password_hash,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "head-1", null, email, process.env.RASD_ADMIN_NAME ?? "سارة القحطاني", "", "head", "",
      passwordHash(process.env.RASD_ADMIN_PASSWORD ?? "Rasd@2026!"), createdAt, createdAt,
    );
}
ensureAdmin();

export function findAccountByEmail(email: string) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!row) return null;
  return { account: mapAccount(row)!, passwordHash: String(row.password_hash) };
}

export function findAccountById(id: string) {
  return mapAccount(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

export function createSession(userId: string, remember = false) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(tokenHash(token), userId, expiresAt, createdAt);
  return { token, expiresAt };
}

export function accountForToken(token: string) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  const row = db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), now());
  return mapAccount(row);
}

export function revokeSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function createInvitation(headId: string, input: { name: string; email: string; clusterLabel?: string }) {
  const email = input.email.trim().toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) throw new Error("ACCOUNT_EXISTS");
  if (db.prepare("SELECT id FROM invitations WHERE head_id = ? AND email = ? AND status = 'pending'").get(headId, email)) throw new Error("INVITATION_EXISTS");
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO invitations (id,head_id,name,email,cluster_label,token_hash,status,delivery_status,expires_at,created_at)
    VALUES (?,?,?,?,?,?, 'pending','sending',?,?)`).run(id, headId, input.name.trim(), email, input.clusterLabel?.trim() ?? "", tokenHash(token), expiresAt, createdAt);
  return { invitation: getInvitationById(id)!, token };
}

export function getInvitationById(id: string) {
  const row = db.prepare("SELECT * FROM invitations WHERE id = ?").get(id);
  return row ? mapInvitation(row) : null;
}

export function invitationForToken(token: string) {
  const row = db.prepare("SELECT * FROM invitations WHERE token_hash = ?").get(tokenHash(token));
  if (!row) return null;
  const invitation = mapInvitation(row);
  if (invitation.status === "pending" && invitation.expiresAt <= now()) {
    db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ?").run(invitation.id);
    invitation.status = "expired";
  }
  return invitation;
}

export function updateInvitationDelivery(id: string, status: Invitation["deliveryStatus"]) {
  db.prepare("UPDATE invitations SET delivery_status = ? WHERE id = ?").run(status, id);
  return getInvitationById(id);
}

export function refreshInvitation(id: string, headId: string) {
  const row = db.prepare("SELECT * FROM invitations WHERE id = ? AND head_id = ? AND status = 'pending'").get(id, headId);
  if (!row) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE invitations SET token_hash = ?, expires_at = ?, delivery_status = 'sending' WHERE id = ?")
    .run(tokenHash(token), expiresAt, id);
  return { invitation: getInvitationById(id)!, token };
}

export function revokeInvitation(id: string, headId: string) {
  const result = db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ? AND head_id = ? AND status = 'pending'").run(id, headId);
  return Number(result.changes) > 0;
}

export function acceptInvitation(token: string, input: { password: string; phone?: string }) {
  const invitation = invitationForToken(token);
  if (!invitation || invitation.status !== "pending") throw new Error("INVITATION_INVALID");
  const userId = randomUUID();
  const createdAt = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO users (id,head_id,email,name,phone,role,cluster_label,password_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,'member',?,?,?,?)`).run(
        userId, invitation.headId, invitation.email, invitation.name, input.phone?.trim() ?? "", invitation.clusterLabel,
        passwordHash(input.password), createdAt, createdAt,
      );
    const profile = defaultProfile(invitation.name, invitation.email);
    if (input.phone?.trim()) profile[4].value = input.phone.trim();
    db.prepare(`INSERT INTO workspaces (user_id,profile_json,schools_json,programs_json,sections_json,submitted_at,updated_at)
      VALUES (?,?,'[]','[]','[]',NULL,?)`).run(userId, JSON.stringify(profile), createdAt);
    db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE id = ?").run(createdAt, invitation.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return findAccountById(userId)!;
}

export function getWorkspace(userId: string): Workspace {
  const account = findAccountById(userId);
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  let row = db.prepare("SELECT * FROM workspaces WHERE user_id = ?").get(userId);
  if (!row) {
    const createdAt = now();
    db.prepare(`INSERT INTO workspaces (user_id,profile_json,schools_json,programs_json,sections_json,submitted_at,updated_at)
      VALUES (?,?,'[]','[]','[]',NULL,?)`).run(userId, JSON.stringify(defaultProfile(account.name, account.email)), createdAt);
    row = db.prepare("SELECT * FROM workspaces WHERE user_id = ?").get(userId)!;
  }
  return {
    userId, profile: JSON.parse(String(row.profile_json)), schools: JSON.parse(String(row.schools_json)),
    programs: JSON.parse(String(row.programs_json)), sections: JSON.parse(String(row.sections_json)),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null, updatedAt: String(row.updated_at),
  };
}

export function saveWorkspace(userId: string, input: Partial<Pick<Workspace, "profile" | "schools" | "programs" | "sections">>) {
  const current = getWorkspace(userId);
  const next = { ...current, ...input, updatedAt: now() };
  db.prepare(`UPDATE workspaces SET profile_json=?, schools_json=?, programs_json=?, sections_json=?, updated_at=? WHERE user_id=?`)
    .run(JSON.stringify(next.profile), JSON.stringify(next.schools), JSON.stringify(next.programs), JSON.stringify(next.sections), next.updatedAt, userId);
  return next;
}

export function submitWorkspace(userId: string) {
  const submittedAt = now();
  db.prepare("UPDATE workspaces SET submitted_at = ?, updated_at = ? WHERE user_id = ?").run(submittedAt, submittedAt, userId);
  return { submittedAt };
}

export function createVisit(userId:string,input:{schoolId:string;type:string;text:string;attachments?:string[]}){
  const item={id:randomUUID(),userId,schoolId:input.schoolId,type:input.type,text:input.text,attachments:input.attachments??[],createdAt:now()};
  db.prepare("INSERT INTO visits (id,user_id,school_id,type,text,attachments_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(item.id,userId,item.schoolId,item.type,item.text,JSON.stringify(item.attachments),item.createdAt);
  return item;
}

export function visitsForUser(userId:string){
  return db.prepare("SELECT * FROM visits WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(row=>({id:String(row.id),userId:String(row.user_id),schoolId:String(row.school_id),type:String(row.type),text:String(row.text),attachments:JSON.parse(String(row.attachments_json)),createdAt:String(row.created_at)}));
}

function completionFor(workspace: Workspace) {
  const editable = workspace.profile.filter(field => !field.derived);
  const filled = editable.filter(field => field.value.trim()).length;
  const schoolScore = workspace.schools.length ? 35 : 0;
  return Math.min(100, Math.round((filled / Math.max(1, editable.length)) * 65 + schoolScore));
}

export function teamForHead(headId: string) {
  const userRows = db.prepare("SELECT * FROM users WHERE head_id = ? AND role = 'member' ORDER BY created_at DESC").all(headId);
  const members = userRows.map(row => {
    const account = mapAccount(row)!;
    const workspace = getWorkspace(account.id);
    const schools = workspace.schools;
    const absence = schools.filter(school => Boolean(school.absence)).length;
    const disciplineValues = schools.flatMap(school => Array.isArray(school.discipline) ? school.discipline as number[] : []);
    const discipline = disciplineValues.length ? Math.round(disciplineValues.reduce((sum, value) => sum + Number(value), 0) / disciplineValues.length) : null;
    const visits = schools.reduce((sum, school) => sum + Number(school.visits ?? 0), 0);
    const submittedToday = workspace.submittedAt?.slice(0, 10) === now().slice(0, 10);
    return {
      ...account, initials: account.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2),
      completion: completionFor(workspace), schoolCount: schools.length, absence, discipline, visits,
      status: submittedToday ? "submitted" : "active", profile: workspace.profile, schools,
      submittedAt: workspace.submittedAt, workspaceUpdatedAt: workspace.updatedAt,
    };
  });
  const invitations = db.prepare("SELECT * FROM invitations WHERE head_id = ? AND status = 'pending' ORDER BY created_at DESC").all(headId).map(mapInvitation);
  return { members, invitations };
}
