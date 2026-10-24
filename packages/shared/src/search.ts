/**
 * Índice de busca local em memória (Especificação M01, §10).
 * Roda dentro do painel UXP, sem dependência nativa: índice invertido
 * com normalização de acentos (pt-BR), busca por prefixo e pesos por campo.
 */
import type { AspectRatio, AssetType, HostName } from "./asset.js";

export interface SearchDoc {
  id: string;
  name: string;
  type: AssetType;
  tags: readonly string[];
  synonyms?: readonly string[];
  summary?: string | null;
  client?: string | null;
  category?: string | null;
  aspectRatio?: AspectRatio;
  language?: string | null;
  hosts: readonly HostName[];
  updatedAt?: string;
}

export interface SearchFilters {
  type?: AssetType | readonly AssetType[];
  host?: HostName;
  aspectRatio?: AspectRatio;
  language?: string;
  client?: string;
  tags?: readonly string[];
  ids?: ReadonlySet<string>;
}

export interface SearchOptions extends SearchFilters {
  sort?: "relevance" | "name" | "updated";
  limit?: number;
  offset?: number;
}

export interface SearchResult<T extends SearchDoc> {
  items: T[];
  total: number;
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

const FIELD_WEIGHTS = { name: 10, tags: 6, synonyms: 5, client: 4, category: 3, summary: 1 } as const;
type Field = keyof typeof FIELD_WEIGHTS;

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export class SearchIndex<T extends SearchDoc> {
  private docs = new Map<string, T>();
  /** token → (docId → peso acumulado) */
  private postings = new Map<string, Map<string, number>>();
  /** tokens ordenados para busca por prefixo; reconstruído sob demanda */
  private sortedTokens: string[] | null = null;
  private docTokens = new Map<string, string[]>();
  /** posição de cada doc na ordem alfabética; reconstruída sob demanda */
  private nameRank: Map<string, number> | null = null;

  get size(): number {
    return this.docs.size;
  }

  get(id: string): T | undefined {
    return this.docs.get(id);
  }

  all(): T[] {
    return [...this.docs.values()];
  }

  addAll(docs: Iterable<T>): void {
    for (const d of docs) this.add(d);
  }

  add(doc: T): void {
    if (this.docs.has(doc.id)) this.remove(doc.id);
    this.docs.set(doc.id, doc);
    this.nameRank = null;
    const weights = new Map<string, number>();
    const addField = (field: Field, text: string | null | undefined) => {
      if (!text) return;
      for (const t of tokenize(text)) weights.set(t, (weights.get(t) ?? 0) + FIELD_WEIGHTS[field]);
    };
    addField("name", doc.name);
    doc.tags.forEach((t) => addField("tags", t));
    doc.synonyms?.forEach((t) => addField("synonyms", t));
    addField("client", doc.client);
    addField("category", doc.category);
    addField("summary", doc.summary);
    for (const [t, w] of weights) {
      let p = this.postings.get(t);
      if (!p) {
        p = new Map();
        this.postings.set(t, p);
        this.sortedTokens = null;
      }
      p.set(doc.id, w);
    }
    this.docTokens.set(doc.id, [...weights.keys()]);
  }

  remove(id: string): void {
    const tokens = this.docTokens.get(id);
    if (!tokens) return;
    for (const t of tokens) {
      const p = this.postings.get(t);
      p?.delete(id);
      if (p && p.size === 0) {
        this.postings.delete(t);
        this.sortedTokens = null;
      }
    }
    this.docTokens.delete(id);
    this.docs.delete(id);
    this.nameRank = null;
  }

  search(query: string, opts: SearchOptions = {}): SearchResult<T> {
    const terms = tokenize(query);
    let scored: Array<{ doc: T; score: number }>;

    if (terms.length === 0) {
      scored = [...this.docs.values()].map((doc) => ({ doc, score: 0 }));
    } else {
      // AND entre termos; cada termo casa por igualdade (peso cheio) ou prefixo (peso reduzido).
      let acc: Map<string, number> | null = null;
      for (const term of terms) {
        const hits = this.matchTerm(term);
        if (acc === null) {
          acc = hits;
        } else {
          const next = new Map<string, number>();
          for (const [id, s] of acc) {
            const h = hits.get(id);
            if (h !== undefined) next.set(id, s + h);
          }
          acc = next;
        }
        if (acc.size === 0) break;
      }
      scored = [...(acc ?? new Map<string, number>())].map(([id, score]) => ({ doc: this.docs.get(id)!, score }));
    }

    scored = scored.filter(({ doc }) => matchesFilters(doc, opts));

    const sort = opts.sort ?? (terms.length ? "relevance" : "name");
    const rank = this.getNameRank();
    const byName = (a: T, b: T) => rank.get(a.id)! - rank.get(b.id)!;
    if (sort === "name") scored.sort((a, b) => byName(a.doc, b.doc));
    else if (sort === "updated") scored.sort((a, b) => (b.doc.updatedAt ?? "").localeCompare(a.doc.updatedAt ?? "") || byName(a.doc, b.doc));
    else scored.sort((a, b) => b.score - a.score || byName(a.doc, b.doc));

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 50;
    return { items: scored.slice(offset, offset + limit).map((s) => s.doc), total: scored.length };
  }

  private getNameRank(): Map<string, number> {
    if (!this.nameRank) {
      const sorted = [...this.docs.values()].sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
      this.nameRank = new Map(sorted.map((d, i) => [d.id, i]));
    }
    return this.nameRank;
  }

  private matchTerm(term: string): Map<string, number> {
    const out = new Map<string, number>();
    const exact = this.postings.get(term);
    if (exact) for (const [id, w] of exact) out.set(id, w * 2);
    for (const t of this.tokensWithPrefix(term)) {
      if (t === term) continue;
      for (const [id, w] of this.postings.get(t)!) {
        out.set(id, Math.max(out.get(id) ?? 0, w));
      }
    }
    return out;
  }

  private tokensWithPrefix(prefix: string): string[] {
    if (!this.sortedTokens) this.sortedTokens = [...this.postings.keys()].sort();
    const arr = this.sortedTokens;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < arr.length && arr[i]!.startsWith(prefix); i++) out.push(arr[i]!);
    return out;
  }
}

export function matchesFilters(doc: SearchDoc, f: SearchFilters): boolean {
  if (f.ids && !f.ids.has(doc.id)) return false;
  if (f.type) {
    const types = typeof f.type === "string" ? [f.type] : f.type;
    if (types.length && !types.includes(doc.type)) return false;
  }
  if (f.host && !doc.hosts.includes(f.host)) return false;
  if (f.aspectRatio && doc.aspectRatio !== f.aspectRatio && doc.aspectRatio !== "any") return false;
  if (f.language && doc.language && doc.language !== f.language) return false;
  if (f.client && normalizeText(doc.client ?? "") !== normalizeText(f.client)) return false;
  if (f.tags?.length) {
    const docTags = new Set(doc.tags.map(normalizeText));
    if (!f.tags.every((t) => docTags.has(normalizeText(t)))) return false;
  }
  return true;
}
