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

/** Subconjunto do index.json escrito pelo Gerenciador desktop. */
interface ManagerIndex {
  schema: 1;
  packs: Record<string, { current: string; revoked?: boolean; versions: Record<string, { assets: Array<{ assetId: string; version: string; files: Array<{ path: string; role: FileRole; sha256: string; absPath: string }> }> }> }>;
}

export class AssetCache {
  private index: InstalledIndex = {};
  /** assetId → versão → arquivos instalados pelo Gerenciador. */
  private library = new Map<string, Map<string, InstalledFile[]>>();
  libraryConnected = false;

  constructor(
    private readonly platform: Platform,
    private readonly api: ApiClient,
  ) {}

  async load(): Promise<void> {
    const t = await this.platform.readText(INDEX);
    this.index = t ? (JSON.parse(t) as InstalledIndex) : {};
    await this.loadLibrary();
  }

  /** Lê a biblioteca do Gerenciador. Pacotes revogados não são usados. */
  async loadLibrary(): Promise<void> {
    this.library.clear();
    const raw = await this.platform.readLibraryIndex().catch(() => null);
    this.libraryConnected = raw !== null;
    if (!raw) return;
    try {
      const idx = JSON.parse(raw) as ManagerIndex;
      for (const pack of Object.values(idx.packs ?? {})) {
        if (pack.revoked) continue;
        for (const a of pack.versions[pack.current]?.assets ?? []) {
          const byVer = this.library.get(a.assetId) ?? new Map<string, InstalledFile[]>();
          byVer.set(a.version, a.files.filter((f) => NEEDED.has(f.role)).map((f) => ({ path: f.path.split("/").slice(2).join("/"), role: f.role, sha256: f.sha256, local: f.absPath })));
          this.library.set(a.assetId, byVer);
        }
      }
    } catch {
      this.libraryConnected = false;
    }
  }

  isInstalled(assetId: string, version: string): boolean {
    return !!this.index[assetId]?.[version] || !!this.library.get(assetId)?.get(version)?.length;
  }

  fromLibrary(assetId: string, version: string): boolean {
    return !!this.library.get(assetId)?.get(version)?.length;
  }

  /** Retorna os arquivos locais da versão, baixando e verificando se necessário. */
  async ensure(item: CatalogItem, version: string, onProgress?: (done: number, total: number) => void): Promise<InstalledFile[]> {
    // 0) Modo pasta: o arquivo já está no NAS; o Premiere importa direto de lá.
    if (item.local?.length) return item.local.map((f) => ({ ...f, sha256: "" }));
    // 1) Instalado pelo Gerenciador (já verificado por assinatura e hash na instalação).
    const managed = this.library.get(item.id)?.get(version);
    if (managed?.length) return managed;
    // 2) Cache próprio do painel.
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
