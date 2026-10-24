/**
 * Biblioteca local de pacotes instalados.
 * Layout:  <raiz>/packs/<slug>/<versão>/...   <raiz>/index.json   <raiz>/.staging/
 * Versões antigas não são apagadas automaticamente: projetos podem referenciá-las (§4.3, §15).
 */
import { mkdir, readFile, rename, rm, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { InstalledPackVersion, LibraryIndex } from "./types.js";

export class Library {
  private index: LibraryIndex = { schema: 1, updatedAt: new Date(0).toISOString(), packs: {} };

  constructor(readonly root: string) {}

  get packsDir(): string {
    return join(this.root, "packs");
  }
  get stagingDir(): string {
    return join(this.root, ".staging");
  }

  async load(): Promise<LibraryIndex> {
    await mkdir(this.packsDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(join(this.root, "index.json"), "utf8")) as LibraryIndex;
      if (parsed.schema === 1) this.index = parsed;
    } catch {
      /* biblioteca nova ou índice ilegível: começa vazio */
    }
    return this.index;
  }

  get snapshot(): LibraryIndex {
    return structuredClone(this.index);
  }

  installed(slug: string): string | null {
    return this.index.packs[slug]?.current ?? null;
  }

  async activate(slug: string, v: InstalledPackVersion): Promise<void> {
    const cur = this.index.packs[slug];
    if (cur) {
      if (cur.current !== v.version) cur.previous = cur.current;
      cur.current = v.version;
      cur.versions[v.version] = v;
      cur.revoked = false;
    } else {
      this.index.packs[slug] = { slug, current: v.version, previous: null, versions: { [v.version]: v } };
    }
    await this.save();
  }

  async rollback(slug: string): Promise<string> {
    const p = this.index.packs[slug];
    if (!p?.previous || !p.versions[p.previous]) throw new Error("Não há versão anterior instalada para voltar.");
    const prev = p.previous;
    p.previous = p.current;
    p.current = prev;
    await this.save();
    return prev;
  }

  /** Remove do índice (o painel deixa de oferecer). Arquivos ficam, para não quebrar projetos. */
  async uninstall(slug: string): Promise<void> {
    delete this.index.packs[slug];
    await this.save();
  }

  async markRevoked(revoked: Array<{ slug: string; version: string }>): Promise<string[]> {
    const hit: string[] = [];
    for (const r of revoked) {
      const p = this.index.packs[r.slug];
      if (p && p.current === r.version && !p.revoked) {
        p.revoked = true;
        hit.push(r.slug);
      }
    }
    if (hit.length) await this.save();
    return hit;
  }

  /** Apaga do disco versões que não são a atual nem a anterior. Ação explícita do usuário. */
  async purgeOldVersions(): Promise<number> {
    let freed = 0;
    for (const p of Object.values(this.index.packs)) {
      const keep = new Set([p.current, p.previous].filter(Boolean) as string[]);
      for (const v of Object.keys(p.versions)) {
        if (keep.has(v)) continue;
        freed += await dirSize(p.versions[v]!.dir);
        await rm(p.versions[v]!.dir, { recursive: true, force: true });
        delete p.versions[v];
      }
    }
    await this.save();
    return freed;
  }

  private async save(): Promise<void> {
    this.index.updatedAt = new Date().toISOString();
    const tmp = join(this.root, `index.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(this.index, null, 2));
    await rename(tmp, join(this.root, "index.json"));
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}
