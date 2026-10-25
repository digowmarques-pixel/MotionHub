/**
 * PremiereAdapter contra um Premiere falso que reproduz a regra real:
 * criar ações fora de project.lockedAccess lança "Requires locked access".
 */
import { describe, expect, it } from "vitest";
import { PremiereAdapter, mapHostError } from "../src/host/premiere.js";

function fakePremiere() {
  let locked = false;
  const guard = <T>(v: T): T => {
    if (!locked) throw new Error("Requires locked access");
    return v;
  };
  const log: string[] = [];
  const TYPE_BIN = 2, TYPE_CLIP = 1;
  const binItems: Array<{ name: string; type: number; path: string }> = [];
  const rootItems: Array<{ name: string; type: number }> = [];
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
  const sequence = { name: "Seq", getPlayerPosition: async () => ({ seconds: 3 }) };
  const p = {
    Project: { getActiveProject: async () => project },
    ProjectItem: { TYPE_BIN, TYPE_CLIP, TYPE_FILE: 99 },
    FolderItem: { cast: () => bin },
    ClipProjectItem: { cast: (it: { path: string }) => ({ getMediaFilePath: async () => it.path }) },
    TickTime: { createWithSeconds: (s: number) => ({ seconds: s }) },
    SequenceEditor: {
      getEditor: () => ({
        createOverwriteItemAction: (item: { path: string }) => guard({ run: () => log.push(`overwrite ${item.path}`) }),
        createInsertProjectItemAction: (item: { path: string }) => guard({ run: () => log.push(`insert ${item.path}`) }),
      }),
    },
  };
  return { adapter: new PremiereAdapter(p as never, "26.0.0"), log, binItems };
}

describe("PremiereAdapter", () => {
  it("cria e executa as ações dentro do lockedAccess", async () => {
    const { adapter, log } = fakePremiere();
    const r = await adapter.insertMedia("C:\\MotionHub\\icone.mov", { at: "playhead", mode: "overwrite", videoTrack: 1, audioTrack: 0 } as never, "Ícone");
    expect(r.trackItems).toBe(1);
    expect(log).toEqual(["Motion Hub: criar pasta", "overwrite C:\\MotionHub\\icone.mov", "Motion Hub: inserir Ícone"]);
  });

  it("reaproveita o arquivo já importado", async () => {
    const { adapter, binItems } = fakePremiere();
    const opts = { at: "playhead", mode: "insert", videoTrack: 0, audioTrack: 0 } as never;
    await adapter.insertMedia("C:/a.mov", opts, "A");
    await adapter.insertMedia("c:\\A.MOV", opts, "A");
    expect(binItems).toHaveLength(1);
  });

  it("'Requires locked access' não é confundido com faixa bloqueada", () => {
    expect(mapHostError(new Error("Requires locked access")).code).toBe("host_api_error");
    expect(mapHostError(new Error("Track is locked")).code).toBe("track_locked");
  });
});
