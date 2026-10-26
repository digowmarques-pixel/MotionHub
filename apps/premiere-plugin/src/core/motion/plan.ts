/**
 * Converte um preset em trilhas de keyframes por parâmetro de efeito (puro, sem Premiere).
 * O adaptador do host só traduz unidades e cria os keyframes.
 */
import { CHANNELS, IDENTITY, type AnimPreset, type Channel, type LoopPreset, type MotionFn, type MotionValues, type TransitionPreset } from "./presets.js";
import type { Ease } from "./easing.js";

export type MotionMode = "in" | "out" | "both";
export type EffectKey = "offset" | "transform" | "basic3d" | "gaussian" | "directional";
/** Ordem em que os efeitos entram no clipe (o deslocamento com repetição vem antes do Transformar). */
export const EFFECT_ORDER: EffectKey[] = ["offset", "transform", "basic3d", "gaussian", "directional"];

export type ParamKey =
  | "offset.shift"
  | "transform.position" | "transform.scale" | "transform.rotation" | "transform.opacity"
  | "basic3d.swivel" | "basic3d.tilt"
  | "gaussian.blurriness"
  | "directional.length";

export interface Track {
  param: ParamKey;
  /** Segundos a partir do início do clipe (âncora "start") ou do início do trecho final (âncora "end"). */
  times: number[];
  /** Números, ou pares [x, y] em fração do quadro para posição/deslocamento. */
  values: Array<number | [number, number]>;
}
export interface Segment {
  anchor: "start" | "end";
  duration: number;
  tracks: Track[];
}
export interface ClipMotion {
  effects: EffectKey[];
  segments: Segment[];
  /** Valores fixos (sem keyframe). */
  statics: { shutter: number; directionalDir?: number };
}

const PARAM_OF: Record<Exclude<Channel, "dblurDir">, { param: ParamKey; axis?: 0 | 1 }> = {
  x: { param: "transform.position", axis: 0 },
  y: { param: "transform.position", axis: 1 },
  scale: { param: "transform.scale" },
  rot: { param: "transform.rotation" },
  opacity: { param: "transform.opacity" },
  blur: { param: "gaussian.blurriness" },
  dblur: { param: "directional.length" },
  swivel: { param: "basic3d.swivel" },
  tilt: { param: "basic3d.tilt" },
  ox: { param: "offset.shift", axis: 0 },
  oy: { param: "offset.shift", axis: 1 },
};
export const EFFECT_OF = (p: ParamKey) => p.split(".")[0] as EffectKey;

/** Tolerância para remover keyframes redundantes (interpolação linear entre vizinhos). */
const EPS: Record<ParamKey, number> = {
  "offset.shift": 0.0005, "transform.position": 0.0005, "transform.scale": 0.05, "transform.rotation": 0.05, "transform.opacity": 0.5,
  "basic3d.swivel": 0.1, "basic3d.tilt": 0.1, "gaussian.blurriness": 0.3, "directional.length": 0.5,
};

type Sample = { t: number; v: MotionValues };

function sampleSegment(frames: number, fps: number, at: (i: number) => MotionValues): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i <= frames; i++) out.push({ t: i / fps, v: at(i) });
  return out;
}

const frameCount = (sec: number, fps: number) => Math.max(2, Math.round(sec * fps));

