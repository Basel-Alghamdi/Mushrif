// An in-process stand-in for the parts of Supabase that Rasd and supabase-js use — local runs and tests only:
//  • Auth (GoTrue): password sign-in, refresh, get/update user, logout, recover, verify, admin users, generate_link.
//    Users live in the local database's auth.users; access tokens are HS256 JWTs signed with SUPABASE_JWT_SECRET
//    (iss `${url}/auth/v1`, aud "authenticated", sub = user id) — exactly what apps/api/src/auth.ts verifies.
//  • Storage: private buckets kept on disk (create/get bucket, upload, download, remove).
// Browsers may call it (CORS), so `next dev` can sign in against it with @supabase/supabase-js.
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { SignJWT, jwtVerify } from "jose";
import postgres from "postgres";

export type FakeSupabaseOptions = {
  port: number;
  databaseUrl: string;
  storageDir: string;
  jwtSecret: string;
  publishableKey: string;
  secretKey: string;
  log?: (line: string) => void;
};
export type FakeSupabase = { url: string; stop: () => Promise<void> };

type UserRow = {
  id: string; email: string; encrypted_password: string | null; email_confirmed_at: Date | null; last_sign_in_at: Date | null;
  raw_app_meta_data: Record<string, unknown>; raw_user_meta_data: Record<string, unknown>; created_at: Date; updated_at: Date;
};

const API_VERSION = "2024-01-01";
const TOKEN_SECONDS = 3600;
const MIN_PASSWORD = 6;

class HttpError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.msg ?? body.message ?? status)); }
}
const authError = (status: number, code: string, msg: string) => new HttpError(status, { code, error_code: code, msg });
const storageError = (status: number, error: string, message: string) => new HttpError(status, { statusCode: String(status), error, message });

const hashPassword = (password: string) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;
};
const checkPassword = (password: string, stored: string | null) => {
  const [scheme, salt, hash] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "base64"), expected.length), expected);
};
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

function userJson(user: UserRow) {
  return {
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email, phone: "",
    email_confirmed_at: iso(user.email_confirmed_at), confirmed_at: iso(user.email_confirmed_at), last_sign_in_at: iso(user.last_sign_in_at),
    app_metadata: user.raw_app_meta_data ?? { provider: "email", providers: ["email"] }, user_metadata: user.raw_user_meta_data ?? {},
    identities: [], created_at: iso(user.created_at), updated_at: iso(user.updated_at), is_anonymous: false,
  };
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 120 * 1024 * 1024) throw storageError(413, "Payload too large", "The object exceeded the maximum allowed size");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
const jsonOf = (body: Buffer): Record<string, any> => {
  if (!body.length) return {};
  try { const value = JSON.parse(body.toString("utf8")); return value && typeof value === "object" ? value : {}; } catch { throw authError(400, "bad_json", "Could not parse request body as JSON"); }
};

