/**
 * PremiereAdapter contra um Premiere falso que reproduz as regras reais:
 * - criar ações fora de project.lockedAccess lança "Requires locked access";
 * - um clipe não passa da duração do arquivo (por isso a opção Duração repete o efeito).
 */
import { describe, expect, it } from "vitest";
import { PremiereAdapter, mapHostError } from "../src/host/premiere.js";

class T {
  constructor(readonly seconds: number) {}
  get ticks() { return String(Math.round(this.seconds * 254016000000)); }
  add(o: T) { return new T(this.seconds + o.seconds); }
  subtract(o: T) { return new T(this.seconds - o.seconds); }
}

function fakePremiere(opts: { mediaSec?: number; seqEnd?: number; tracks?: number; blendStart?: number } = {}) {
  const mediaSec = opts.mediaSec ?? 4;
  let locked = false;
  const guard = <V>(v: V): V => {
    if (!locked) throw new Error("Requires locked access");
    return v;
  };
  const log: string[] = [];
  const TYPE_BIN = 2, TYPE_CLIP = 1;
  const binItems: Array<{ name: string; type: number; path: string }> = [];
  const rootItems: Array<{ name: string; type: number }> = [];
  type Clip = { track: number; start: number; end: number; path: string; blend: number; opacity: number };
  const clips: Clip[] = [];
  let trackCount = opts.tracks ?? 2;
  const bin = { getItems: async () => binItems };
  const root = {
    getItems: async () => rootItems,
    createBinAction: (name: string) => guard({ run: () => rootItems.push({ name, type: TYPE_BIN }) }),
  };
  const project = {
    name: "Teste.prproj",
    getActiveSequence: async () => sequence,
    getRootItem: async () => root,
    importFiles: async (paths: string[]) => {
      for (const p of paths) binItems.push({ name: p, type: TYPE_CLIP, path: p });
      return true;
    },
    lockedAccess: (fn: () => void) => {
      locked = true;
      try { fn(); } finally { locked = false; }
    },
    executeTransaction: (fn: (c: { addAction(a: { run(): void }): void }) => void, undo: string) => {
      guard(0);
      const acts: Array<{ run(): void }> = [];
      fn({ addAction: (a) => acts.push(a) });
      for (const a of acts) a.run();
      log.push(undo);
      return true;
    },
  };
  const place = (kind: string) => (item: { path: string }, at: T, track: number) => guard({
    run: () => {
      if (track >= trackCount) track = trackCount++;
      clips.push({ track, start: at.seconds, end: at.seconds + mediaSec, path: item.path, blend: opts.blendStart ?? 18, opacity: 100 });
      log.push(`${kind} V${track + 1} @${at.seconds}`);
    },
  });
  const sequence = {
    name: "Seq",
    getPlayerPosition: async () => new T(3),
    getEndTime: async () => new T(opts.seqEnd ?? 60),
    getVideoTrackCount: async () => trackCount,
    getVideoTrack: async (i: number) => ({
      getTrackItems: () => clips.filter((c) => c.track === i).map((c) => ({
        getStartTime: async () => new T(c.start),
        createSetEndAction: (t: T) => guard({ run: () => { if (t.seconds > c.end) throw new Error("além da mídia"); c.end = t.seconds; } }),
        getComponentChain: async () => {
          const param = (displayName: string, key: "blend" | "opacity") => ({
            displayName,
            getStartValue: async () => ({ value: { value: c[key] } }),
            createKeyframe: (v: number) => guard({ v }),
            createSetValueAction: (k: { v: number }) => guard({ run: () => { c[key] = k.v; } }),
          });
          const comps = [
            { getMatchName: async () => "AE.ADBE Motion", getParamCount: () => 0, getParam: () => null },
            { getMatchName: async () => "AE.ADBE Opacity", getParamCount: () => 2, getParam: (i: number) => (i === 0 ? param("Opacidade", "opacity") : param("Modo de mesclagem", "blend")) },
          ];
          return { getComponentCount: () => guard(comps.length), getComponentAtIndex: (i: number) => guard(comps[i]) };
        },
      })),
    }),
  };
  const p = {
    Constants: { MediaType: { VIDEO: 2 }, TrackItemType: { CLIP: 1 } },
    Project: { getActiveProject: async () => project },
    ProjectItem: { TYPE_BIN, TYPE_CLIP, TYPE_FILE: 99 },
    FolderItem: { cast: () => bin },
    ClipProjectItem: { cast: (it: { path: string }) => ({
      getMediaFilePath: async () => it.path,
      getInPoint: async () => new T(0),
      getOutPoint: async () => new T(mediaSec),
    }) },
    TickTime: { createWithSeconds: (s: number) => new T(s) },
    SequenceEditor: {
      getEditor: () => ({ createOverwriteItemAction: place("overwrite"), createInsertProjectItemAction: place("insert") }),
    },
  };
  return { adapter: new PremiereAdapter(p as never, "26.0.0"), log, binItems, clips };
}

