/** Servidor falso (fetch) com catálogo, favoritos e downloads, para testar o núcleo do plugin. */
import { sha256Hex } from "@motionhub/shared";
import type { CatalogItem } from "../src/core/catalog.js";

export const MOGRT = new TextEncoder().encode("PK\u0003\u0004 mogrt de teste");

export function item(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "a1",
    slug: "meg-title-rise-001",
    name: "Título Rise Institucional",
    type: "title",
    summary: "Título limpo para vídeos institucionais",
    tags: ["institucional", "clean"],
    synonyms: [],
    category: null,
    client: null,
    aspectRatio: "16:9",
    language: "pt-BR",
    hosts: ["premiere"],
    rights: "megalume-internal",
    creatorId: "u1",
    state: "published",
    latestVersion: "1.2.0",
    currentVersionId: "v1",
    posterUrl: null,
    previewUrl: null,
    durationSec: 3,
    updatedAt: "2026-10-24T00:00:00.000Z",
    manifest: {
      schemaVersion: "1.0",
      id: "meg-title-rise-001",
      version: "1.2.0",
      name: "Título Rise Institucional",
      type: "title",
      hosts: [{ name: "premiere", minVersion: "25.6" }],
      assets: [{ path: "template/title.mogrt", sha256: sha256Hex(MOGRT), role: "template" }],
      preview: { path: "preview/loop.mp4", poster: "preview/poster.png" },
      parameters: [
        { key: "headline", label: "Headline", type: "string", default: "MEGALUME", maxLength: 120 },
        { key: "primaryColor", label: "Cor principal", type: "color", default: "#FFFFFF" },
        { key: "durationSec", type: "duration", min: 0.5, max: 20, default: 3 },
      ],
      aspectRatio: "16:9",
      license: "megalume-internal",
      tags: ["institucional"],
      synonyms: [],
      dependencies: [],
    },
    ...over,
  };
}

export class FakeServer {
  online = true;
  items: CatalogItem[] = [item(), item({ id: "a2", slug: "whoosh", name: "Whoosh rápido", type: "sfx", summary: "Efeito sonoro de passagem", tags: ["som"], latestVersion: "1.0.0" })];
  favourites = new Set<string>();
  fileBody = MOGRT;
  calls: string[] = [];
  favCalls: string[] = [];

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}`);
    if (!this.online) throw new TypeError("Failed to fetch");
    const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const p = url.pathname;
    if (p === "/v1/auth/session" && method === "POST") {
      return json(200, { accessToken: "at", refreshToken: "r".repeat(30), expiresIn: 900, user: { id: "u1", orgId: "o", name: "Editor", email: "e@x", role: "editor", status: "active", createdAt: "" } });
    }
    if (p === "/v1/catalog") return json(200, { serverTime: "2026-10-24T12:00:00.000Z", items: this.items });
    if (p === "/v1/favourites" && method === "GET") return json(200, [...this.favourites].map((assetId) => ({ assetId })));
    const fav = /^\/v1\/favourites\/(.+)$/.exec(p);
    if (fav) {
      this.favCalls.push(`${method} ${fav[1]}`);
      if (method === "PUT") this.favourites.add(fav[1]!);
      else this.favourites.delete(fav[1]!);
      return new Response(null, { status: 204 });
    }
    if (/download-ticket$/.test(p)) {
      return json(200, { files: [{ path: "template/title.mogrt", role: "template", url: "http://srv/v1/files/x?sig=1", sha256: sha256Hex(MOGRT), bytes: MOGRT.length }] });
    }
    if (p.startsWith("/v1/files/")) return new Response(this.fileBody, { status: 200 });
    return json(404, { error: { code: "not_found", message: "?" } });
  };
}
