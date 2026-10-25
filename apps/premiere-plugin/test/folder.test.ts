import { beforeEach, describe, expect, it } from "vitest";
import { CatalogStore } from "../src/core/catalog.js";
import { FolderSource } from "../src/core/sources.js";
import { AssetCache } from "../src/core/downloads.js";
import { ApiClient } from "../src/core/api-client.js";
import { applyAsset } from "../src/core/apply.js";
import { MemoryFolderLibrary, MemoryPlatform, MockPremiere } from "../dev/mocks.js";

const noNetwork: typeof fetch = async () => {
  throw new TypeError("sem rede");
};

let platform: MemoryPlatform;
let nas: MemoryFolderLibrary;
let source: FolderSource;
let catalog: CatalogStore;
let cache: AssetCache;

const item = (o: Record<string, unknown>) => JSON.stringify({ tags: [], ...o });

beforeEach(async () => {
  platform = new MemoryPlatform("25.6.0", noNetwork);
  nas = new MemoryFolderLibrary();
  // Formato produzido pelo gerador de conteúdo
  nas.put("sfx-pop/item.json", item({ id: "meg-sfx-pop", name: "Pop", type: "sfx", main: "pop.wav", preview: "pop.wav", poster: "poster.png", thumb: "thumb.jpg", tags: ["som"] }));
  nas.put("sfx-pop/pop.wav", "RIFF....WAVE");
  nas.put("sfx-pop/poster.png", "png");
  nas.put("sfx-pop/thumb.jpg", "jpg");
  nas.put("light-leak-quente/item.json", item({ id: "meg-light-leak-quente", name: "Light Leak Quente", type: "overlay", main: "light-leak-quente.mp4", preview: "preview.mp4", tags: ["luz"], aspectRatio: "16:9" }));
  nas.put("light-leak-quente/light-leak-quente.mp4", "mp4");
  nas.put("light-leak-quente/preview.mp4", "mp4-preview");
  // Organização em subpastas por categoria também funciona
  nas.put("Titulos/lower-third-clean/item.json", item({ name: "Lower Third Clean", type: "title", main: "lower.mogrt", parameters: [{ key: "headline", label: "Headline", type: "string", default: "NOME" }] }));
  nas.put("Titulos/lower-third-clean/lower.mogrt", "PK");
  // Problemas que devem ser reportados, sem derrubar o resto
  nas.put("quebrado/item.json", "{ isto não é json");
  nas.put("sem-arquivo/item.json", item({ name: "Sem arquivo", type: "media", main: "sumiu.mp4" }));
  nas.put("duplicado/item.json", item({ id: "meg-sfx-pop", name: "Pop 2", type: "sfx", main: "pop.wav" }));
  nas.put("duplicado/pop.wav", "x");
  nas.put("antigo/item.json", item({ name: "Efeito Antigo", type: "overlay", main: "a.mp4", state: "deprecated" }));
  nas.put("antigo/a.mp4", "x");
  platform.folder = nas;
  source = new FolderSource(platform);
  catalog = new CatalogStore(platform, source);
  cache = new AssetCache(platform, new ApiClient(platform));
  await catalog.load();
  await cache.load();
  await catalog.sync();
});

