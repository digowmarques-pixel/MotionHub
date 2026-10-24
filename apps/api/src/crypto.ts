import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, scrypt, sign, timingSafeEqual, type KeyObject } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const got = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

// ---- JWT HS256 (access tokens curtos) ----
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export interface AccessClaims {
  sub: string;
  org: string;
  role: string;
  iat: number;
  exp: number;
}

export function signJwt(claims: Omit<AccessClaims, "iat" | "exp">, secret: string, ttlSec: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ ...claims, iat, exp: iat + ttlSec }));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verifyJwt(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    if (header.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as AccessClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---- URLs assinadas (links efêmeros para download, M13) ----
export function signUrlParams(key: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`file:${key}:${expiresAt}`).digest("base64url");
}

export function verifyUrlParams(key: string, expiresAt: number, sig: string, secret: string, now = Date.now()): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now) return false;
  const expected = Buffer.from(signUrlParams(key, expiresAt, secret), "base64url");
  const got = Buffer.from(sig, "base64url");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ---- Assinatura Ed25519 de manifests de pacote ----
export interface PackSigner {
  keyId: string;
  publicKeyPem: string;
  sign(data: Buffer): string;
}

export function createPackSigner(privatePem: string): PackSigner {
  const priv: KeyObject = createPrivateKey(privatePem);
  const pub = createPublicKey(priv);
  const publicKeyPem = pub.export({ type: "spki", format: "pem" }).toString();
  return {
    keyId: sha256Hex(pub.export({ type: "spki", format: "der" })).slice(0, 16),
    publicKeyPem,
    sign: (data) => sign(null, data, priv).toString("base64"),
  };
}

/** Serialização canônica (chaves ordenadas) para assinar/verificar JSON de forma estável. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}
