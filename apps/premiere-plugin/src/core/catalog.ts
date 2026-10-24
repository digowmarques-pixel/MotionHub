/**
 * Catálogo local offline-first (M01, M13, §4.3):
 * cache em disco + índice de busca em memória; favoritos com fila de sincronização.
 */
import { SearchIndex, type AssetDTO, type AssetType, type PresetManifest, type SearchOptions } from "@motionhub/shared";
import type { Platform } from "../platform/types.js";
import { OfflineError, type ApiClient } from "./api-client.js";

export interface CatalogItem extends AssetDTO {
  manifest: PresetManifest;
  deleted?: boolean;
}

interface CatalogFile {
  serverTime: string | null;
  items: CatalogItem[];
}

interface UserState {
  favourites: string[];
  pending: Array<{ assetId: string; op: "add" | "remove" }>;
  recents: string[];
}

export type Category = "all" | "favourites" | "recent" | AssetType;

const CATALOG = "catalog.json";
const USER = "user-state.json";
const MAX_RECENTS = 50;

export class CatalogStore {
  private items = new Map<string, CatalogItem>();
  private index = new SearchIndex<CatalogItem>();
  private serverTime: string | null = null;
  private state: UserState = { favourites: [], pending: [], recents: [] };
  lastSyncError: Error | null = null;
  online = false;

  constructor(
    private readonly platform: Platform,
    private readonly api: ApiClient,
  ) {}

  async load(): Promise<void> {
    const cat = await this.readJson<CatalogFile>(CATALOG);
    if (cat) {
      this.serverTime = cat.serverTime;
      for (const it of cat.items) this.items.set(it.id, it);
    }
    this.state = { ...this.state, ...(await this.readJson<UserState>(USER)) };
    this.rebuild();
  }

  get size(): number {
    return this.index.size;
  }

  get(id: string): CatalogItem | undefined {
    return this.items.get(id);
  }

  isFavourite(id: string): boolean {
    return this.state.favourites.includes(id);
  }

  /** Sincroniza incrementalmente. Falha de rede mantém o catálogo local funcionando. */
  async sync(): Promise<{ changed: number }> {
    try {
      const q = this.serverTime ? `?since=${encodeURIComponent(this.serverTime)}` : "";
      const r = await this.api.request<{ serverTime: string; items: CatalogItem[] }>("GET", `/v1/catalog${q}`);
      for (const it of r.items) this.items.set(it.id, it);
      this.serverTime = r.serverTime;
      await this.platform.writeText(CATALOG, JSON.stringify({ serverTime: this.serverTime, items: [...this.items.values()] } satisfies CatalogFile));
      this.rebuild();
      await this.flushFavourites();
      const remote = await this.api.request<Array<{ assetId: string }>>("GET", "/v1/favourites");
      const pendingAdd = this.state.pending.filter((p) => p.op === "add").map((p) => p.assetId);
      const pendingRemove = new Set(this.state.pending.filter((p) => p.op === "remove").map((p) => p.assetId));
      this.state.favourites = [...new Set([...remote.map((f) => f.assetId), ...pendingAdd])].filter((id) => !pendingRemove.has(id));
      await this.saveState();
      this.online = true;
      this.lastSyncError = null;
      return { changed: r.items.length };
    } catch (e) {
      this.online = !(e instanceof OfflineError);
      this.lastSyncError = e as Error;
      return { changed: 0 };
    }
  }

  search(query: string, category: Category, opts: Omit<SearchOptions, "type" | "ids"> = {}) {
    const o: SearchOptions = { host: "premiere", ...opts };
    if (category === "favourites") o.ids = new Set(this.state.favourites);
    else if (category === "recent") o.ids = new Set(this.state.recents);
    else if (category !== "all") o.type = category;
    const r = this.index.search(query, o);
    if (category === "recent" && !query && !opts.sort) {
      const order = new Map(this.state.recents.map((id, i) => [id, i]));
      r.items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    return r;
  }

  async toggleFavourite(id: string): Promise<boolean> {
    const fav = !this.isFavourite(id);
    this.state.favourites = fav ? [id, ...this.state.favourites] : this.state.favourites.filter((f) => f !== id);
    this.state.pending = [...this.state.pending.filter((p) => p.assetId !== id), { assetId: id, op: fav ? "add" : "remove" }];
    await this.saveState();
    void this.flushFavourites().catch(() => {});
    return fav;
  }

  async markRecent(id: string): Promise<void> {
    this.state.recents = [id, ...this.state.recents.filter((r) => r !== id)].slice(0, MAX_RECENTS);
    await this.saveState();
  }

  /** Envia operações de favorito pendentes (feitas offline). */
  async flushFavourites(): Promise<void> {
    while (this.state.pending.length) {
      const p = this.state.pending[0]!;
      await this.api.request(p.op === "add" ? "PUT" : "DELETE", `/v1/favourites/${p.assetId}`);
      this.state.pending.shift();
      await this.saveState();
    }
  }

  private rebuild(): void {
    this.index = new SearchIndex<CatalogItem>();
    for (const it of this.items.values()) {
      if (it.state === "published" && !it.deleted) {
        this.index.add({ ...it, synonyms: it.synonyms, language: it.language, aspectRatio: it.aspectRatio });
      }
    }
  }

  private async saveState(): Promise<void> {
    await this.platform.writeText(USER, JSON.stringify(this.state));
  }

  private async readJson<T>(path: string): Promise<T | null> {
    const t = await this.platform.readText(path);
    if (!t) return null;
    try {
      return JSON.parse(t) as T;
    } catch {
      return null;
    }
  }
}
