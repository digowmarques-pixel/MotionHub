/** Implementações simuladas de plataforma e host, para navegador e testes. */
import { keyframeCount } from "../src/core/motion/plan.js";
import { ApplyError } from "@motionhub/shared";
import type { FolderLibrary, PickedFile, Platform } from "../src/platform/types.js";
import type { HostAdapter, HostContext, HostParamValue, InsertOptions, InsertResult, MotionJob, MotionResult } from "../src/host/types.js";

/** Biblioteca em pasta simulada em memória (testes). */
export class MemoryFolderLibrary implements FolderLibrary {
  files = new Map<string, Uint8Array>();
  pickedData = new WeakMap<PickedFile, Uint8Array>();
  available = true;
  constructor(readonly displayPath = "\\\\NAS\\MotionHub") {}

  put(rel: string, data: string | Uint8Array) {
    this.files.set(rel, typeof data === "string" ? new TextEncoder().encode(data) : data);
  }
  private check() {
    if (!this.available) throw new Error("NAS indisponível");
  }
  async scan(maxDepth: number) {
    this.check();
    const dirs = new Map<string, string[]>();
    for (const p of this.files.keys()) {
      const parts = p.split("/");
      const name = parts.pop()!;
      if (!parts.length || parts.length > maxDepth) continue;
      const d = parts.join("/");
      dirs.set(d, [...(dirs.get(d) ?? []), name]);
    }
    return [...dirs].map(([dir, files]) => ({ dir, files }));
  }
  async readText(rel: string) {
    this.check();
    const b = this.files.get(rel);
    return b ? new TextDecoder().decode(b) : null;
  }
  async readBinary(rel: string) {
    this.check();
    return this.files.get(rel) ?? null;
  }
  nativePath(rel: string) {
    return `${this.displayPath}\\${rel.split("/").join("\\")}`;
  }
  async addItem(dirName: string, files: Array<{ as: string; file: PickedFile }>, itemJson: string) {
    this.check();
    let name = dirName;
    for (let i = 2; [...this.files.keys()].some((k) => k.startsWith(`${name}/`)); i++) name = `${dirName}-${i}`;
    for (const f of files) this.put(`${name}/${f.as}`, this.pickedData.get(f.file) ?? new Uint8Array());
    this.put(`${name}/item.json`, itemJson);
    return name;
  }
  pick(name: string, data: Uint8Array | string): PickedFile {
    const h = { name };
    this.pickedData.set(h, typeof data === "string" ? new TextEncoder().encode(data) : data);
    return h;
  }
}

/**
 * Pasta de rede simulada por HTTP (só para o modo navegador): lê uma cópia da biblioteca
 * servida junto do painel, com uma listagem _lista.json gerada por dev/make-listing.mjs.
 */
export class HttpFolderLibrary implements FolderLibrary {
  readonly displayPath = "\\\\NAS\\MotionHub";
  constructor(private readonly base: string) {}
  async scan() {
    const r = await fetch(`${this.base}/_lista.json`);
    if (!r.ok) throw new Error("pasta simulada indisponível");
    return (await r.json()) as Array<{ dir: string; files: string[] }>;
  }
  async readText(rel: string) {
    const r = await fetch(`${this.base}/${rel}`);
    return r.ok ? r.text() : null;
  }
  async readBinary(rel: string) {
    const r = await fetch(`${this.base}/${rel}`);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  nativePath(rel: string) {
    return `${this.displayPath}\\${rel.split("/").join("\\")}`;
  }
  async addItem(): Promise<string> {
    throw new Error("Na simulação do navegador não é possível gravar na pasta.");
  }
}

export class MemoryPlatform implements Platform {
  readonly os = "browser";
  files = new Map<string, Uint8Array | string>();
  secure = new Map<string, string>();
  constructor(
    readonly hostVersion = "25.6.0",
    public fetch: typeof globalThis.fetch = (...a) => globalThis.fetch(...a),
    private readonly persist?: Storage,
  ) {
    if (persist) {
      for (let i = 0; i < persist.length; i++) {
        const k = persist.key(i)!;
        if (k.startsWith("file:")) this.files.set(k.slice(5), persist.getItem(k)!);
        if (k.startsWith("secure:")) this.secure.set(k.slice(7), persist.getItem(k)!);
      }
    }
  }
  libraryIndex: string | null = null;
  folder: FolderLibrary | null = null;
  /** Fila de arquivos que o "diálogo" devolverá em pickFile. */
  pickQueue: PickedFile[] = [];
  mediaCache = new Map<string, string>();
  async connectFolderLibrary() {
    return this.folder?.displayPath ?? null;
  }
  async folderLibrary() {
    return this.folder;
  }
  async cacheMedia(key: string, load: () => Promise<Uint8Array | null>) {
    if (this.mediaCache.has(key)) return this.mediaCache.get(key)!;
    const bytes = await load();
    if (!bytes) return null;
    const url = typeof URL.createObjectURL === "function" && typeof Blob !== "undefined" && typeof window !== "undefined"
      ? URL.createObjectURL(new Blob([bytes as BlobPart]))
      : `mem:${key}`;
    this.mediaCache.set(key, url);
    return url;
  }
  async pickFile() {
    return this.pickQueue.shift() ?? null;
  }
  async connectLibrary() {
    return this.libraryIndex ? "/mock/Library" : null;
  }
  async readLibraryIndex() {
    return this.libraryIndex;
  }
  async readText(path: string) {
    const v = this.files.get(path);
    return typeof v === "string" ? v : v ? new TextDecoder().decode(v) : null;
  }
  async writeText(path: string, text: string) {
    this.files.set(path, text);
    this.persist?.setItem(`file:${path}`, text);
  }
  async writeBinary(path: string, data: Uint8Array) {
    this.files.set(path, data);
    return `/mock/data/${path}`;
  }
  async nativePath(path: string) {
    return this.files.has(path) ? `/mock/data/${path}` : null;
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async secureGet(key: string) {
    return this.secure.get(key) ?? null;
  }
  async secureSet(key: string, value: string | null) {
    if (value === null) {
      this.secure.delete(key);
      this.persist?.removeItem(`secure:${key}`);
    } else {
      this.secure.set(key, value);
      this.persist?.setItem(`secure:${key}`, value);
    }
  }
}

export interface MockInsertion {
  kind: "mogrt" | "media";
  path: string;
  at: number;
  opts: InsertOptions;
  params: HostParamValue[];
}

/** Premiere simulado: sequência 1920×1080 29,97 fps; parâmetros "Headline"/"Cor principal" existem no template. */
export class MockPremiere implements HostAdapter {
  hasProject = true;
  hasSequence = true;
  lockedTracks = new Set<number>();
  knownParams = new Set(["headline", "corprincipal", "primarycolor", "subtitle"]);
  insertions: MockInsertion[] = [];
  undoStack: MockInsertion[] = [];
  playhead = 12.5;

