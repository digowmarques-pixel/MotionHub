import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "../src/core/api-client.js";
import { CatalogStore } from "../src/core/catalog.js";
import { AssetCache } from "../src/core/downloads.js";
import { applyAsset, type ApplyDeps } from "../src/core/apply.js";
import { MemoryPlatform, MockPremiere } from "../dev/mocks.js";
import { FakeServer, MOGRT } from "./fake-server.js";

let server: FakeServer;
let platform: MemoryPlatform;
let api: ApiClient;
let catalog: CatalogStore;
let cache: AssetCache;
let host: MockPremiere;

const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps => ({ host, cache, hostVersion: "25.6.0", newId: () => "op-1", ...over });
const opts = { at: "playhead" as const, videoTrack: 1, audioTrack: 1, mode: "overwrite" as const };

beforeEach(async () => {
  server = new FakeServer();
  platform = new MemoryPlatform("25.6.0", server.fetch);
  api = new ApiClient(platform);
  await api.login("http://srv", "e@x", "senha");
  catalog = new CatalogStore(platform, api);
  cache = new AssetCache(platform, api);
  host = new MockPremiere();
  await catalog.load();
  await cache.load();
  await catalog.sync();
});

describe("catálogo offline-first", () => {
  it("busca sem acento e por categoria", () => {
    expect(catalog.search("titulo", "all").items.map((i) => i.id)).toEqual(["a1"]);
    expect(catalog.search("", "sfx").items.map((i) => i.id)).toEqual(["a2"]);
  });

  it("recarrega do disco sem rede", async () => {
    server.online = false;
    const api2 = new ApiClient(platform);
    expect(await api2.restore()).toBe(true);
    const c2 = new CatalogStore(platform, api2);
    await c2.load();
    expect(c2.size).toBe(2);
    await c2.sync();
    expect(c2.online).toBe(false);
    expect(c2.search("whoosh", "all").total).toBe(1);
  });

  it("favoritos feitos offline sincronizam quando volta a rede (M13)", async () => {
    server.online = false;
    await catalog.toggleFavourite("a2");
    expect(catalog.search("", "favourites").items.map((i) => i.id)).toEqual(["a2"]);
    expect(server.favourites.size).toBe(0);
    server.online = true;
    await catalog.sync();
    expect([...server.favourites]).toEqual(["a2"]);
    expect(catalog.isFavourite("a2")).toBe(true);
  });

  it("recentes ficam em ordem de uso", async () => {
    await catalog.markRecent("a1");
    await catalog.markRecent("a2");
    expect(catalog.search("", "recent").items.map((i) => i.id)).toEqual(["a2", "a1"]);
  });
});

