import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yazl from "yazl";
import { DesktopApi } from "../src/core/api.js";
import { Library } from "../src/core/library.js";
import { installPack, type TrustedKey } from "../src/core/installer.js";
import type { MlpackManifest, PackSummary } from "../src/core/types.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const KEY: TrustedKey = { keyId: "k1", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
const MOGRT = Buffer.from("PK\u0003\u0004 conteúdo do mogrt ".repeat(50));
const MP4 = Buffer.alloc(40_000, 7);

interface BuildOpts {
  files?: Array<[string, Buffer]>;
  manifestFiles?: Array<{ path: string; sha256: string; bytes: number; role: string }>;
  tamperSignature?: boolean;
  signer?: typeof privateKey;
  keyId?: string;
  version?: string;
}

async function buildPack(o: BuildOpts = {}): Promise<Buffer> {
  const files = o.files ?? [["meg-titulo/1.0.0/template/title.mogrt", MOGRT], ["meg-titulo/1.0.0/preview/loop.mp4", MP4]];
  const manifest: MlpackManifest = {
    format: "mlpack/1",
    slug: "piloto",
    name: "Pacote Piloto",
    version: o.version ?? "1.0.0",
    license: "megalume-internal",
    createdAt: "2026-10-24T00:00:00Z",
    hosts: [{ name: "premiere", minVersion: "25.6" }],
    assets: [{
      assetId: "a1",
      slug: "meg-titulo",
      version: "1.0.0",
      manifest: { type: "title", name: "Título" },
      files: o.manifestFiles ?? files.map(([p, b]) => ({ path: p, sha256: sha(b), bytes: b.length, role: p.includes("template") ? "template" : "preview" })),
    }],
  };
  const raw = Buffer.from(JSON.stringify(manifest));
  let signature = sign(null, raw, o.signer ?? privateKey).toString("base64");
  if (o.tamperSignature) signature = sign(null, Buffer.from("outro"), privateKey).toString("base64");
  const z = new yazl.ZipFile();
  z.addBuffer(raw, "manifest.json");
  z.addBuffer(Buffer.from(JSON.stringify({ algorithm: "ed25519", keyId: o.keyId ?? "k1", signature })), "signature.json");
  for (const [p, b] of files) z.addBuffer(b, p, { compress: false });
  z.end();
  const chunks: Buffer[] = [];
  for await (const c of z.outputStream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Troca um nome dentro do ZIP (mesmo tamanho), para simular pacotes maliciosos que o yazl não deixaria criar. */
const renameInZip = (zip: Buffer, from: string, to: string) => {
  if (from.length !== to.length) throw new Error("tamanhos diferentes");
  return Buffer.from(zip.toString("latin1").split(from).join(to), "latin1");
};

class FakeServer {
  archive: Buffer = Buffer.alloc(0);
  publishedSha = "";
  dropAfter: number | null = null;
  rangeRequests: string[] = [];
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/auth/session")) return json({ accessToken: "a", refreshToken: "r".repeat(30), expiresIn: 900, user: { id: "u", orgId: "o", name: "n", email: "e", role: "editor", status: "active", createdAt: "" } });
    if (url.includes("/manifest")) return json({ keyId: "k1", archive: { sha256: this.publishedSha || sha(this.archive), bytes: this.archive.length } });
    if (url.includes("/download-ticket")) return json({ url: "http://srv/file" });
    if (url === "http://srv/file") {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (range) this.rangeRequests.push(range);
      const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      let body = this.archive.subarray(from);
      if (this.dropAfter !== null) {
        // primeira tentativa: conexão cai no meio
        const cut = this.dropAfter;
        this.dropAfter = null;
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(body.subarray(0, cut)));
            setTimeout(() => c.error(new Error("ECONNRESET")), 50);
          },
        });
        return new Response(stream, { status: from ? 206 : 200 });
      }
      return new Response(new Uint8Array(body), { status: from ? 206 : 200 });
    }
    return new Response("{}", { status: 404 });
  };
}

