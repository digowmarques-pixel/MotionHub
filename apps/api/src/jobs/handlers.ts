import { mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import yazl from "yazl";
import type { PresetManifest } from "@motionhub/shared";
import type { AppContext } from "../context.js";
import { audit } from "../context.js";
import { canonicalJson, sha256Hex } from "../crypto.js";
import type { FileRow, VersionRow } from "../assets-repo.js";
import { probe, run } from "./ffmpeg.js";
import { progress, type JobRow } from "./queue.js";

export class PermanentJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PREVIEW_MAX_SEC = 10;
const PREVIEW_MAX_WIDTH = 640;

/**
 * Gera preview padronizado (MP4 H.264 ≤10 s, ≤640 px, faststart) e poster WebP (§7.2).
 * Para SFX/áudio: preview MP3 e poster com forma de onda.
 */
export async function previewJob(ctx: AppContext, job: JobRow): Promise<Record<string, unknown>> {
  const versionId = String(job.input.versionId);
  const v = (await ctx.db.query<VersionRow>("SELECT * FROM asset_versions WHERE id = $1", [versionId])).rows[0];
  if (!v) throw new PermanentJobError("not_found", "versão não existe");
  const files = (await ctx.db.query<FileRow>("SELECT * FROM asset_files WHERE version_id = $1 AND NOT generated", [versionId])).rows;
  const src = files.find((f) => f.path === v.manifest.preview.path);
  const posterSrc = files.find((f) => f.path === v.manifest.preview.poster);
  if (!src || !posterSrc) throw new PermanentJobError("missing_source", "arquivos de preview/poster ausentes");
  const srcPath = ctx.storage.localPath(src.storage_key);
  const posterPath = ctx.storage.localPath(posterSrc.storage_key);
  if (!srcPath || !posterPath) throw new PermanentJobError("unsupported_storage", "driver de storage sem caminho local");

  const dir = await mkdtemp(join(tmpdir(), "mh-preview-"));
  try {
    const info = await probe(srcPath).catch((e) => {
      throw new PermanentJobError("corrupt_media", `mídia de preview ilegível: ${(e as Error).message}`);
    });
    await progress(ctx.db, job.id, 0.2);
    const scale = `scale='min(${PREVIEW_MAX_WIDTH},iw)':-2`;
    let previewOut: string;
    let previewMime: string;
    if (info.hasVideo) {
      previewOut = join(dir, "preview.mp4");
      previewMime = "video/mp4";
      await run("ffmpeg", [
        "-nostdin", "-y", "-i", srcPath, "-t", String(PREVIEW_MAX_SEC),
        "-vf", `${scale},fps=30`, "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "26",
        ...(info.hasAudio ? ["-c:a", "aac", "-b:a", "96k"] : ["-an"]),
        "-movflags", "+faststart", previewOut,
      ]);
    } else if (info.hasAudio) {
      previewOut = join(dir, "preview.mp3");
      previewMime = "audio/mpeg";
      await run("ffmpeg", ["-nostdin", "-y", "-i", srcPath, "-t", String(PREVIEW_MAX_SEC), "-vn", "-c:a", "libmp3lame", "-b:a", "128k", previewOut]);
    } else {
      throw new PermanentJobError("corrupt_media", "arquivo de preview sem vídeo nem áudio");
    }
    await progress(ctx.db, job.id, 0.7);

    const posterOut = join(dir, "poster.webp");
    const posterInfo = await probe(posterPath).catch(() => null);
    if (posterInfo && (posterInfo.hasVideo || posterInfo.width)) {
      await run("ffmpeg", ["-nostdin", "-y", "-i", posterPath, "-frames:v", "1", "-vf", scale, "-c:v", "libwebp", "-quality", "80", posterOut]);
    } else if (posterInfo?.hasAudio) {
      await run("ffmpeg", ["-nostdin", "-y", "-i", posterPath, "-filter_complex", "showwavespic=s=640x180:colors=0x7aa2f7", "-frames:v", "1", "-c:v", "libwebp", posterOut]);
    } else {
      throw new PermanentJobError("corrupt_media", "poster ilegível");
    }

    const stored = [];
    for (const [role, file, mime] of [["preview", previewOut, previewMime], ["poster", posterOut, "image/webp"]] as const) {
      const name = file.slice(dir.length + 1);
      const key = `assets/${v.asset_id}/${v.id}/_generated/${name}`;
      const put = await ctx.storage.put(key, createReadStream(file));
      await ctx.db.query(
        `INSERT INTO asset_files (version_id, role, path, mime, bytes, sha256, storage_key, generated) VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (version_id, path) DO UPDATE SET bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256, storage_key = EXCLUDED.storage_key, mime = EXCLUDED.mime`,
        [v.id, role, `_generated/${name}`, mime, put.bytes, put.sha256, key],
      );
      stored.push({ role, bytes: put.bytes });
    }
    return { source: info, stored };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface MlpackManifest {
  format: "mlpack/1";
  slug: string;
  name: string;
  version: string;
  license: string;
  createdAt: string;
  hosts: Array<{ name: string; minVersion: string }>;
  assets: Array<{
    assetId: string;
    slug: string;
    version: string;
    manifest: PresetManifest;
    files: Array<{ path: string; sha256: string; bytes: number; role: string }>;
  }>;
}

/**
 * Gera o arquivo .mlpack (ZIP) com manifest.json assinado (Ed25519) e os arquivos dos assets
 * em <slug>/<versão>/<caminho>. O gerenciador verifica assinatura e hashes antes de instalar.
 */
export async function packBuildJob(ctx: AppContext, job: JobRow): Promise<Record<string, unknown>> {
  if (!ctx.signer) throw new PermanentJobError("no_signer", "chave de assinatura não configurada");
  const packId = String(job.input.packId);
  const pack = (await ctx.db.query("SELECT * FROM packs WHERE id = $1", [packId])).rows[0];
  if (!pack) throw new PermanentJobError("not_found", "pacote não existe");
  const versions = (
    await ctx.db.query<VersionRow & { slug: string }>(
      `SELECT v.*, a.slug FROM pack_items pi JOIN asset_versions v ON v.id = pi.version_id JOIN assets a ON a.id = v.asset_id WHERE pi.pack_id = $1 ORDER BY a.slug`,
      [packId],
    )
  ).rows;
  const files = (await ctx.db.query<FileRow>("SELECT * FROM asset_files WHERE version_id = ANY($1) ORDER BY path", [versions.map((v) => v.id)])).rows;

  const hosts = new Map<string, string>();
  for (const v of versions) for (const h of v.host_targets) {
    const cur = hosts.get(h.name);
    if (!cur || cur.localeCompare(h.minVersion, undefined, { numeric: true }) < 0) hosts.set(h.name, h.minVersion);
  }

  const manifest: MlpackManifest = {
    format: "mlpack/1",
    slug: pack.slug,
    name: pack.name,
    version: pack.version,
    license: pack.license,
    createdAt: new Date().toISOString(),
    hosts: [...hosts].map(([name, minVersion]) => ({ name, minVersion })),
    assets: versions.map((v) => ({
      assetId: v.asset_id,
      slug: v.slug,
      version: v.semver,
      manifest: v.manifest,
      files: files
        .filter((f) => f.version_id === v.id)
        .map((f) => ({ path: `${v.slug}/${v.semver}/${f.path}`, sha256: f.sha256, bytes: Number(f.bytes), role: f.role })),
    })),
  };
  const canonical = canonicalJson(manifest);
  const signature = ctx.signer.sign(Buffer.from(canonical));

  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(canonical), "manifest.json");
  zip.addBuffer(Buffer.from(JSON.stringify({ algorithm: "ed25519", keyId: ctx.signer.keyId, signature })), "signature.json");
  let i = 0;
  for (const v of versions) {
    for (const f of files.filter((x) => x.version_id === v.id)) {
      const p = ctx.storage.localPath(f.storage_key);
      if (!p) throw new PermanentJobError("unsupported_storage", "driver de storage sem caminho local");
      const st = await stat(p);
      // Mídia já comprimida: armazenar sem recompressão.
      zip.addReadStream(createReadStream(p), `${v.slug}/${v.semver}/${f.path}`, { compress: false, size: st.size });
      await progress(ctx.db, job.id, (++i / files.length) * 0.8);
    }
  }
  zip.end();
  const key = `packs/${pack.org_id}/${pack.slug}-${pack.version}.mlpack`;
  const put = await ctx.storage.put(key, Readable.from(zip.outputStream));
  await ctx.db.query(
    `UPDATE packs SET signed_manifest = $2, signature = $3, archive_key = $4, archive_sha256 = $5, archive_bytes = $6, status = 'ready',
       requirements = $7 WHERE id = $1`,
    [packId, canonical, signature, key, put.sha256, put.bytes, JSON.stringify({ hosts: manifest.hosts })],
  );
  await audit(ctx.db, { orgId: pack.org_id, actorId: null, action: "pack.ready", targetType: "pack", targetId: packId, data: { sha256: put.sha256, bytes: put.bytes, manifestSha256: sha256Hex(canonical) } });
  return { key, bytes: put.bytes, sha256: put.sha256 };
}