describe("aplicar asset (§7.1, casos BDD §14)", () => {
  it("CT-001: insere título compatível na posição da agulha, com parâmetros, e o Desfazer reverte", async () => {
    const it0 = catalog.get("a1")!;
    const states: string[] = [];
    const r = await applyAsset({ item: it0, values: { headline: "Ação & Coração 🎬", primaryColor: "#FF0055" }, options: opts }, deps({ onEvent: (e) => states.push(e.state) }));
    expect(r.op.state).toBe("completed");
    expect(states).toEqual(["idle", "compatibility_checked", "downloading", "validating", "preparing_host", "inserting", "verifying", "completed"]);
    expect(host.insertions).toHaveLength(1);
    expect(host.insertions[0]!.at).toBe(12.5);
    expect(host.insertions[0]!.params.find((p) => p.name === "Headline")!.value).toBe("Ação & Coração 🎬");
    expect(r.message).toMatch(/Ctrl\+Z/);
    host.undo();
    expect(host.insertions).toHaveLength(0);
  });

  it("CT-002: sem sequência ativa não falha, não insere e orienta", async () => {
    host.hasSequence = false;
    const r = await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    expect(r.op.state).toBe("failed");
    expect(r.op.error?.code).toBe("host_no_sequence");
    expect(r.message).toMatch(/sequência/);
    expect(host.insertions).toHaveLength(0);
  });

  it("CT-003: hash diferente do manifest é recusado e nada é instalado", async () => {
    server.fileBody = new TextEncoder().encode("conteúdo adulterado");
    const r = await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    expect(r.op.error?.code).toBe("invalid_package");
    expect(cache.isInstalled("a1", "1.2.0")).toBe(false);
    expect([...platform.files.keys()].some((k) => k.endsWith(".mogrt"))).toBe(false);
  });

  it("CT-004: sem internet, asset já instalado é inserido sem a API externa", async () => {
    await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    server.online = false;
    server.calls = [];
    const r = await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    expect(r.op.state).toBe("completed");
    expect(r.op.events.map((e) => e.state)).not.toContain("downloading");
    expect(server.calls).toEqual([]);
  });

  it("sem internet e não instalado: erro claro de dependência", async () => {
    server.online = false;
    const r = await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    expect(r.op.error?.code).toBe("missing_dependency");
  });

  it("recusa host antigo, parâmetro inválido e faixa bloqueada", async () => {
    const it0 = catalog.get("a1")!;
    expect((await applyAsset({ item: it0, values: {}, options: opts }, deps({ hostVersion: "25.0" }))).op.error?.code).toBe("unsupported");
    expect((await applyAsset({ item: it0, values: { durationSec: 99 }, options: opts }, deps())).op.error?.code).toBe("unsupported");
    host.lockedTracks.add(1);
    expect((await applyAsset({ item: it0, values: {}, options: opts }, deps())).op.error?.code).toBe("track_locked");
  });

  it("parâmetro inexistente no template vira aviso, não erro", async () => {
    host.knownParams = new Set(["headline"]);
    const r = await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    expect(r.op.state).toBe("completed");
    expect(r.message).toMatch(/Cor principal/);
  });

  it("usa pacote instalado pelo Gerenciador, sem rede e sem baixar", async () => {
    platform.libraryIndex = JSON.stringify({
      schema: 1,
      packs: {
        piloto: {
          current: "1.0.0",
          versions: { "1.0.0": { assets: [{ assetId: "a1", version: "1.2.0", files: [{ path: "meg-title-rise-001/1.2.0/template/title.mogrt", role: "template", sha256: "x", absPath: "C:\\Users\\editor\\AppData\\Roaming\\Megalume Motion Hub\\Library\\packs\\piloto\\1.0.0\\title.mogrt" }] }] } },
        },
      },
    });
    await cache.loadLibrary();
    expect(cache.libraryConnected).toBe(true);
    expect(cache.isInstalled("a1", "1.2.0")).toBe(true);
    server.online = false;
    server.calls = [];
    const r = await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    expect(r.op.state).toBe("completed");
    expect(server.calls).toEqual([]);
    expect(host.insertions[0]!.path).toMatch(/Library\\packs\\piloto/);
  });

  it("ignora pacote revogado na biblioteca do Gerenciador", async () => {
    platform.libraryIndex = JSON.stringify({ schema: 1, packs: { piloto: { current: "1.0.0", revoked: true, versions: { "1.0.0": { assets: [{ assetId: "a1", version: "1.2.0", files: [{ path: "x/y/t.mogrt", role: "template", sha256: "x", absPath: "/lib/t.mogrt" }] }] } } } } });
    await cache.loadLibrary();
    expect(cache.isInstalled("a1", "1.2.0")).toBe(false);
  });

  it("download verificado grava o arquivo íntegro", async () => {
    await applyAsset({ item: catalog.get("a1")!, values: {}, options: opts }, deps());
    const stored = platform.files.get("assets/meg-title-rise-001/1.2.0/template/title.mogrt") as Uint8Array;
    expect(Buffer.from(stored).equals(Buffer.from(MOGRT))).toBe(true);
  });
});
