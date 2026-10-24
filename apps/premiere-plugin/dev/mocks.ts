/** Implementações simuladas de plataforma e host, para navegador e testes. */
import { ApplyError } from "@motionhub/shared";
import type { Platform } from "../src/platform/types.js";
import type { HostAdapter, HostContext, HostParamValue, InsertOptions, InsertResult } from "../src/host/types.js";

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

  constructor(readonly hostVersion = "25.6.0") {}

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