function toTracks(samples: Sample[]): { tracks: Track[]; dir?: number } {
  const used = new Set<Channel>();
  for (const s of samples) for (const k of Object.keys(s.v) as Channel[]) if (s.v[k] !== undefined && Number.isFinite(s.v[k])) used.add(k);
  // Canal que fica sempre no valor normal não vira keyframe.
  for (const c of [...used]) if (c !== "dblurDir" && samples.every((s) => Math.abs((s.v[c] ?? IDENTITY[c]) - IDENTITY[c]) < 1e-9)) used.delete(c);
  const dir = used.has("dblurDir") ? samples.find((s) => s.v.dblurDir !== undefined)?.v.dblurDir : undefined;
  used.delete("dblurDir");

  const byParam = new Map<ParamKey, Channel[]>();
  for (const c of CHANNELS) {
    if (!used.has(c) || c === "dblurDir") continue;
    const { param } = PARAM_OF[c];
    byParam.set(param, [...(byParam.get(param) ?? []), c]);
  }
  const tracks: Track[] = [];
  for (const [param, chans] of byParam) {
    const isPoint = param === "transform.position" || param === "offset.shift";
    const vals = samples.map((s) => {
      // "+ 0" troca -0 por 0.
      if (!isPoint) return (s.v[chans[0]!] ?? IDENTITY[chans[0]!]) + 0;
      const pair: [number, number] = [0, 0];
      for (const c of chans) pair[PARAM_OF[c as Exclude<Channel, "dblurDir">].axis!] = (s.v[c] ?? 0) + 0;
      return pair;
    });
    tracks.push(simplify({ param, times: samples.map((s) => round(s.t)), values: vals }));
  }
  return { tracks, dir };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Remove keyframes que a interpolação linear entre os vizinhos já reproduz. */
export function simplify(tr: Track): Track {
  const eps = EPS[tr.param];
  const n = tr.times.length;
  if (n <= 2) return tr;
  const comps = (v: number | [number, number]) => (typeof v === "number" ? [v] : v);
  const keep = [0];
  let a = 0;
  for (let j = 2; j < n; j++) {
    // Tenta ligar a→j; se algum ponto do meio desviar, mantém j-1.
    let ok = true;
    for (let m = a + 1; m < j && ok; m++) {
      const f = (tr.times[m]! - tr.times[a]!) / (tr.times[j]! - tr.times[a]!);
      const va = comps(tr.values[a]!), vj = comps(tr.values[j]!), vm = comps(tr.values[m]!);
      for (let k = 0; k < va.length; k++) if (Math.abs(va[k]! + (vj[k]! - va[k]!) * f - vm[k]!) > eps) ok = false;
    }
    if (!ok) {
      keep.push(j - 1);
      a = j - 1;
    }
  }
  keep.push(n - 1);
  return { param: tr.param, times: keep.map((i) => tr.times[i]!), values: keep.map((i) => tr.values[i]!) };
}

function segmentFor(anchor: "start" | "end", duration: number, fps: number, e: Ease, f: MotionFn, reverse: boolean): { seg: Segment; dir?: number } {
  const n = frameCount(duration, fps);
  const d = n / fps;
  const samples = sampleSegment(n, fps, (i) => {
    const step = reverse ? n - i : i;
    return f(e(step / n), step / fps);
  });
  const { tracks, dir } = toTracks(samples);
  return { seg: { anchor, duration: d, tracks }, dir };
}

function finish(parts: Array<{ seg: Segment; dir?: number }>, shutter: number): ClipMotion {
  const segments = parts.map((p) => p.seg).filter((s) => s.tracks.length);
  const effects = EFFECT_ORDER.filter((e) => segments.some((s) => s.tracks.some((t) => EFFECT_OF(t.param) === e)));
  const dir = parts.find((p) => p.dir !== undefined)?.dir;
  return { effects, segments, statics: { shutter: effects.includes("transform") ? shutter : 0, directionalDir: dir } };
}

export function planAnim(p: AnimPreset, mode: MotionMode, duration: number, fps: number, motionBlur = true): ClipMotion {
  const parts = [];
  if (mode !== "out") parts.push(segmentFor("start", duration, fps, p.ease, p.f, false));
  if (mode !== "in") parts.push(segmentFor("end", duration, fps, p.ease, p.f, true));
  return finish(parts, motionBlur ? p.shutter ?? 0 : 0);
}

/** Efeito contínuo: amostra o clipe inteiro (a cada 2 quadros em clipes longos). */
export function planLoop(p: LoopPreset, clipDuration: number, fps: number, motionBlur = true): ClipMotion {
  const total = Math.max(2, Math.round(clipDuration * fps));
  const step = total > 900 ? 3 : total > 300 ? 2 : 1;
  const samples: Sample[] = [];
  for (let i = 0; i <= total; i += step) samples.push({ t: i / fps, v: p.f(i / fps, i) });
  if (samples[samples.length - 1]!.t < total / fps) samples.push({ t: total / fps, v: p.f(total / fps, total) });
  const { tracks, dir } = toTracks(samples);
  return finish([{ seg: { anchor: "start", duration: total / fps, tracks }, dir }], motionBlur ? p.shutter ?? 0 : 0);
}

export function planTransition(p: TransitionPreset, duration: number, fps: number, motionBlur = true): { a: ClipMotion; b: ClipMotion } {
  const shutter = motionBlur ? p.shutter ?? 0 : 0;
  return {
    a: finish([segmentFor("end", duration, fps, p.a.ease, p.a.f, false)], shutter),
    b: finish([segmentFor("start", duration, fps, p.b.ease, p.b.f, false)], shutter),
  };
}

export const keyframeCount = (m: ClipMotion) => m.segments.reduce((n, s) => n + s.tracks.reduce((k, t) => k + t.times.length, 0), 0);