const base = { at: "playhead", mode: "overwrite", videoTrack: 1, audioTrack: 1 } as const;

describe("PremiereAdapter", () => {
  it("cria e executa as ações dentro do lockedAccess", async () => {
    const { adapter, log } = fakePremiere();
    const r = await adapter.insertMedia("C:\\MotionHub\\icone.mov", base, "Ícone");
    expect(r.trackItems).toBe(1);
    expect(log).toEqual(["Motion Hub: criar pasta", "overwrite V2 @3", "Motion Hub: inserir Ícone"]);
  });

  it("reaproveita o arquivo já importado", async () => {
    const { adapter, binItems } = fakePremiere();
    await adapter.insertMedia("C:/a.mov", base, "A");
    await adapter.insertMedia("c:\\A.MOV", base, "A");
    expect(binItems).toHaveLength(1);
  });

  it("Duração: repete o efeito e corta a última cópia no tempo exato", async () => {
    const { adapter, clips } = fakePremiere({ mediaSec: 4 });
    const r = await adapter.insertMedia("C:/grao.mp4", { ...base, fill: 10 }, "Grão");
    expect(clips.map((c) => [c.start, c.end])).toEqual([[3, 7], [7, 11], [11, 13]]);
    expect(r).toMatchObject({ trackItems: 3, warnings: [], undoSteps: 2 });
  });

  it("Duração: múltiplo exato não precisa de corte", async () => {
    const { adapter, clips } = fakePremiere({ mediaSec: 4 });
    const r = await adapter.insertMedia("C:/grao.mp4", { ...base, fill: 8 }, "Grão");
    expect(clips.map((c) => [c.start, c.end])).toEqual([[3, 7], [7, 11]]);
    expect(r.undoSteps).toBe(1);
  });

  it("Duração: até o fim da sequência", async () => {
    const { adapter, clips } = fakePremiere({ mediaSec: 4, seqEnd: 12 });
    await adapter.insertMedia("C:/grao.mp4", { ...base, fill: "end" }, "Grão");
    expect(clips.at(-1)!.end).toBe(12);
  });

  it("Duração menor que o arquivo insere uma vez só", async () => {
    const { adapter, clips } = fakePremiere({ mediaSec: 4 });
    await adapter.insertMedia("C:/grao.mp4", { ...base, fill: 3 }, "Grão");
    expect(clips).toHaveLength(1);
  });

  it("Duração em faixa nova: todas as cópias vão para a mesma faixa", async () => {
    const { adapter, clips } = fakePremiere({ mediaSec: 4, tracks: 2 });
    await adapter.insertMedia("C:/grao.mp4", { ...base, videoTrack: 2, fill: 10 }, "Grão");
    expect(new Set(clips.map((c) => c.track))).toEqual(new Set([2]));
    expect(clips).toHaveLength(3);
  });

  it("Mesclagem: overlay sem alpha vai em Tela, com opacidade, em todas as cópias", async () => {
    const { adapter, clips } = fakePremiere({ mediaSec: 4 });
    const r = await adapter.insertMedia("C:/leak.mp4", { ...base, fill: 10, blend: "screen", opacity: 80 }, "Leak");
    expect(clips.map((c) => [c.blend, c.opacity])).toEqual([[22, 80], [22, 80], [22, 80]]);
    expect(clips.at(-1)!.end).toBe(13);
    expect(r).toMatchObject({ warnings: [], undoSteps: 2 });
  });

  it("Mesclagem: grão em Sobrepor", async () => {
    const { adapter, clips } = fakePremiere();
    await adapter.insertMedia("C:/grao.mp4", { ...base, blend: "overlay", opacity: 35 }, "Grão");
    expect(clips.map((c) => [c.blend, c.opacity])).toEqual([[19, 35]]);
  });

  it("Mesclagem: se o Premiere não usar a tabela esperada, não mexe e avisa", async () => {
    const { adapter, clips } = fakePremiere({ blendStart: 1 });
    const r = await adapter.insertMedia("C:/leak.mp4", { ...base, blend: "screen" }, "Leak");
    expect(clips[0]!.blend).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/Tela/);
  });

  it("Mídia com alpha (sem blend) é inserida sem ajustes extras", async () => {
    const { adapter, clips } = fakePremiere();
    const r = await adapter.insertMedia("C:/icone.mov", base, "Ícone");
    expect(clips[0]!.blend).toBe(18);
    expect(r.undoSteps).toBe(1);
  });

  it("'Requires locked access' não é confundido com faixa bloqueada", () => {
    expect(mapHostError(new Error("Requires locked access")).code).toBe("host_api_error");
    expect(mapHostError(new Error("Track is locked")).code).toBe("track_locked");
  });
});