  /** Clipes selecionados na timeline simulada (duração em segundos). */
  selectedClips: number[] = [8];
  motions: Array<{ label: string; kind: string; keyframes: number }> = [];

  constructor(readonly hostVersion = "25.6.0") {}

  async applyMotion(job: MotionJob): Promise<MotionResult> {
    if (!this.hasProject) throw new ApplyError("host_no_project");
    if (!this.hasSequence) throw new ApplyError("host_no_sequence");
    if (!this.selectedClips.length) throw new ApplyError("unsupported", "Selecione um ou mais clipes de vídeo na timeline.");
    const plans = job.kind === "each" ? this.selectedClips.map((d) => job.build({ duration: d, fps: 29.97 })) : [job.a, job.b];
    const keyframes = plans.reduce((n, m) => n + keyframeCount(m), 0);
    this.motions.push({ label: job.label, kind: job.kind, keyframes });
    return { clips: job.kind === "each" ? this.selectedClips.length : 2, keyframes, warnings: [], undoSteps: plans.length * 2, details: "simulado" };
  }

  async getContext(): Promise<HostContext> {
    return {
      host: "premiere",
      hostVersion: this.hostVersion,
      project: this.hasProject ? { name: "Campanha_Q4.prproj" } : null,
      sequence: this.hasProject && this.hasSequence
        ? { name: "Institucional 16x9", fps: 29.97, width: 1920, height: 1080, playheadSec: this.playhead, durationSec: 95, videoTracks: 3, audioTracks: 2 }
        : null,
    };
  }

  private check(opts: InsertOptions) {
    if (!this.hasProject) throw new ApplyError("host_no_project");
    if (!this.hasSequence) throw new ApplyError("host_no_sequence");
    if (this.lockedTracks.has(opts.videoTrack)) throw new ApplyError("track_locked", `V${opts.videoTrack + 1} bloqueada`);
  }

  async insertMogrt(path: string, opts: InsertOptions, params: HostParamValue[]): Promise<InsertResult> {
    this.check(opts);
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const warnings = params.filter((p) => p.type !== "duration" && !this.knownParams.has(norm(p.name))).map((p) => `Parâmetro "${p.name}" não existe neste template.`);
    const ins = { kind: "mogrt" as const, path, at: this.at(opts), opts, params };
    this.insertions.push(ins);
    this.undoStack.push(ins);
    return { trackItems: 2, warnings };
  }

  async insertMedia(path: string, opts: InsertOptions): Promise<InsertResult> {
    this.check(opts);
    const ins = { kind: "media" as const, path, at: this.at(opts), opts, params: [] };
    this.insertions.push(ins);
    this.undoStack.push(ins);
    return { trackItems: 1, warnings: [] };
  }

  undo(): MockInsertion | undefined {
    const last = this.undoStack.pop();
    if (last) this.insertions = this.insertions.filter((i) => i !== last);
    return last;
  }

  private at(opts: InsertOptions) {
    return opts.at === "playhead" ? this.playhead : opts.at === "start" ? 0 : opts.at;
  }
}
