import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yazl from "yazl";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createContext } from "../src/bootstrap.js";
import { migrate } from "../src/db.js";
import { hashPassword, sha256Hex } from "../src/crypto.js";
import type { AppContext } from "../src/context.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://motionhub:motionhub@localhost:5432/motionhub_test";
export const PASSWORD = "senha-de-teste-123";

export interface TestEnv {
  ctx: AppContext;
  app: FastifyInstance;
  orgId: string;
  users: Record<"editor" | "designer" | "curator" | "admin", { id: string; email: string }>;
  dir: string;
  close(): Promise<void>;
}

export async function setup(): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), "mh-test-"));
  const { privateKey } = generateKeyPairSync("ed25519");
  const ctx = createContext({
    databaseUrl: TEST_DB,
    jwtSecret: "x".repeat(40),
    storageDir: join(dir, "storage"),
    publicUrl: "http://test.local",
    authRateLimitPerMin: 10_000,
    corsOrigins: ["http://localhost:5173"],
    packSigningKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
  await ctx.db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(ctx.db);
  const orgId = (await ctx.db.query<{ id: string }>("INSERT INTO orgs (name) VALUES ('Megalume') RETURNING id")).rows[0]!.id;
  const hash = await hashPassword(PASSWORD);
  const users = {} as TestEnv["users"];
  for (const [k, role] of [["editor", "editor"], ["designer", "motion_designer"], ["curator", "curator"], ["admin", "admin"]] as const) {
    const email = `${k}@megalume.test`;
    const id = (await ctx.db.query<{ id: string }>("INSERT INTO users (org_id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id", [orgId, k, email, role, hash])).rows[0]!.id;
    users[k] = { id, email };
  }
  const app = await buildApp(ctx);
  return {
    ctx,
    app,
    orgId,
    users,
    dir,
    async close() {
      await app.close();
      await ctx.db.end();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function login(env: TestEnv, who: keyof TestEnv["users"]): Promise<string> {
  const r = await env.app.inject({ method: "POST", url: "/v1/auth/session", payload: { email: env.users[who].email, password: PASSWORD } });
  if (r.statusCode !== 200) throw new Error(`login falhou: ${r.body}`);
  return r.json().accessToken;
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** Gera mídia real com ffmpeg e um .mogrt (ZIP) mínimo. */
export async function makeMedia(dir: string) {
  const mp4 = join(dir, "loop.mp4");
  const png = join(dir, "poster.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720", "-frames:v", "1", png]);
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('{"fake":"mogrt"}'), "definition.json");
  zip.end();
  const chunks: Buffer[] = [];
  for await (const c of zip.outputStream) chunks.push(c as Buffer);
  const mogrt = Buffer.concat(chunks);
  return { mp4: readFileSync(mp4), png: readFileSync(png), mogrt };
}

export function manifestFor(mogrt: Buffer, over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "meg-title-rise-001",
    version: "1.0.0",
    name: "Título Rise Institucional",
    type: "title",
    hosts: [{ name: "premiere", minVersion: "25.6" }],
    assets: [{ path: "template/title.mogrt", sha256: sha256Hex(mogrt), role: "template" }],
    preview: { path: "preview/loop.mp4", poster: "preview/poster.png" },
    parameters: [{ key: "headline", type: "string", default: "MEGALUME", maxLength: 120 }],
    aspectRatio: "16:9",
    license: "megalume-internal",
    tags: ["institucional", "clean"],
    ...over,
  };
}
