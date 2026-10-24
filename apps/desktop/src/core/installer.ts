/**
 * Instalação de pacotes .mlpack (Especificação §4.3, §7.3, §9, M10):
 * manifest → download com retomada → SHA-256 do arquivo → assinatura Ed25519 →
 * inspeção do ZIP (path traversal, zip bomb, symlinks, arquivos extras) →
 * extração com hash por arquivo → troca atômica → índice.
 * Uma instalação interrompida nunca altera a versão já instalada.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import yauzl from "yauzl";
import { isSafeRelativePath } from "@motionhub/shared";
import type { DesktopApi } from "./api.js";
import type { Library } from "./library.js";
import { InstallError, type InstallProgress, type InstalledPackVersion, type MlpackManifest, type PackSummary } from "./types.js";

export interface TrustedKey {
  keyId: string;
  publicKeyPem: string;
}

export interface InstallOptions {
  onProgress?: (p: InstallProgress) => void;
  signal?: AbortSignal;
  /** Limite de segurança para o tamanho descompactado total (padrão 20 GB). */
  maxUncompressedBytes?: number;
}

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

export async function installPack(api: DesktopApi, lib: Library, pack: PackSummary, key: TrustedKey, opts: InstallOptions = {}): Promise<InstalledPackVersion> {
  const progress = (stage: InstallProgress["stage"], done = 0, total = 1) => opts.onProgress?.({ slug: pack.slug, stage, done, total });
  if (pack.status === "revoked") throw new InstallError("revoked", "Este pacote foi revogado pelo administrador.");

  progress("manifest");
  const meta = await api.request<{ archive: { sha256: string; bytes: number }; keyId?: string }>("GET", `/v1/packs/${pack.id}/manifest`);
  if (meta.keyId && meta.keyId !== key.keyId) {
    throw new InstallError("untrusted_key", "O pacote foi assinado com uma chave diferente da confiável. Contate o administrador.");
  }

  await mkdir(lib.stagingDir, { recursive: true });
  const archive = join(lib.stagingDir, `${pack.slug}-${pack.version}.mlpack`);
  await downloadWithResume(api, pack, archive, meta.archive, opts, (d, t) => progress("download", d, t));

  progress("verify");
  const got = await sha256File(archive);
  if (got !== meta.archive.sha256) {
    await rm(archive, { force: true });
    throw new InstallError("hash_mismatch", "O arquivo baixado não confere com o hash publicado. Download descartado.");
  }

  const zip = await openZip(archive);
  const target = join(lib.packsDir, pack.slug, pack.version);
  const staging = join(lib.stagingDir, `${pack.slug}-${pack.version}.extract`);
  try {
    const { manifest, entries } = await inspect(zip, key, opts.maxUncompressedBytes ?? 20 * 1024 ** 3);
    if (manifest.slug !== pack.slug || manifest.version !== pack.version) {
      throw new InstallError("unsafe_archive", "O conteúdo do pacote não corresponde ao pacote solicitado.");
    }

    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    let i = 0;
    for (const [name, { entry, expect }] of entries) {
      if (opts.signal?.aborted) throw new InstallError("cancelled", "Instalação cancelada.");
      progress("extract", i++, entries.size);
      await extractVerified(zip, entry, join(staging, name), staging, expect);
    }
    progress("extract", entries.size, entries.size);

    // Troca atômica: a pasta só aparece no destino completa e verificada.
    progress("activate");
    await mkdir(dirname(target), { recursive: true });
    const old = `${target}.old-${Date.now()}`;
    const exists = await stat(target).then(() => true, () => false);
    if (exists) await rename(target, old);
    await rename(staging, target);
    if (exists) await rm(old, { recursive: true, force: true });

    const installed: InstalledPackVersion = {
      packId: pack.id,
      version: pack.version,
      name: manifest.name,
      installedAt: new Date().toISOString(),
      dir: target,
      assets: manifest.assets.map((a) => ({
        assetId: a.assetId,
        slug: a.slug,
        version: a.version,
        type: a.manifest.type,
        name: a.manifest.name,
        files: a.files.map((f) => ({ path: f.path, role: f.role, sha256: f.sha256, absPath: join(target, ...f.path.split("/")) })),
      })),
    };
    await lib.activate(pack.slug, installed);
    progress("done");
    return installed;
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    if ((e as NodeJS.ErrnoException).code === "ENOSPC") throw new InstallError("disk_full", "Disco cheio. Libere espaço ou mude a pasta da biblioteca.");
    throw e;
  } finally {
    zip.close();
    await rm(archive, { force: true }).catch(() => {});
  }
}

