import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
  databaseUrl: string;
  port: number;
  publicUrl: string;
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  packSigningKeyPem: string | null;
  storageDriver: "local";
  storageDir: string;
  maxUploadBytes: number;
  corsOrigins: string[];
  downloadTicketTtlSec: number;
  authRateLimitPerMin: number;
}

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadDotEnv();
  const env = process.env;
  const jwtSecret = overrides.jwtSecret ?? env.JWT_SECRET ?? "";
  if (Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET ausente ou curto demais (mínimo 32 bytes).");
  }
  const keyPath = env.PACK_SIGNING_KEY_PATH;
  const packSigningKeyPem =
    overrides.packSigningKeyPem !== undefined
      ? overrides.packSigningKeyPem
      : keyPath && existsSync(keyPath)
        ? readFileSync(keyPath, "utf8")
        : null;
  return {
    databaseUrl: env.DATABASE_URL ?? "postgres://motionhub:motionhub@localhost:5432/motionhub",
    port: Number(env.PORT ?? 8080),
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:8080").replace(/\/$/, ""),
    accessTtlSec: 15 * 60,
    refreshTtlSec: 30 * 24 * 3600,
    storageDriver: "local",
    storageDir: resolve(env.STORAGE_DIR ?? "./storage"),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 2048) * 1024 * 1024,
    corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    downloadTicketTtlSec: 10 * 60,
    authRateLimitPerMin: Number(env.AUTH_RATE_LIMIT_PER_MIN ?? 10),
    ...overrides,
    jwtSecret,
    packSigningKeyPem,
  };
}
