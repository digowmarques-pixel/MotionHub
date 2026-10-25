/**
 * Fontes do catálogo: servidor Motion Hub (API) ou biblioteca em pasta (NAS, sem servidor).
 */
import { parseFolderItem, roleForFile, slugify, type FileRole, type PresetManifest } from "@motionhub/shared";
import type { FolderLibrary, Platform } from "../platform/types.js";
import type { ApiClient } from "./api-client.js";
import type { CatalogItem } from "./catalog.js";

export interface FetchResult {
  serverTime: string | null;
  items: CatalogItem[];
  /** true: a lista é completa (substitui o catálogo); false: incremental. */
  full: boolean;
}

export interface CatalogSource {
  readonly kind: "server" | "folder";
  /** Nome do arquivo de cache local, separado por fonte para não misturar catálogos. */
  readonly cacheFile: string;
  fetch(since: string | null): Promise<FetchResult>;
  /** Favoritos sincronizados com o servidor; ausente = só locais. */
  readonly remoteFavourites?: {
    list(): Promise<string[]>;
    set(id: string, on: boolean): Promise<void>;
  };
}

export class ServerSource implements CatalogSource {
  readonly kind = "server";
  readonly cacheFile = "catalog.json";
  constructor(private readonly api: ApiClient) {}

  async fetch(since: string | null): Promise<FetchResult> {
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    const r = await this.api.request<{ serverTime: string; items: CatalogItem[] }>("GET", `/v1/catalog${q}`);
    return { serverTime: r.serverTime, items: r.items, full: false };
  }

  readonly remoteFavourites = {
    list: async () => (await this.api.request<Array<{ assetId: string }>>("GET", "/v1/favourites")).map((f) => f.assetId),
    set: async (id: string, on: boolean) => {
      await this.api.request(on ? "PUT" : "DELETE", `/v1/favourites/${id}`);
    },
  };
}

export class FolderUnavailableError extends Error {
  constructor(detail: string) {
    super(`Biblioteca na rede indisponível (${detail}). Verifique se o NAS está ligado e acessível.`);
  }
}

export interface FolderProblem {
  dir: string;
  message: string;
}

/** Item vindo da pasta: arquivos ficam no NAS e são inseridos de lá, sem download. */
export interface LocalFile {
  path: string;
  role: FileRole;
  local: string;
}

const SCAN_DEPTH = 3;

export class FolderSource implements CatalogSource {
  readonly kind = "folder";
  readonly cacheFile = "catalog-folder.json";
  problems: FolderProblem[] = [];
  displayPath: string | null = null;

  constructor(private readonly platform: Platform) {}

  async library(): Promise<FolderLibrary> {
    let lib: FolderLibrary | null;
    try {
      lib = await this.platform.folderLibrary();
    } catch (e) {
      throw new FolderUnavailableError((e as Error).message);
    }
    if (!lib) throw new FolderUnavailableError("nenhuma pasta conectada");
    this.displayPath = lib.displayPath;
    return lib;
  }

  async fetch(): Promise<FetchResult> {
    const lib = await this.library();
    let dirs: Array<{ dir: string; files: string[] }>;
    try {
      dirs = await lib.scan(SCAN_DEPTH);
    } catch (e) {
      throw new FolderUnavailableError((e as Error).message);
    }
    const problems: FolderProblem[] = [];
    const items: CatalogItem[] = [];
    const seen = new Set<string>();
    for (const { dir, files } of dirs) {
      if (!files.includes("item.json")) continue;
      const raw = await lib.readText(`${dir}/item.json`);
      const parsed = raw ? parseFolderItem(raw) : { ok: false as const, error: "item.json ilegível" };
      if (!parsed.ok) {
        problems.push({ dir, message: parsed.error });
        continue;
      }
      const it = parsed.item;
      if (!files.includes(it.main)) {
        problems.push({ dir, message: `arquivo principal "${it.main}" não está na pasta` });
        continue;
      }
      const id = it.id ?? slugify(dir.split("/").pop()!);
      if (seen.has(id)) {
        problems.push({ dir, message: `id "${id}" repetido em outra pasta` });
        continue;
      }
      seen.add(id);
      const role = (it.role ?? roleForFile(it.main)) as FileRole;
      const thumbFile = [it.thumb, it.poster].find((f) => f && files.includes(f));
      const posterUrl = thumbFile ? await this.platform.cacheMedia(`${id}@${it.version}-${thumbFile}`, () => lib.readBinary(`${dir}/${thumbFile}`)).catch(() => null) : null;
      const top = dir.includes("/") ? dir.split("/")[0]! : null;
      const manifest: PresetManifest = {
        schemaVersion: "1.0",
        id,
        version: it.version,
        name: it.name,
        type: it.type,
        summary: it.summary,
        hosts: [{ name: "premiere", minVersion: "25.6" }],
        assets: [{ path: it.main, sha256: "", role }],
        preview: { path: it.preview ?? it.main, poster: it.poster ?? it.main },
        parameters: it.parameters,
        aspectRatio: it.aspectRatio,
        durationSec: it.durationSec,
        fps: it.fps,
        license: it.license,
        tags: it.tags,
        synonyms: it.synonyms,
        dependencies: [],
      };
      items.push({
        id,
        slug: id,
        name: it.name,
        type: it.type,
        summary: it.summary ?? null,
        tags: it.tags,
        synonyms: it.synonyms,
        category: top,
        client: it.client ?? null,
        aspectRatio: it.aspectRatio,
        language: it.language ?? null,
        hosts: ["premiere"],
        rights: it.license,
        creatorId: "",
        state: it.state,
        latestVersion: it.version,
        currentVersionId: null,
        posterUrl,
        previewUrl: null,
        durationSec: it.durationSec ?? null,
        updatedAt: it.addedAt ?? new Date(0).toISOString(),
        manifest,
        local: [{ path: it.main, role, local: lib.nativePath(`${dir}/${it.main}`) }],
        folder: { dir, preview: it.preview && files.includes(it.preview) ? it.preview : null },
      });
    }
    this.problems = problems;
    return { serverTime: null, items, full: true };
  }

  /** Preview em vídeo/áudio: copiado sob demanda para o cache do plugin (o UXP não lê mídia direto do NAS). */
  async previewUrl(item: CatalogItem): Promise<string | null> {
    if (!item.folder?.preview) return null;
    const lib = await this.library();
    const rel = `${item.folder.dir}/${item.folder.preview}`;
    return this.platform.cacheMedia(`${item.id}@${item.latestVersion}-preview-${item.folder.preview}`, () => lib.readBinary(rel));
  }
}
