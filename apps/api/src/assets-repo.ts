import { normalizeText, type AssetDTO, type AssetFileDTO, type AssetVersionDTO, type FileRole, type HostTarget, type Parameter, type PresetManifest } from "@motionhub/shared";
import type { Queryable } from "./db.js";
import type { AppContext } from "./context.js";
import { signUrlParams } from "./crypto.js";
import { iso } from "./util.js";

export interface AssetRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  type: AssetDTO["type"];
  summary: string | null;
  tags: string[];
  synonyms: string[];
  category: string | null;
  client: string | null;
  aspect_ratio: AssetDTO["aspectRatio"];
  language: string | null;
  hosts: AssetDTO["hosts"];
  rights: string;
  creator_id: string;
  state: AssetDTO["state"];
  current_version_id: string | null;
  updated_at: Date;
  // colunas agregadas
  latest_semver?: string | null;
  poster_key?: string | null;
  preview_key?: string | null;
  duration_sec?: number | null;
}

export interface VersionRow {
  id: string;
  asset_id: string;
  semver: string;
  host_targets: HostTarget[];
  manifest: PresetManifest;
  manifest_schema: string;
  status: AssetVersionDTO["status"];
  changelog: string | null;
  release_date: Date | null;
  created_at: Date;
}

export interface FileRow {
  id: string;
  version_id: string;
  role: FileRole;
  path: string;
  mime: string;
  bytes: string; // bigint
  sha256: string;
  storage_key: string;
  generated: boolean;
}

/** SELECT base de assets com versão corrente, poster e preview. */
export const ASSET_SELECT = `
  SELECT a.*, v.semver AS latest_semver, (v.manifest->>'durationSec')::float AS duration_sec,
    (SELECT storage_key FROM asset_files f WHERE f.version_id = v.id AND f.role = 'poster' ORDER BY f.generated DESC LIMIT 1) AS poster_key,
    (SELECT storage_key FROM asset_files f WHERE f.version_id = v.id AND f.role = 'preview' ORDER BY f.generated DESC LIMIT 1) AS preview_key
  FROM assets a LEFT JOIN asset_versions v ON v.id = a.current_version_id`;

export function signedFileUrl(ctx: AppContext, key: string, ttlSec: number): { url: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signUrlParams(key, expiresAt, ctx.config.jwtSecret);
  return { url: `${ctx.config.publicUrl}/v1/files/${key}?exp=${expiresAt}&sig=${sig}`, expiresAt };
}

/** Miniaturas e previews têm URL assinada com validade maior, para cache no painel. */
const MEDIA_URL_TTL = 6 * 3600;

export function toAssetDTO(ctx: AppContext, a: AssetRow): AssetDTO {
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    type: a.type,
    summary: a.summary,
    tags: a.tags,
    synonyms: a.synonyms,
    category: a.category,
    client: a.client,
    aspectRatio: a.aspect_ratio,
    language: a.language,
    hosts: a.hosts,
    rights: a.rights,
    creatorId: a.creator_id,
    state: a.state,
    latestVersion: a.latest_semver ?? null,
    posterUrl: a.poster_key ? signedFileUrl(ctx, a.poster_key, MEDIA_URL_TTL).url : null,
    previewUrl: a.preview_key ? signedFileUrl(ctx, a.preview_key, MEDIA_URL_TTL).url : null,
    durationSec: a.duration_sec ?? null,
    updatedAt: a.updated_at.toISOString(),
  };
}

export const toFileDTO = (f: FileRow): AssetFileDTO => ({
  id: f.id,
  role: f.role,
  path: f.path,
  mime: f.mime,
  bytes: Number(f.bytes),
  sha256: f.sha256,
});

export function toVersionDTO(v: VersionRow, files: FileRow[]): AssetVersionDTO {
  return {
    id: v.id,
    assetId: v.asset_id,
    semver: v.semver,
    hostTargets: v.host_targets,
    manifestSchema: v.manifest_schema,
    status: v.status,
    releaseDate: iso(v.release_date),
    changelog: v.changelog,
    parameters: v.manifest.parameters as Parameter[],
    files: files.filter((f) => f.version_id === v.id).map(toFileDTO),
  };
}

export async function loadVersions(q: Queryable, assetId: string): Promise<AssetVersionDTO[]> {
  const versions = (await q.query<VersionRow>("SELECT * FROM asset_versions WHERE asset_id = $1 ORDER BY created_at DESC", [assetId])).rows;
  if (!versions.length) return [];
  const files = (await q.query<FileRow>("SELECT * FROM asset_files WHERE version_id = ANY($1) ORDER BY path", [versions.map((v) => v.id)])).rows;
  return versions.map((v) => toVersionDTO(v, files));
}

export function buildSearchText(m: { name: string; tags: string[]; synonyms: string[]; summary?: string | null; client?: string | null; category?: string | null; slug: string }): string {
  return normalizeText([m.name, m.slug, ...m.tags, ...m.synonyms, m.summary ?? "", m.client ?? "", m.category ?? ""].join(" "));
}
