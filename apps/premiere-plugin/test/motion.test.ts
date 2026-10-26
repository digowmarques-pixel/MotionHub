import { describe, expect, it } from "vitest";
import { MOTION_PRESETS, getMotionPreset, type AnimPreset, type LoopPreset, type TransitionPreset } from "../src/core/motion/presets.js";
import { keyframeCount, planAnim, planLoop, planTransition, simplify } from "../src/core/motion/plan.js";
import { ease } from "../src/core/motion/easing.js";
import { MotionApplier } from "../src/host/premiere-motion.js";

const anim = (id: string) => getMotionPreset(id) as AnimPreset;

describe("presets de movimento", () => {
  it("ids únicos e todo preset gera keyframes", () => {
    expect(new Set(MOTION_PRESETS.map((p) => p.id)).size).toBe(MOTION_PRESETS.length);
    for (const p of MOTION_PRESETS) {
      const n = p.kind === "anim" ? keyframeCount(planAnim(p, "both", p.duration, 30)) : p.kind === "loop" ? keyframeCount(planLoop(p, 3, 30)) : keyframeCount(planTransition(p, p.duration, 30).a) + keyframeCount(planTransition(p, p.duration, 30).b);
      expect(n, p.id).toBeGreaterThan(1);
    }
  });

  it("entradas terminam no estado normal e saídas começam nele", () => {
    for (const p of MOTION_PRESETS.filter((x): x is AnimPreset => x.kind === "anim")) {
      const end = p.f(p.ease(1), p.duration);
      for (const [k, v] of Object.entries(end)) {
        if (k === "dblurDir") continue;
        const id = k === "scale" || k === "opacity" ? 100 : 0;
        expect(Math.abs(v - id), `${p.id}.${k}`).toBeLessThan(1e-6);
      }
    }
  });

  it("curvas começam em 0 e terminam em 1", () => {
    for (const [name, f] of Object.entries(ease)) {
      expect(Math.abs(f(0)), name).toBeLessThan(1e-9);
      expect(Math.abs(f(1) - 1), name).toBeLessThan(1e-9);
    }
  });
});

describe("plano de keyframes", () => {
  it("Zoom Punch: escala 300→100 e desfoque, no começo do clipe", () => {
    const m = planAnim(anim("zoom-punch"), "in", 0.5, 30);
    expect(m.effects).toEqual(["transform", "gaussian"]);
    const scale = m.segments[0]!.tracks.find((t) => t.param === "transform.scale")!;
    expect(scale.values[0]).toBe(300);
    expect(scale.values.at(-1)).toBe(100);
    expect(m.segments[0]!.anchor).toBe("start");
    expect(m.statics.shutter).toBe(180);
  });

  it("Saída é a entrada ao contrário, ancorada no fim", () => {
    const m = planAnim(anim("slide-esquerda"), "out", 0.6, 30);
    const pos = m.segments[0]!.tracks[0]!;
    expect(m.segments[0]!.anchor).toBe("end");
    expect(pos.values[0]).toEqual([0, 0]);
    expect(pos.values.at(-1)).toEqual([-1, 0]);
  });

  it("Entrada + Saída gera dois trechos", () => {
    expect(planAnim(anim("fade"), "both", 0.5, 25).segments.map((s) => s.anchor)).toEqual(["start", "end"]);
  });

  it("sem desfoque de movimento o obturador fica em 0", () => {
    expect(planAnim(anim("zoom-pop"), "in", 0.5, 30, false).statics.shutter).toBe(0);
  });

  it("simplificação remove keyframes de trechos lineares", () => {
    const tr = simplify({ param: "transform.scale", times: [0, 1, 2, 3, 4], values: [0, 25, 50, 75, 100] });
    expect(tr.times).toEqual([0, 4]);
  });

  it("canal constante no valor normal não vira keyframe", () => {
    const m = planAnim(anim("slide-esquerda"), "in", 0.6, 30);
    expect(m.segments[0]!.tracks.map((t) => t.param)).toEqual(["transform.position"]);
  });

  it("transição: A termina no fim, B começa no início", () => {
    const t = planTransition(getMotionPreset("tr-whip-esquerda") as TransitionPreset, 0.3, 30);
    expect(t.a.segments[0]!.anchor).toBe("end");
    expect(t.b.segments[0]!.anchor).toBe("start");
    expect(t.a.effects).toEqual(["offset", "directional"]);
    expect(t.a.statics.directionalDir).toBe(90);
  });

  it("tremida cobre o clipe inteiro", () => {
    const m = planLoop(getMotionPreset("tremida-media") as LoopPreset, 10, 30);
    expect(m.segments[0]!.duration).toBeCloseTo(10, 5);
    expect(m.segments[0]!.tracks.find((t) => t.param === "transform.position")!.times.at(-1)).toBeCloseTo(10, 5);
  });
});