async function downloadWithResume(
  api: DesktopApi,
  pack: PackSummary,
  file: string,
  expected: { bytes: number },
  opts: InstallOptions,
  onBytes: (done: number, total: number) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const have = await stat(file).then((s) => s.size, () => 0);
    if (have === expected.bytes) return;
    if (have > expected.bytes) await rm(file, { force: true });
    const ticket = await api.request<{ url: string }>("POST", `/v1/packs/${pack.id}/download-ticket`);
    const from = have > expected.bytes ? 0 : have;
    let res: Response;
    try {
      res = await api.fetchFile(ticket.url, from, opts.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new InstallError("cancelled", "Instalação cancelada.");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok || !res.body) throw new InstallError("download_failed", `Falha no download (HTTP ${res.status}).`);
    const append = res.status === 206 && from > 0;
    let done = append ? from : 0;
    const meter = new Transform({
      transform(chunk: Buffer, _e, cb) {
        done += chunk.length;
        if (done > expected.bytes) return cb(new InstallError("download_failed", "Servidor enviou mais bytes que o esperado."));
        onBytes(done, expected.bytes);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(file, { flags: append ? "a" : "w" }), { signal: opts.signal });
    } catch (e) {
      if (e instanceof InstallError) throw e;
      if ((e as Error).name === "AbortError") throw new InstallError("cancelled", "Instalação cancelada.");
      if ((e as NodeJS.ErrnoException).code === "ENOSPC") throw new InstallError("disk_full", "Disco cheio.");
      await sleep(1000 * 2 ** attempt); // rede caiu: tenta retomar do ponto em que parou
    }
  }
  const final = await stat(file).then((s) => s.size, () => 0);
  if (final !== expected.bytes) throw new InstallError("download_failed", "Não foi possível concluir o download após várias tentativas.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const c of createReadStream(path)) h.update(c as Buffer);
  return h.digest("hex");
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (err, z) => (err ? rej(new InstallError("unsafe_archive", `Arquivo ZIP inválido: ${err.message}`)) : res(z!))),
  );
}

function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((res, rej) => {
    const out: yauzl.Entry[] = [];
    zip.on("entry", (e: yauzl.Entry) => {
      out.push(e);
      zip.readEntry();
    });
    zip.once("end", () => res(out));
    zip.once("error", (e) => rej(new InstallError("unsafe_archive", `ZIP corrompido: ${e.message}`)));
    zip.readEntry();
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, max: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    if (entry.uncompressedSize > max) return rej(new InstallError("unsafe_archive", `${entry.fileName} grande demais.`));
    zip.openReadStream(entry, async (err, s) => {
      if (err) return rej(err);
      const chunks: Buffer[] = [];
      let n = 0;
      try {
        for await (const c of s!) {
          n += (c as Buffer).length;
          if (n > max) throw new InstallError("unsafe_archive", `${entry.fileName} grande demais.`);
          chunks.push(c as Buffer);
        }
        res(Buffer.concat(chunks));
      } catch (e) {
        rej(e);
      }
    });
  });
}

interface Expected {
  sha256: string;
  bytes: number;
}

/**
 * Valida o ZIP inteiro ANTES de extrair qualquer byte:
 * assinatura do manifest, nomes seguros, sem symlinks, sem duplicatas, sem arquivos fora do manifest,
 * tamanhos declarados batendo com o manifest e total abaixo do limite (zip bomb).
 */
