/**
 * Cache local de assets baixados, com verificação SHA-256 antes de ativar (§4.3, §10 Integridade).
 * Versões antigas permanecem no disco para não quebrar projetos que as usam.
 */
import { ApplyError, sha256Hex, type FileRole } from "@motionhub/shared";
import type { Platform } from "../platform/types.js";
import { OfflineError, type ApiClient } from "./api-client.js";
import type { CatalogItem } from "./catalog.js";

interface InstalledFile {
  path: string;
  role: FileRole;
  sha256: string;
  local: string;
}

type InstalledIndex = Record<string, Record<string, InstalledFile[]>>; // assetId → versão → arquivos

const INDEX = "installed.json";
/** Papéis necessários para inserir; previews ficam em cache HTTP. */
const NEEDED: ReadonlySet<FileRole> = new Set(["template", "media", "audio", "font", "subtitle"]);

export class AssetCache {
  private index: InstalledIndex = {};

  constructor(
    private readonly platform: Platform,
    private readonly api: ApiClient,
  ) {}

  async load(): Promise<void> {
    const t = await this.platform.readText(INDEX);
    this.index = t ? (JSON.parse(t) as InstalledIndex) : {};
  }

  isInstalled(assetId: string, version: string): boolean {
    return !!this.index[assetId]?.[version];
  }

  /** Retorna os arquivos locais da versão, baixando e verificando se necessário. */
  async ensure(item: CatalogItem, version: string, onProgress?: (done: number, total: number) => void): Promise<InstalledFile[]> {
    const cached = this.index[item.id]?.[version];
    if (cached) {
      const alive = await Promise.all(cached.map((f) => this.platform.nativePath(this.localPath(item, version, f.path))));
      if (alive.every(Boolean)) return cached.map((f, i) => ({ ...f, local: alive[i]! }));
    }

    let ticket: { files: Array<{ path: string; role: FileRole; url: string; sha256: string; bytes: number }> };
    try {
      ticket = await this.api.request("POST", `/v1/assets/${item.id}/versions/${encodeURIComponent(version)}/download-ticket`);
    } catch (e) {
      if (e instanceof OfflineError) throw new ApplyError("missing_dependency", "Asset não baixado e sem conexão. Conecte-se para baixar.");
      throw e;
    }
    const files = ticket.files.filter((f) => NEEDED.has(f.role));
    if (!files.length) throw new ApplyError("invalid_package", "Versão sem arquivo aplicável.");
    const out: InstalledFile[] = [];
    let i = 0;
    for (const f of files) {
      onProgress?.(i++, files.length);
      const data = await this.api.download(f.url).catch((e) => {
        throw e instanceof OfflineError ? new ApplyError("missing_dependency", "Conexão perdida durante o download.") : e;
      });
      const got = sha256Hex(data);
      if (got !== f.sha256 || data.length !== f.bytes) {
        throw new ApplyError("invalid_package", `Integridade inválida em ${f.path}: o arquivo foi recusado.`);
      }
      const local = await this.platform.writeBinary(this.localPath(item, version, f.path), data);
      out.push({ path: f.path, role: f.role, sha256: f.sha256, local });
    }
    onProgress?.(files.length, files.length);
    // Só registra como instalada depois que todos os arquivos foram verificados.
    (this.index[item.id] ??= {})[version] = out;
    await this.platform.writeText(INDEX, JSON.stringify(this.index));
    return out;
  }

  private localPath(item: CatalogItem, version: string, path: string): string {
    return `assets/${item.slug}/${version}/${path}`;
  }
}
