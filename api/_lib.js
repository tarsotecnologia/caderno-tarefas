// Código compartilhado pelas funções da pasta /api (arquivos com "_" não viram rotas no Vercel).
import crypto from "node:crypto";
import pg from "pg";

// ---------- banco de dados ----------
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
export function db() {
  if (!connectionString) throw httpError(500, "Banco de dados não configurado: falta a variável DATABASE_URL no Vercel.");
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) || connectionString.includes("host=/");
    pool = new pg.Pool({ connectionString, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

let ready;
export function migrate() {
  ready ??= db().query(`
    create table if not exists users (
      id text primary key,
      name text not null,
      books jsonb not null default '[]',
      created_at timestamptz not null default now()
    );
    create table if not exists credentials (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      public_key bytea not null,
      counter bigint not null default 0,
      transports text[] not null default '{}',
      device text,
      created_at timestamptz not null default now(),
      last_used_at timestamptz
    );
    create index if not exists credentials_user on credentials(user_id);
    create table if not exists tasks (
      user_id text not null references users(id) on delete cascade,
      id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (user_id, id)
    );
  `).catch((e) => { ready = undefined; throw e; });
  return ready;
}

// ---------- erros e respostas ----------
export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export function handler(fn) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.method === "POST" && !sameOrigin(req)) throw httpError(403, "Origem não permitida.");
      await migrate();
      const out = await fn(req, res);
      if (!res.headersSent) res.status(200).json(out ?? { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) res.status(status).json({ error: e.status ? e.message : "Erro no servidor. Tente de novo." });
    }
  };
}

export function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== "object") throw httpError(400, "Pedido inválido.");
  return b;
}

// ---------- endereço do site (usado pela chave-senha) ----------
export function site(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  // RP_ID fixa o domínio das chaves-senha. Assim, trocar de endereço não perde as chaves já criadas:
  // o novo endereço é liberado em /.well-known/webauthn (veja api/webauthn.js).
  const rpID = (process.env.RP_ID || "").trim() || host.replace(/:\d+$/, "");
  return { origin: `${proto}://${host}`, rpID, secure: proto === "https" };
}

function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === site(req).origin;
}

// ---------- cookies assinados ----------
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw httpError(500, "Falta a variável SESSION_SECRET (com pelo menos 32 caracteres) no Vercel.");
  return s;
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function sign(value) {
  const payload = b64u(JSON.stringify(value));
  const mac = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}
function unsign(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, mac] = token.split(".");
  const good = crypto.createHmac("sha256", secret()).update(payload).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== good.length || !crypto.timingSafeEqual(got, good)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString());
    return v.exp && v.exp > Date.now() ? v : null;
  } catch { return null; }
}
function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(req, name, value, maxAgeSec) {
  const flags = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSec}`];
  if (site(req).secure) flags.push("Secure");
  return `${name}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}
function addCookie(res, c) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), c]);
}

const SESSION_DAYS = 180;
export function setSession(req, res, userId) {
  addCookie(res, cookie(req, "sess", sign({ u: userId, exp: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400));
}
export function clearSession(req, res) { addCookie(res, cookie(req, "sess", "", 0)); }
export function sessionUser(req) { return unsign(readCookies(req).sess)?.u || null; }
export function requireUser(req) {
  const u = sessionUser(req);
  if (!u) throw httpError(401, "Entre na sua conta para continuar.");
  return u;
}

export function setChallenge(req, res, data) {
  addCookie(res, cookie(req, "wa", sign({ ...data, exp: Date.now() + 5 * 60e3 }), 300));
}
export function takeChallenge(req, res) {
  const v = unsign(readCookies(req).wa);
  addCookie(res, cookie(req, "wa", "", 0));
  if (!v) throw httpError(400, "O pedido expirou. Tente de novo.");
  return v;
}

export const newId = () => b64u(crypto.randomBytes(16));