export async function inspect(zip: yauzl.ZipFile, key: TrustedKey, maxTotal: number): Promise<{ manifest: MlpackManifest; entries: Map<string, { entry: yauzl.Entry; expect: Expected }> }> {
  const all = await listEntries(zip);
  const byName = new Map<string, yauzl.Entry>();
  for (const e of all) {
    if (e.fileName.endsWith("/")) continue; // diretório
    if (!isSafeRelativePath(e.fileName)) throw new InstallError("unsafe_archive", `Caminho inseguro no pacote: ${e.fileName}`);
    const mode = (e.externalFileAttributes >>> 16) & 0o170000;
    if (mode === 0o120000) throw new InstallError("unsafe_archive", `Link simbólico não permitido: ${e.fileName}`);
    if (byName.has(e.fileName.toLowerCase())) throw new InstallError("unsafe_archive", `Arquivo duplicado: ${e.fileName}`);
    byName.set(e.fileName.toLowerCase(), e);
  }
  const mEntry = byName.get("manifest.json");
  const sEntry = byName.get("signature.json");
  if (!mEntry || !sEntry) throw new InstallError("signature_invalid", "Pacote sem manifest ou assinatura.");
  const manifestRaw = await readEntry(zip, mEntry, MAX_MANIFEST_BYTES);
  const sig = JSON.parse((await readEntry(zip, sEntry, 64 * 1024)).toString("utf8")) as { algorithm: string; keyId: string; signature: string };
  if (sig.algorithm !== "ed25519" || sig.keyId !== key.keyId) throw new InstallError("untrusted_key", "Assinatura feita com chave não confiável.");
  const ok = verify(null, manifestRaw, createPublicKey(key.publicKeyPem), Buffer.from(sig.signature, "base64"));
  if (!ok) throw new InstallError("signature_invalid", "Assinatura do pacote inválida: o conteúdo foi alterado.");

  const manifest = JSON.parse(manifestRaw.toString("utf8")) as MlpackManifest;
  if (manifest.format !== "mlpack/1") throw new InstallError("unsafe_archive", "Formato de pacote não suportado.");

  const entries = new Map<string, { entry: yauzl.Entry; expect: Expected }>();
  let total = 0;
  for (const a of manifest.assets) {
    for (const f of a.files) {
      if (!isSafeRelativePath(f.path)) throw new InstallError("unsafe_archive", `Caminho inseguro no manifest: ${f.path}`);
      const e = byName.get(f.path.toLowerCase());
      if (!e) throw new InstallError("unsafe_archive", `Arquivo ausente no pacote: ${f.path}`);
      if (e.uncompressedSize !== f.bytes) throw new InstallError("unsafe_archive", `Tamanho divergente: ${f.path}`);
      total += f.bytes;
      entries.set(f.path, { entry: e, expect: { sha256: f.sha256, bytes: f.bytes } });
    }
  }
  if (total > maxTotal) throw new InstallError("unsafe_archive", "Pacote excede o limite de tamanho descompactado.");
  const extra = [...byName.keys()].filter((n) => n !== "manifest.json" && n !== "signature.json" && ![...entries.keys()].some((k) => k.toLowerCase() === n));
  if (extra.length) throw new InstallError("unsafe_archive", `Arquivos não declarados no pacote: ${extra.slice(0, 3).join(", ")}`);
  return { manifest, entries };
}

/** Extrai um arquivo limitando bytes ao declarado e conferindo SHA-256 antes de aceitar. */
function extractVerified(zip: yauzl.ZipFile, entry: yauzl.Entry, dest: string, root: string, expect: Expected): Promise<void> {
  return new Promise((res, rej) => {
    const abs = resolve(dest);
    if (!abs.startsWith(resolve(root) + sep)) return rej(new InstallError("unsafe_archive", "Destino fora da pasta do pacote."));
    zip.openReadStream(entry, async (err, stream) => {
      if (err) return rej(new InstallError("unsafe_archive", err.message));
      const h = createHash("sha256");
      let n = 0;
      const guard = new Transform({
        transform(c: Buffer, _e, cb) {
          n += c.length;
          if (n > expect.bytes) return cb(new InstallError("unsafe_archive", `${entry.fileName} maior que o declarado.`));
          h.update(c);
          cb(null, c);
        },
      });
      try {
        await mkdir(dirname(abs), { recursive: true });
        await pipeline(stream!, guard, createWriteStream(abs, { flags: "wx" }));
        if (n !== expect.bytes || h.digest("hex") !== expect.sha256) throw new InstallError("hash_mismatch", `Integridade inválida: ${entry.fileName}`);
        res();
      } catch (e) {
        rej(e);
      }
    });
  });
}