// ---------- Premiere falso para o aplicador ----------
class T {
  constructor(readonly seconds: number) {}
  add(o: T) { return new T(this.seconds + o.seconds); }
}

function fakePremiere(opts: { selected?: Array<{ start: number; dur: number; inPt?: number; track?: number }>; posPx?: boolean; only?: number[] } = {}) {
  let locked = false;
  const guard = <V>(v: V): V => { if (!locked) throw new Error("Requires locked access"); return v; };
  const undo: string[] = [];
  type Param = { displayName: string; value: unknown; timeVarying: boolean; keys: Array<{ t: number; v: unknown }> };
  const PARAMS: Record<string, string[]> = {
    "AE.ADBE Geometry2": ["Ponto de ancoragem", "Posição", "Escala uniforme", "Escala", "Largura da escala", "Inclinação", "Eixo de inclinação", "Rotação", "Opacidade", "Usar ângulo do obturador da composição", "Ângulo do obturador", "Amostragem"],
    "AE.ADBE Gaussian Blur 2": ["Intensidade do desfoque", "Dimensões do desfoque", "Repetir pixels de borda"],
    "AE.ADBE Motion Blur": ["Direção", "Comprimento do desfoque"],
    "AE.ADBE Basic 3D": ["Girar", "Inclinar", "Distância da imagem"],
    "AE.ADBE Offset": ["Deslocar centro para", "Mesclar com original"],
  };
  const mkComp = (match: string) => {
    const params: Param[] = (PARAMS[match] ?? []).map((n) => ({ displayName: n, value: n.startsWith("Posi") || n.startsWith("Deslocar") ? (opts.posPx ? { x: 960, y: 540 } : { x: 0.5, y: 0.5 }) : 0, timeVarying: false, keys: [] }));
    return {
      match, params,
      getMatchName: async () => match,
      getParamCount: () => guard(params.length),
      getParam: (i: number) => guard(wrap(params[i]!)),
    };
  };
  const wrap = (p: Param) => ({
    displayName: p.displayName,
    getStartValue: async () => ({ value: { value: p.value } }),
    createKeyframe: (v: unknown) => { const k = { v, position: null as T | null }; return k; },
    createSetValueAction: (k: { v: unknown }) => guard({ run: () => { p.value = k.v; } }),
    createSetTimeVaryingAction: (on: boolean) => guard({ run: () => { p.timeVarying = on; } }),
    createAddKeyframeAction: (k: { v: unknown; position: T }) => guard({ run: () => { p.keys.push({ t: k.position.seconds, v: k.v }); } }),
  });
  const clips = (opts.selected ?? [{ start: 10, dur: 5, inPt: 2 }]).map((c) => {
    const comps = [mkComp("AE.ADBE Motion"), mkComp("AE.ADBE Opacity")];
    return {
      comps,
      getStartTime: async () => new T(c.start),
      getEndTime: async () => new T(c.start + c.dur),
      getInPoint: async () => new T(c.inPt ?? 0),
      getDuration: async () => new T(c.dur),
      getTrackIndex: async () => c.track ?? 0,
      createAddVideoTransitionAction: () => null,
      getComponentChain: async () => ({
        getComponentCount: () => guard(comps.length),
        getComponentAtIndex: (i: number) => guard(comps[i]),
        createAppendComponentAction: (c2: { match: string }) => guard({ run: () => comps.push(mkComp(c2.match)) }),
      }),
    };
  });
  const project = {
    lockedAccess: (fn: () => void) => { locked = true; try { fn(); } finally { locked = false; } },
    executeTransaction: (fn: (c: { addAction(a: { run(): void }): void }) => void, name: string) => {
      guard(0);
      const acts: Array<{ run(): void }> = [];
      fn({ addAction: (a) => acts.push(a) });
      for (const a of acts) a.run();
      undo.push(name);
      return true;
    },
  };
  const sequence = {
    getSelection: async () => ({ getTrackItems: async () => (opts.only ? clips.filter((_, i) => opts.only!.includes(i)) : clips) }),
    getVideoTrack: async () => ({ getTrackItems: () => clips }),
  };
  const p = {
    Constants: { TrackItemType: { CLIP: 1 } },
    TickTime: { createWithSeconds: (s: number) => new T(s) },
    PointF: class { constructor(readonly x: number, readonly y: number) {} },
    VideoFilterFactory: {
      getMatchNames: async () => Object.keys(PARAMS),
      createComponent: async (match: string) => ({ match }),
    },
  };
  const param = (clip: number, match: string, name: string) => clips[clip]!.comps.find((c) => c.match === match)!.params.find((pp) => pp.displayName === name)!;
  return { applier: new MotionApplier(p as never), project, sequence, clips, undo, param };
}