describe("biblioteca em pasta (NAS, sem servidor)", () => {
  it("lê os itens, inclusive em subpastas, e reporta os problemas sem parar", () => {
    expect(catalog.search("", "all").items.map((i) => i.name).sort()).toEqual(["Light Leak Quente", "Lower Third Clean", "Pop"]);
    expect(source.problems.map((p) => p.dir).sort()).toEqual(["duplicado", "quebrado", "sem-arquivo"]);
    expect(catalog.get("lower-third-clean")!.category).toBe("Titulos");
  });

  it("busca sem acento e por categoria; descontinuados ficam fora da busca", () => {
    expect(catalog.search("luz", "all").items.map((i) => i.id)).toEqual(["meg-light-leak-quente"]);
    expect(catalog.search("", "sfx").total).toBe(1);
    expect(catalog.search("antigo", "all").total).toBe(0);
  });

  it("miniatura vem do cache do plugin (thumb.jpg tem prioridade)", () => {
    expect(catalog.get("meg-sfx-pop")!.posterUrl).toBe("mem:meg-sfx-pop@1.0.0-thumb.jpg");
  });

  it("insere direto do NAS, sem rede e sem baixar nada", async () => {
    const host = new MockPremiere();
    const states: string[] = [];
    const r = await applyAsset(
      { item: catalog.get("lower-third-clean")!, values: { headline: "Maria Souza" }, options: { at: "playhead", videoTrack: 1, audioTrack: 1, mode: "overwrite" } },
      { host, cache, hostVersion: "25.6.0", onEvent: (e) => states.push(e.state) },
    );
    expect(r.op.state).toBe("completed");
    expect(states).not.toContain("downloading");
    expect(host.insertions[0]!.path).toBe("\\\\NAS\\MotionHub\\Titulos\\lower-third-clean\\lower.mogrt");
    expect(host.insertions[0]!.params[0]).toMatchObject({ name: "Headline", value: "Maria Souza" });
  });

  it("preview é copiado do NAS só quando pedido", async () => {
    expect(platform.mediaCache.has("meg-light-leak-quente@1.0.0-preview-preview.mp4")).toBe(false);
    const url = await source.previewUrl(catalog.get("meg-light-leak-quente")!);
    expect(url).toBe("mem:meg-light-leak-quente@1.0.0-preview-preview.mp4");
  });

  it("NAS fora do ar: mantém a última lista conhecida e avisa", async () => {
    nas.available = false;
    const again = new CatalogStore(platform, new FolderSource(platform));
    await again.load();
    await again.sync();
    expect(again.online).toBe(false);
    expect(again.lastSyncError?.message).toMatch(/indisponível/);
    expect(again.search("pop", "all").total).toBe(1);
  });

  it("itens adicionados ou removidos da pasta aparecem/somem ao recarregar", async () => {
    const f = nas.pick("Whoosh Novo.wav", "RIFF");
    const dir = await nas.addItem("whoosh-novo", [{ as: "whoosh-novo.wav", file: f }], item({ name: "Whoosh Novo", type: "sfx", main: "whoosh-novo.wav" }));
    expect(dir).toBe("whoosh-novo");
    for (const k of [...nas.files.keys()]) if (k.startsWith("light-leak-quente/")) nas.files.delete(k);
    await catalog.sync();
    expect(catalog.get("whoosh-novo")!.name).toBe("Whoosh Novo");
    expect(catalog.get("meg-light-leak-quente")).toBeUndefined();
    const dir2 = await nas.addItem("whoosh-novo", [{ as: "a.wav", file: nas.pick("a.wav", "x") }], item({ name: "Outro", type: "sfx", main: "a.wav" }));
    expect(dir2).toBe("whoosh-novo-2");
  });

  it("favoritos e recentes funcionam só localmente, sem servidor", async () => {
    await catalog.toggleFavourite("meg-sfx-pop");
    await catalog.markRecent("lower-third-clean");
    expect(catalog.search("", "favourites").items.map((i) => i.id)).toEqual(["meg-sfx-pop"]);
    expect(catalog.search("", "recent").items.map((i) => i.id)).toEqual(["lower-third-clean"]);
  });
});

import { joinNative } from "../src/platform/uxp.js";

describe("caminhos nativos", () => {
  it("preserva caminho de rede do Windows e não duplica separadores", () => {
    expect(joinNative("\\\\NAS\\MotionHub", "Titulos/lower/a.mogrt", "\\")).toBe("\\\\NAS\\MotionHub\\Titulos\\lower\\a.mogrt");
    expect(joinNative("\\\\NAS\\MotionHub\\", "a.mov", "\\")).toBe("\\\\NAS\\MotionHub\\a.mov");
    expect(joinNative("Z:\\MotionHub", "a/b.wav", "\\")).toBe("Z:\\MotionHub\\a\\b.wav");
    expect(joinNative("/Volumes/MotionHub", "a/b.wav", "/")).toBe("/Volumes/MotionHub/a/b.wav");
  });
});
