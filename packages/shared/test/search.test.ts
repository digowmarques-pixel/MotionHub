import { describe, expect, it } from "vitest";
import { SearchIndex, type SearchDoc } from "../src/search.js";
import type { AssetType } from "../src/asset.js";

const doc = (id: string, name: string, extra: Partial<SearchDoc> = {}): SearchDoc => ({
  id,
  name,
  type: "title",
  tags: [],
  hosts: ["premiere"],
  aspectRatio: "16:9",
  ...extra,
});

describe("SearchIndex", () => {
  const idx = new SearchIndex();
  idx.addAll([
    doc("1", "Título Institucional Clean", { tags: ["institucional"], language: "pt-BR" }),
    doc("2", "Transição Glitch", { type: "transition", tags: ["glitch", "rápido"] }),
    doc("3", "Lower third corporativo", { tags: ["institucional"], aspectRatio: "9:16", synonyms: ["tarja"] }),
    doc("4", "Whoosh SFX", { type: "sfx", tags: ["som"], hosts: ["premiere", "after-effects"], aspectRatio: "any" }),
  ]);

  it("ignora acentos e caixa", () => {
    expect(idx.search("TITULO").items.map((d) => d.id)).toEqual(["1"]);
    expect(idx.search("transicao").items.map((d) => d.id)).toEqual(["2"]);
  });

  it("casa por prefixo, tags e sinônimos, com nome pesando mais", () => {
    expect(idx.search("insti").items.map((d) => d.id)).toEqual(["1", "3"]);
    expect(idx.search("tarja").items.map((d) => d.id)).toEqual(["3"]);
  });

  it("combina termos com AND e aplica filtros", () => {
    expect(idx.search("institucional clean").items.map((d) => d.id)).toEqual(["1"]);
    expect(idx.search("institucional", { aspectRatio: "16:9" }).items.map((d) => d.id)).toEqual(["1"]);
    expect(idx.search("", { host: "after-effects" }).items.map((d) => d.id)).toEqual(["4"]);
    expect(idx.search("", { type: ["sfx", "transition"] }).total).toBe(2);
  });

  it("remove e reindexa", () => {
    const i2 = new SearchIndex();
    i2.add(doc("x", "Alpha"));
    i2.add(doc("x", "Beta"));
    expect(i2.search("alpha").total).toBe(0);
    expect(i2.search("beta").total).toBe(1);
    i2.remove("x");
    expect(i2.size).toBe(0);
  });

  it("busca em 10 mil itens abaixo de 300 ms p95 (§10)", () => {
    const words = ["título", "institucional", "glitch", "neon", "corporativo", "lower", "third", "whoosh", "zoom", "legenda", "clean", "bold", "minimal", "kinetic", "typo"];
    const types: AssetType[] = ["title", "text", "transition", "overlay", "sfx"];
    const big = new SearchIndex();
    for (let i = 0; i < 10_000; i++) {
      const w = (k: number) => words[(i * 7 + k * 13) % words.length]!;
      big.add(doc(`a${i}`, `${w(0)} ${w(1)} ${i}`, { type: types[i % types.length]!, tags: [w(2), w(3)], summary: `${w(4)} ${w(5)} ${w(6)}` }));
    }
    const queries = ["tit", "institucional neon", "glitch", "leg", "zoom clean", "k", "minimal bold", "1234"];
    const times: number[] = [];
    for (let r = 0; r < 20; r++) {
      for (const q of queries) {
        const t = performance.now();
        big.search(q, { type: r % 2 ? "title" : undefined, limit: 60 });
        times.push(performance.now() - t);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(p95).toBeLessThan(300);
  });
});