const frame = { width: 1920, height: 1080, fps: 30 };

describe("aplicador no Premiere", () => {
  it("Zoom Punch: adiciona Transformar + Desfoque e grava keyframes a partir do ponto de entrada do clipe", async () => {
    const f = fakePremiere();
    const m = planAnim(anim("zoom-punch"), "in", 0.5, 30);
    const r = await f.applier.apply(f.project as never, f.sequence as never, { kind: "each", label: "Zoom Punch", build: () => m }, frame);
    expect(f.clips[0]!.comps.map((c) => c.match)).toEqual(["AE.ADBE Motion", "AE.ADBE Opacity", "AE.ADBE Geometry2", "AE.ADBE Gaussian Blur 2"]);
    const scale = f.param(0, "AE.ADBE Geometry2", "Escala");
    expect(scale.timeVarying).toBe(true);
    expect(scale.keys[0]).toEqual({ t: 2, v: 300 });
    expect(scale.keys.at(-1)!.t).toBeCloseTo(2.5, 5);
    expect(f.param(0, "AE.ADBE Geometry2", "Ângulo do obturador").value).toBe(180);
    expect(f.param(0, "AE.ADBE Geometry2", "Usar ângulo do obturador da composição").value).toBe(false);
    expect(f.param(0, "AE.ADBE Gaussian Blur 2", "Repetir pixels de borda").value).toBe(true);
    expect(r).toMatchObject({ clips: 1, undoSteps: 2, warnings: [] });
    expect(r.keyframes).toBeGreaterThan(4);
  });

  it("Saída grava no fim do clipe; posição convertida para pixels quando o Premiere usa px", async () => {
    const f = fakePremiere({ posPx: true });
    const m = planAnim(anim("slide-esquerda"), "out", 0.5, 30);
    await f.applier.apply(f.project as never, f.sequence as never, { kind: "each", label: "Slide", build: () => m }, frame);
    const pos = f.param(0, "AE.ADBE Geometry2", "Posição");
    expect(pos.keys[0]!.t).toBeCloseTo(2 + 4.5, 5);
    expect(pos.keys.at(-1)!.v).toMatchObject({ x: 960 - 1920, y: 540 });
  });

  it("transição com um clipe selecionado usa o próximo da mesma faixa", async () => {
    const f = fakePremiere({ selected: [{ start: 0, dur: 4 }, { start: 4, dur: 4 }], only: [0] });
    const t = planTransition(getMotionPreset("tr-zoom-in") as TransitionPreset, 0.4, 30);
    const r = await f.applier.apply(f.project as never, f.sequence as never, { kind: "pair", label: "Zoom", ...t }, frame);
    expect(r.clips).toBe(2);
    const a = f.param(0, "AE.ADBE Geometry2", "Escala").keys, b = f.param(1, "AE.ADBE Geometry2", "Escala").keys;
    expect(a[0]!.t).toBeCloseTo(4 - 0.4, 5);
    expect(a.at(-1)!.v).toBe(300);
    expect(b[0]).toEqual({ t: 0, v: 300 });
  });

  it("sem clipes selecionados, avisa", async () => {
    const f = fakePremiere({ selected: [] });
    await expect(f.applier.apply(f.project as never, f.sequence as never, { kind: "each", label: "x", build: () => planAnim(anim("fade"), "in", 0.5, 30) }, frame)).rejects.toThrow(/Selecione/);
  });
});