export async function startFakeSupabase(options: FakeSupabaseOptions): Promise<FakeSupabase> {
  const url = `http://127.0.0.1:${options.port}`;
  const issuer = `${url}/auth/v1`;
  const secret = new TextEncoder().encode(options.jwtSecret);
  const sql = postgres(options.databaseUrl, { max: 4, onnotice: () => {} });
  const log = options.log ?? (() => {});
  mkdirSync(options.storageDir, { recursive: true });

  // ───────── auth helpers ─────────
  const userById = async (id: string) => (await sql<UserRow[]>`select * from auth.users where id = ${id}`)[0] ?? null;
  const userByEmail = async (email: string) => (await sql<UserRow[]>`select * from auth.users where email = ${email.trim().toLowerCase()}`)[0] ?? null;

  async function session(user: UserRow) {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({
      email: user.email, phone: "", app_metadata: user.raw_app_meta_data, user_metadata: user.raw_user_meta_data, role: "authenticated",
      aal: "aal1", amr: [{ method: "password", timestamp: now }], session_id: randomUUID(), is_anonymous: false,
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(user.id).setAudience("authenticated").setIssuer(issuer)
      .setIssuedAt(now).setExpirationTime(now + TOKEN_SECONDS).sign(secret);
    const refreshToken = randomBytes(24).toString("base64url");
    await sql`insert into auth.refresh_tokens (token, user_id) values (${refreshToken}, ${user.id})`;
    return { access_token: accessToken, token_type: "bearer", expires_in: TOKEN_SECONDS, expires_at: now + TOKEN_SECONDS, refresh_token: refreshToken, user: userJson(user) };
  }

  const bearer = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? "";
    return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  };
  const apiKey = (req: IncomingMessage) => String(req.headers.apikey ?? "");
  const isService = (req: IncomingMessage) => bearer(req) === options.secretKey || apiKey(req) === options.secretKey;
  const requireApiKey = (req: IncomingMessage) => {
    if (![options.publishableKey, options.secretKey].includes(apiKey(req)) && !isService(req)) throw new HttpError(401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });
  };
  const requireService = (req: IncomingMessage) => { if (!isService(req)) throw authError(403, "not_admin", "User not allowed"); };
  async function requireUser(req: IncomingMessage) {
    try {
      const { payload } = await jwtVerify(bearer(req), secret, { issuer, audience: "authenticated" });
      const user = payload.sub ? await userById(payload.sub) : null;
      if (!user) throw authError(403, "user_not_found", "User from sub claim in JWT does not exist");
      return user;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw authError(403, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    }
  }

  async function createUser(input: { email?: unknown; password?: unknown; emailConfirm?: boolean; metadata?: unknown; appMetadata?: unknown }) {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email.includes("@")) throw authError(400, "validation_failed", "Unable to validate email address: invalid format");
    if (await userByEmail(email)) throw authError(422, "email_exists", "A user with this email address has already been registered");
    const password = typeof input.password === "string" ? input.password : null;
    if (password !== null && password.length < MIN_PASSWORD) throw new HttpError(422, { code: "weak_password", msg: `Password should be at least ${MIN_PASSWORD} characters.`, weak_password: { reasons: ["length"] } });
    const [user] = await sql<UserRow[]>`
      insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
      values (${email}, ${password ? hashPassword(password) : null}, ${input.emailConfirm ? new Date() : null}, ${sql.json((input.metadata ?? {}) as never)},
        ${sql.json({ provider: "email", providers: ["email"], ...((input.appMetadata ?? {}) as Record<string, unknown>) } as never)})
      returning *`;
    return user;
  }

  async function updateUser(user: UserRow, input: Record<string, any>) {
    if (typeof input.email === "string" && input.email.trim().toLowerCase() !== user.email) {
      const email = input.email.trim().toLowerCase();
      const taken = await userByEmail(email);
      if (taken && taken.id !== user.id) throw authError(422, "email_exists", "A user with this email address has already been registered");
      await sql`update auth.users set email = ${email}, updated_at = now() where id = ${user.id}`;
    }
    if (typeof input.password === "string") {
      if (input.password.length < MIN_PASSWORD) throw new HttpError(422, { code: "weak_password", msg: `Password should be at least ${MIN_PASSWORD} characters.`, weak_password: { reasons: ["length"] } });
      await sql`update auth.users set encrypted_password = ${hashPassword(input.password)}, updated_at = now() where id = ${user.id}`;
    }
    if (input.email_confirm === true) await sql`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = ${user.id}`;
    const metadata = input.user_metadata ?? input.data;
    if (metadata && typeof metadata === "object") await sql`update auth.users set raw_user_meta_data = raw_user_meta_data || ${sql.json(metadata)}, updated_at = now() where id = ${user.id}`;
    return (await userById(user.id))!;
  }

  async function oneTimeToken(user: UserRow, type: string) {
    const hashed = sha256(randomBytes(24).toString("hex"));
    await sql`insert into auth.one_time_tokens (token_hash, user_id, token_type) values (${hashed}, ${user.id}, ${type})`;
    return hashed;
  }

  async function consumeToken(tokenHash: string, type: string) {
    const types = type === "email" ? ["magiclink", "signup", "invite", "email"] : [type];
    const [row] = await sql`delete from auth.one_time_tokens where token_hash = ${tokenHash} and token_type = any(${types}) returning user_id`;
    if (!row) throw authError(403, "otp_expired", "Email link is invalid or has expired");
    await sql`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = ${row.user_id}`;
    return (await userById(String(row.user_id)))!;
  }

  // ───────── storage helpers ─────────
  const bucketDir = (bucket: string) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(bucket)) throw storageError(400, "Invalid bucket", "The bucket name is invalid");
    return join(options.storageDir, bucket);
  };
  const objectFile = (bucket: string, path: string) => {
    const root = join(bucketDir(bucket), "objects");
    const file = resolve(root, path);
    if (!path || !file.startsWith(root + sep)) throw storageError(400, "Invalid key", "The object key is invalid");
    return file;
  };
  const requireBucket = (bucket: string) => {
    if (!existsSync(join(bucketDir(bucket), "bucket.json"))) throw storageError(404, "Bucket not found", "Bucket not found");
  };

  // ───────── routing ─────────
  async function handleAuth(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams, body: Buffer) {
    const method = req.method ?? "GET";
    const send = (status: number, payload?: unknown) => reply(res, status, payload, { "x-supabase-api-version": API_VERSION });

    if (path === "/health" || path === "/settings") return send(200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: false });
    if (path === "/.well-known/jwks.json") return send(200, { keys: [] });

    if (path === "/token" && method === "POST") {
      requireApiKey(req);
      const input = jsonOf(body);
      if (query.get("grant_type") === "password") {
        const user = typeof input.email === "string" ? await userByEmail(input.email) : null;
        if (!user || !checkPassword(String(input.password ?? ""), user.encrypted_password)) throw authError(400, "invalid_credentials", "Invalid login credentials");
        if (!user.email_confirmed_at) throw authError(400, "email_not_confirmed", "Email not confirmed");
        await sql`update auth.users set last_sign_in_at = now() where id = ${user.id}`;
        return send(200, await session((await userById(user.id))!));
      }
      if (query.get("grant_type") === "refresh_token") {
        const [row] = await sql`select user_id from auth.refresh_tokens where token = ${String(input.refresh_token ?? "")} and not revoked`;
        const user = row ? await userById(String(row.user_id)) : null;
        if (!user) throw authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        return send(200, await session(user));
      }
      throw authError(400, "unsupported_grant_type", "unsupported_grant_type");
    }

    if (path === "/user" && method === "GET") return send(200, userJson(await requireUser(req)));
    if (path === "/user" && method === "PUT") return send(200, userJson(await updateUser(await requireUser(req), jsonOf(body))));
    if (path === "/logout" && method === "POST") {
      const user = await requireUser(req);
      await sql`update auth.refresh_tokens set revoked = true where user_id = ${user.id}`;
      return send(204);
    }

    if (path === "/recover" && method === "POST") {
      requireApiKey(req);
      const input = jsonOf(body);
      const user = typeof input.email === "string" ? await userByEmail(input.email) : null;
      if (user) {
        const hashed = await oneTimeToken(user, "recovery");
        const redirect = query.get("redirect_to") ?? "";
        log(`[fake-supabase] password recovery for ${user.email}: ${redirect ? `${redirect}?token_hash=${hashed}&type=recovery` : `token_hash=${hashed}`}`);
      }
      return send(200, {});
    }

    if (path === "/verify" && method === "POST") {
      requireApiKey(req);
      const input = jsonOf(body);
      if (typeof input.token_hash !== "string") throw authError(400, "validation_failed", "Verify requires a token_hash");
      return send(200, await session(await consumeToken(input.token_hash, String(input.type ?? "email"))));
    }
    if (path === "/verify" && method === "GET") {
      // The action link of a generated email: signs in and returns to redirect_to with the session in the hash.
      const user = await consumeToken(query.get("token") ?? "", query.get("type") ?? "email");
      const tokens = await session(user);
      const target = query.get("redirect_to") || "/";
      const hash = new URLSearchParams({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: String(tokens.expires_in), expires_at: String(tokens.expires_at), token_type: "bearer", type: query.get("type") ?? "email" });
      res.writeHead(303, { location: `${target}#${hash}` });
      return res.end();
    }

    // ───────── admin ─────────
    if (path.startsWith("/admin/")) requireService(req);
    if (path === "/admin/users" && method === "GET") {
      const page = Math.max(1, Number(query.get("page")) || 1);
      const perPage = Math.min(1000, Math.max(1, Number(query.get("per_page")) || 50));
      const users = await sql<UserRow[]>`select * from auth.users order by created_at, id limit ${perPage} offset ${(page - 1) * perPage}`;
      const [{ count }] = await sql`select count(*)::int as count from auth.users`;
      return reply(res, 200, { users: users.map(userJson), aud: "authenticated" }, { "x-supabase-api-version": API_VERSION, "x-total-count": String(count) });
    }
    if (path === "/admin/users" && method === "POST") {
      const input = jsonOf(body);
      const user = await createUser({ email: input.email, password: input.password, emailConfirm: input.email_confirm === true, metadata: input.user_metadata, appMetadata: input.app_metadata });
      return send(200, userJson(user));
    }
    const userPath = /^\/admin\/users\/([0-9a-f-]{36})$/i.exec(path);
    if (userPath) {
      const user = await userById(userPath[1]);
      if (!user) throw authError(404, "user_not_found", "User not found");
      if (method === "GET") return send(200, userJson(user));
      if (method === "PUT") return send(200, userJson(await updateUser(user, jsonOf(body))));
      if (method === "DELETE") {
        try { await sql`delete from auth.users where id = ${user.id}`; } catch (error) {
          throw authError(500, "unexpected_failure", `Database error deleting user: ${(error as Error).message}`);
        }
        return send(200, userJson(user));
      }
    }
    if (path === "/admin/generate_link" && method === "POST") {
      const input = jsonOf(body);
      const type = String(input.type ?? "");
      let user = typeof input.email === "string" ? await userByEmail(input.email) : null;
      if (!user && (type === "signup" || type === "invite")) user = await createUser({ email: input.email, password: input.password, metadata: input.data });
      if (!user) throw authError(404, "user_not_found", "User with this email not found");
      const hashed = await oneTimeToken(user, type);
      const redirect = String(input.redirect_to ?? query.get("redirect_to") ?? "");
      return send(200, {
        ...userJson(user), action_link: `${issuer}/verify?token=${hashed}&type=${type}${redirect ? `&redirect_to=${encodeURIComponent(redirect)}` : ""}`,
        email_otp: String(100000 + (parseInt(hashed.slice(0, 8), 16) % 900000)), hashed_token: hashed, redirect_to: redirect, verification_type: type,
      });
    }
    throw authError(404, "not_found", `${method} /auth/v1${path} is not supported by the local Supabase`);
  }

  async function handleStorage(req: IncomingMessage, res: ServerResponse, path: string, body: Buffer, headers: Record<string, string>) {
    const method = req.method ?? "GET";
    if (!isService(req)) throw storageError(403, "Unauthorized", "The local Supabase only accepts the secret key for Storage");

    if (path === "/bucket" && method === "POST") {
      const input = jsonOf(body);
      const id = String(input.id ?? input.name ?? "");
      const dir = bucketDir(id);
      if (existsSync(join(dir, "bucket.json"))) throw storageError(409, "Duplicate", "The resource already exists");
      mkdirSync(join(dir, "objects"), { recursive: true });
      writeFileSync(join(dir, "bucket.json"), JSON.stringify({ id, name: id, public: input.public === true, created_at: new Date().toISOString() }));
      return reply(res, 200, { name: id });
    }
    const bucketPath = /^\/bucket\/([^/]+)$/.exec(path);
    if (bucketPath && method === "GET") {
      requireBucket(bucketPath[1]);
      const meta = JSON.parse(readFileSync(join(bucketDir(bucketPath[1]), "bucket.json"), "utf8"));
      return reply(res, 200, { ...meta, owner: "", file_size_limit: null, allowed_mime_types: null, updated_at: meta.created_at });
    }

    const objectPath = /^\/object\/(?:authenticated\/)?([^/]+)(?:\/(.+))?$/.exec(path);
    if (!objectPath) throw storageError(404, "not_found", `${method} /storage/v1${path} is not supported by the local Supabase`);
    const bucket = objectPath[1];
    const key = (objectPath[2] ?? "").split("/").map(decodeURIComponent).join("/");
    requireBucket(bucket);

    if (!key && method === "DELETE") {
      const prefixes = (jsonOf(body).prefixes ?? []) as string[];
      const removed = [];
      for (const prefix of prefixes) {
        const file = objectFile(bucket, prefix);
        if (!existsSync(file)) continue;
        rmSync(file, { force: true });
        rmSync(`${file}.meta.json`, { force: true });
        removed.push({ name: prefix, bucket_id: bucket, id: randomUUID() });
      }
      return reply(res, 200, removed);
    }

    const file = objectFile(bucket, key);
    if (method === "POST" || method === "PUT") {
      if (method === "POST" && headers["x-upsert"] !== "true" && existsSync(file)) throw storageError(409, "Duplicate", "The resource already exists");
      let bytes = body;
      let contentType = headers["content-type"] || "application/octet-stream";
      if (contentType.startsWith("multipart/form-data")) {
        const form = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
        const part = [...form.values()].find((value): value is File => typeof value !== "string");
        if (!part) throw storageError(400, "Invalid body", "No file in the form");
        bytes = Buffer.from(await part.arrayBuffer());
        contentType = part.type || "application/octet-stream";
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      writeFileSync(`${file}.meta.json`, JSON.stringify({ contentType, size: bytes.length, updatedAt: new Date().toISOString() }));
      return reply(res, 200, { Key: `${bucket}/${key}`, Id: randomUUID() });
    }
    if (method === "GET" || method === "HEAD") {
      if (!existsSync(file)) throw storageError(404, "not_found", "Object not found");
      const meta = existsSync(`${file}.meta.json`) ? JSON.parse(readFileSync(`${file}.meta.json`, "utf8")) : {};
      const bytes = readFileSync(file);
      res.writeHead(200, { "content-type": meta.contentType ?? "application/octet-stream", "content-length": String(bytes.length) });
      return res.end(method === "HEAD" ? undefined : bytes);
    }
    throw storageError(405, "Method not allowed", `${method} is not supported here`);
  }

  function reply(res: ServerResponse, status: number, payload?: unknown, extra: Record<string, string> = {}) {
    if (status === 204 || payload === undefined) {
      res.writeHead(status, extra);
      return res.end();
    }
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extra });
    return res.end(JSON.stringify(payload));
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader("access-control-allow-origin", origin ?? "*");
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
    res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-upsert, cache-control, x-metadata");
    res.setHeader("access-control-expose-headers", "x-total-count, link, x-supabase-api-version, content-range, content-disposition");
    res.setHeader("access-control-max-age", "86400");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    const address = new URL(req.url ?? "/", url);
    const path = address.pathname;
    const isAuth = path.startsWith("/auth/v1");
    try {
      const body = await readBody(req);
      const headers = Object.fromEntries(Object.entries(req.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(",") : value ?? ""]));
      if (isAuth) await handleAuth(req, res, path.slice("/auth/v1".length) || "/", address.searchParams, body);
      else if (path.startsWith("/storage/v1")) await handleStorage(req, res, path.slice("/storage/v1".length), body, headers);
      else reply(res, 404, { message: `${path} is not served by the local Supabase` });
    } catch (error) {
      if (error instanceof HttpError) return reply(res, error.status, error.body, isAuth ? { "x-supabase-api-version": API_VERSION } : {});
      log(`[fake-supabase] ${req.method} ${path} failed: ${(error as Error).stack ?? error}`);
      reply(res, 500, isAuth ? { code: "unexpected_failure", msg: (error as Error).message } : { statusCode: "500", error: "internal", message: (error as Error).message });
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, "127.0.0.1", () => resolveListen());
  });

  return {
    url,
    stop: async () => {
      server.closeAllConnections?.();
      await new Promise<void>(done => server.close(() => done()));
      await sql.end({ timeout: 2 });
    },
  };
}