let dir: string;
let lib: Library;
let server: FakeServer;
let api: DesktopApi;
const pack = (version = "1.0.0"): PackSummary => ({ id: "p1", slug: "piloto", name: "Pacote Piloto", version, license: "x", status: "ready", archiveSha256: null, archiveBytes: null, createdAt: "" });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mh-lib-"));
  lib = new Library(dir);
  await lib.load();
  server = new FakeServer();
  api = new DesktopApi(null, async () => {}, server.fetch);
  await api.login("http://srv", "e@x", "p");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("instalação de pacote", () => {
  it("instala, verifica hashes e registra no índice", async () => {
    server.archive = await buildPack();
    const stages: string[] = [];
    const v = await installPack(api, lib, pack(), KEY, { onProgress: (p) => stages.push(p.stage) });
    expect(new Set(stages)).toEqual(new Set(["manifest", "download", "verify", "extract", "activate", "done"]));
    const mogrt = v.assets[0]!.files.find((f) => f.role === "template")!;
    expect(readFileSync(mogrt.absPath).equals(MOGRT)).toBe(true);
    expect(lib.installed("piloto")).toBe("1.0.0");
    expect(existsSync(join(dir, ".staging", "piloto-1.0.0.mlpack"))).toBe(false);
  });

  it("retoma o download do ponto em que a conexão caiu (Range)", async () => {
    server.archive = await buildPack();
    server.dropAfter = 5000;
    await installPack(api, lib, pack(), KEY);
    expect(server.rangeRequests).toEqual(["bytes=5000-"]);
    expect(lib.installed("piloto")).toBe("1.0.0");
  });

  it("CT-003: hash do arquivo diferente do publicado → recusa, versão antiga permanece", async () => {
    server.archive = await buildPack();
    await installPack(api, lib, pack(), KEY);
    server.archive = await buildPack({ version: "1.1.0" });
    server.publishedSha = "0".repeat(64);
    await expect(installPack(api, lib, pack("1.1.0"), KEY)).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(lib.installed("piloto")).toBe("1.0.0");
    expect(existsSync(join(dir, "packs", "piloto", "1.1.0"))).toBe(false);
  });

  it("recusa assinatura inválida e chave não confiável", async () => {
    server.archive = await buildPack({ tamperSignature: true });
    await expect(installPack(api, lib, pack(), KEY)).rejects.toMatchObject({ code: "signature_invalid" });
    const other = generateKeyPairSync("ed25519").privateKey;
    server.archive = await buildPack({ signer: other });
    await expect(installPack(api, lib, pack(), KEY)).rejects.toMatchObject({ code: "signature_invalid" });
    server.archive = await buildPack({ keyId: "k2" });
    await expect(installPack(api, lib, pack(), KEY)).rejects.toMatchObject({ code: "untrusted_key" });
    expect(lib.installed("piloto")).toBeNull();
  });

  it("recusa arquivo adulterado dentro do pacote (manifest assinado com hash correto)", async () => {
    const evil = Buffer.from(MOGRT);
    evil[100] = 0x41;
    server.archive = await buildPack({ files: [["meg-titulo/1.0.0/template/title.mogrt", evil]], manifestFiles: [{ path: "meg-titulo/1.0.0/template/title.mogrt", sha256: sha(MOGRT), bytes: MOGRT.length, role: "template" }] });
    await expect(installPack(api, lib, pack(), KEY)).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(lib.installed("piloto")).toBeNull();
    expect(existsSync(join(dir, "packs", "piloto"))).toBe(false);
  });

  it("recusa path traversal (§9, M10)", async () => {
    const good = await buildPack({ files: [["aa/evil.mogr", MOGRT]] });
    server.archive = renameInZip(good, "aa/evil.mogr", "../evil.mogr");
    await expect(installPack(api, lib, pack(), KEY)).rejects.toMatchObject({ code: "unsafe_archive" });
    expect(existsSync(join(dir, "evil.mogr"))).toBe(false);
    expect(existsSync(join(dir, "..", "evil.mogr"))).toBe(false);
  });

  it("recusa arquivo não declarado no manifest", async () => {
    server.archive = await buildPack({
      files: [["meg-titulo/1.0.0/template/title.mogrt", MOGRT], ["meg-titulo/1.0.0/script.jsx", Buffer.from("app.quit()")]],
      manifestFiles: [{ path: "meg-titulo/1.0.0/template/title.mogrt", sha256: sha(MOGRT), bytes: MOGRT.length, role: "template" }],
    });
    await expect(installPack(api, lib, pack(), KEY)).rejects.toThrow(/não declarados/);
  });

  it("recusa zip bomb (tamanho declarado divergente / acima do limite)", async () => {
    const big = Buffer.alloc(5_000_000, 0);
    server.archive = await buildPack({ files: [["meg-titulo/1.0.0/media/b.mp4", big]], manifestFiles: [{ path: "meg-titulo/1.0.0/media/b.mp4", sha256: sha(big), bytes: 100, role: "media" }] });
    await expect(installPack(api, lib, pack(), KEY)).rejects.toMatchObject({ code: "unsafe_archive" });
    server.archive = await buildPack({ files: [["meg-titulo/1.0.0/media/b.mp4", big]] });
    await expect(installPack(api, lib, pack(), KEY, { maxUncompressedBytes: 1_000_000 })).rejects.toThrow(/limite/);
  });

  it("recusa pacote revogado sem baixar", async () => {
    await expect(installPack(api, lib, { ...pack(), status: "revoked" }, KEY)).rejects.toMatchObject({ code: "revoked" });
  });
});

describe("biblioteca", () => {
  it("atualiza mantendo a anterior para rollback; remover não apaga arquivos", async () => {
    server.archive = await buildPack();
    await installPack(api, lib, pack(), KEY);
    server.archive = await buildPack({ version: "1.1.0" });
    await installPack(api, lib, pack("1.1.0"), KEY);
    expect(lib.snapshot.packs.piloto).toMatchObject({ current: "1.1.0", previous: "1.0.0" });
    expect(await lib.rollback("piloto")).toBe("1.0.0");
    expect(lib.installed("piloto")).toBe("1.0.0");
    await lib.uninstall("piloto");
    expect(lib.installed("piloto")).toBeNull();
    expect(existsSync(join(dir, "packs", "piloto", "1.0.0"))).toBe(true);
  });

  it("índice sobrevive a reabrir a aplicação e marca revogados", async () => {
    server.archive = await buildPack();
    await installPack(api, lib, pack(), KEY);
    const again = new Library(dir);
    await again.load();
    expect(again.installed("piloto")).toBe("1.0.0");
    expect(await again.markRevoked([{ slug: "piloto", version: "1.0.0" }])).toEqual(["piloto"]);
    expect(again.snapshot.packs.piloto!.revoked).toBe(true);
  });

  it("chave pública confere com a privada usada (sanidade do teste)", () => {
    expect(createPublicKey(privateKey).export({ type: "spki", format: "pem" })).toBe(KEY.publicKeyPem);
  });
});
