import { describe, expect, it } from "vitest";
import { parseFolderItem, roleForFile, slugify } from "../src/folder-item.js";

describe("item da biblioteca em pasta", () => {
  it("aceita o formato do gerador com defaults", () => {
    const r = parseFolderItem(JSON.stringify({ id: "meg-pop", name: "Pop", type: "sfx", main: "pop.wav", preview: "pop.wav", poster: "poster.png", tags: ["som"] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item).toMatchObject({ version: "1.0.0", aspectRatio: "any", state: "published", license: "megalume-internal", parameters: [] });
  });

  it("recusa JSON inválido, tipo desconhecido e caminho perigoso", () => {
    expect(parseFolderItem("{").ok).toBe(false);
    expect(parseFolderItem(JSON.stringify({ name: "x", type: "foo", main: "a.mp4" })).ok).toBe(false);
    expect(parseFolderItem(JSON.stringify({ name: "x", type: "media", main: "../../segredo.txt" })).ok).toBe(false);
  });

  it("deduz papel do arquivo e gera slug", () => {
    expect(roleForFile("Título.MOGRT")).toBe("template");
    expect(roleForFile("whoosh.wav")).toBe("audio");
    expect(roleForFile("luz.mov")).toBe("media");
    expect(slugify("Lower Third Ação 2026!")).toBe("lower-third-acao-2026");
  });
});
