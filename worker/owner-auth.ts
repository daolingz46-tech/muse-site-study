import type { D1Database } from "@cloudflare/workers-types";

/** Caller must enforce trusted Origin and rate-limit login attempts before using these helpers. */
export type OwnerAuthEnv = { DB: D1Database; OWNER_PASSWORD_HASH?: string };
const iterationsDefault = 100_000;
const maxSessionMs = 15 * 60 * 1000;
const cookieName = "__Secure-muse_owner";
const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string { return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join(""); }
async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function same(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map(value => parseInt(value, 16)));
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256)));
}
function parseCredential(value: string | undefined): { iterations: number; salt: string; digest: string } | null {
  const match = /^pbkdf2-sha256\$(\d{6,7})\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(value || "");
  if (!match) return null;
  const iterations = Number(match[1]);
  return iterations === iterationsDefault ? { iterations, salt: match[2], digest: match[3] } : null;
}
/** For secure local provisioning only; store the result as a Worker secret, never in source control. */
export async function makeOwnerPasswordHash(password: string): Promise<string> {
  if (password.length < 16 || password.length > 256) throw new Error("invalid_owner_password");
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256$${iterationsDefault}$${salt}$${await derive(password, salt, iterationsDefault)}`;
}
function ownerCookie(value: string, maxAge: number): string {
  return `${cookieName}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function cookieToken(request: Request): string {
  return request.headers.get("Cookie")?.match(/(?:^|;\s*)__Secure-muse_owner=([a-f0-9]{64})(?:;|$)/)?.[1] || "";
}
function adminTokenValid(token: string): boolean { return /^[a-f0-9]{64}$/.test(token); }

/** Rechecks admin session atomically while issuing a short-lived, session-bound elevation. */
export async function createOwnerSession(env: OwnerAuthEnv, adminToken: string, password: string): Promise<{ ok: true; setCookie: string } | { ok: false; reason: "unauthorized" | "unconfigured" }> {
  const credential = parseCredential(env.OWNER_PASSWORD_HASH);
  if (!credential) return { ok: false, reason: "unconfigured" };
  if (!adminTokenValid(adminToken) || password.length < 16 || password.length > 256) return { ok: false, reason: "unauthorized" };
  const adminHash = await sha256(adminToken);
  const admin = await env.DB.prepare("SELECT expiresAt FROM sessions WHERE hash=? AND expiresAt>?").bind(adminHash, Date.now()).first<{expiresAt:number}>();
  if (!admin || !same(await derive(password, credential.salt, credential.iterations), credential.digest)) return { ok: false, reason: "unauthorized" };
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now(), expiresAt = Math.min(now + maxSessionMs, admin.expiresAt);
  const result = await env.DB.prepare("INSERT INTO owner_sessions(hash,adminHash,credentialVersion,expiresAt) SELECT ?,hash,?,? FROM sessions WHERE hash=? AND expiresAt>?")
    .bind(await sha256(token), await sha256(env.OWNER_PASSWORD_HASH!), expiresAt, adminHash, now).run();
  if (!result.meta.changes) return { ok: false, reason: "unauthorized" };
  return { ok: true, setCookie: ownerCookie(token, Math.max(0, Math.floor((expiresAt - now) / 1000))) };
}

/** Never accept an owner cookie without the exact still-valid admin session that created it. */
export async function hasOwnerSession(env: OwnerAuthEnv, request: Request, adminToken: string): Promise<boolean> {
  if (!parseCredential(env.OWNER_PASSWORD_HASH) || !adminTokenValid(adminToken)) return false;
  const ownerToken = cookieToken(request);
  if (!ownerToken) return false;
  const now = Date.now();
  const row = await env.DB.prepare("SELECT o.hash FROM owner_sessions o JOIN sessions s ON s.hash=o.adminHash WHERE o.hash=? AND o.adminHash=? AND o.credentialVersion=? AND o.expiresAt>? AND s.expiresAt>?")
    .bind(await sha256(ownerToken), await sha256(adminToken), await sha256(env.OWNER_PASSWORD_HASH!), now, now).first();
  return Boolean(row);
}

export async function clearOwnerSession(env: OwnerAuthEnv, request: Request): Promise<string> {
  const token = cookieToken(request);
  if (token) await env.DB.prepare("DELETE FROM owner_sessions WHERE hash=?").bind(await sha256(token)).run();
  return ownerCookie("", 0);
}
