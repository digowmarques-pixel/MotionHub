/**
 * Aplica presets de movimento (core/motion) em clipes da timeline do Premiere:
 * adiciona efeitos nativos (Transformar, Desfoque gaussiano, Desfoque direcional,
 * 3D básico, Deslocamento) e cria os keyframes já calculados.
 *
 * Pontos a confirmar em Premiere real estão no `details` do resultado (efeitos e unidades).
 */
import type { premierepro } from "@adobe/premierepro";
import type { Action, ComponentParam, Project, Sequence, TickTime } from "@adobe/premierepro";
import { ApplyError } from "@motionhub/shared";
import { EFFECT_OF, type ClipMotion, type EffectKey, type ParamKey } from "../core/motion/plan.js";
import type { MotionJob, MotionResult } from "./types.js";
import { normalizeName } from "./premiere.js";

type Ppro = premierepro;

export const EFFECT_MATCH: Record<EffectKey, string> = {
  offset: "AE.ADBE Offset",
  transform: "AE.ADBE Geometry2",
  basic3d: "AE.ADBE Basic 3D",
  gaussian: "AE.ADBE Gaussian Blur 2",
  directional: "AE.ADBE Motion Blur",
};
const EFFECT_LABEL: Record<EffectKey, string> = {
  offset: "Deslocamento", transform: "Transformar", basic3d: "3D básico", gaussian: "Desfoque gaussiano", directional: "Desfoque direcional",
};

/** Nome do parâmetro (inglês/português, normalizado) e índice de reserva. */
const PARAM_LOOKUP: Record<ParamKey | "transform.uniform" | "transform.compShutter" | "transform.shutter" | "gaussian.repeat" | "directional.direction", { names: string[]; index: number }> = {
  "offset.shift": { names: ["shiftcenterto", "deslocarcentropara", "deslocarocentropara"], index: 0 },
  "transform.position": { names: ["position", "posicao"], index: 1 },
  "transform.uniform": { names: ["uniformscale", "escalauniforme"], index: 2 },
  "transform.scale": { names: ["scale", "escala", "scaleheight", "alturadaescala", "alturadeescala"], index: 3 },
  "transform.rotation": { names: ["rotation", "rotacao"], index: 7 },
  "transform.opacity": { names: ["opacity", "opacidade"], index: 8 },
  "transform.compShutter": { names: ["usecompositionsshutterangle", "usarangulodoobturadordacomposicao", "usarangulodoobturadordasequencia"], index: 9 },
  "transform.shutter": { names: ["shutterangle", "angulodoobturador"], index: 10 },
  "basic3d.swivel": { names: ["swivel", "girar", "giro"], index: 0 },
  "basic3d.tilt": { names: ["tilt", "inclinar", "inclinacao"], index: 1 },
  "gaussian.blurriness": { names: ["blurriness", "intensidadedodesfoque", "desfoque", "nivelededesfoque"], index: 0 },
  "gaussian.repeat": { names: ["repeatedgepixels", "repetirpixelsdeborda", "repetirpixelsdaborda"], index: 2 },
  "directional.direction": { names: ["direction", "direcao"], index: 0 },
  "directional.length": { names: ["blurlength", "comprimentododesfoque", "comprimento"], index: 1 },
};
type LookupKey = keyof typeof PARAM_LOOKUP;

type Comp = { getMatchName(): Promise<string>; getParamCount(): number; getParam(i: number): ComponentParam };
type Chain = { getComponentCount(): number; getComponentAtIndex(i: number): Comp; createAppendComponentAction(c: unknown): Action };
export type ClipItem = {
  getStartTime(): Promise<TickTime>;
  getEndTime(): Promise<TickTime>;
  getInPoint(): Promise<TickTime>;
  getDuration(): Promise<TickTime>;
  getTrackIndex(): Promise<number>;
  getName?(): Promise<string>;
  getComponentChain(): Promise<Chain>;
};

export class MotionApplier {
  private available: Set<string> | null = null;

  constructor(private readonly p: Ppro) {}

  private tx(project: Project, build: () => Action[], undo: string): void {
    let ok = false;
    project.lockedAccess(() => {
      const actions = build();
      if (!actions.length) {
        ok = true;
        return;
      }
      ok = project.executeTransaction((c) => {
        for (const a of actions) c.addAction(a);
      }, undo);
    });
    if (!ok) throw new ApplyError("host_api_error", `O Premiere recusou a operação "${undo}".`);
  }

  async selectedVideoClips(sequence: Sequence): Promise<ClipItem[]> {
    const sel = await sequence.getSelection();
    const items = (await sel.getTrackItems()) as unknown[];
    const Video = (this.p as unknown as { VideoClipTrackItem?: new () => unknown }).VideoClipTrackItem;
    const vids = items.filter((it) => (Video ? it instanceof Video : typeof (it as { createAddVideoTransitionAction?: unknown }).createAddVideoTransitionAction === "function")) as ClipItem[];
    const withStart = await Promise.all(vids.map(async (c) => ({ c, s: (await c.getStartTime()).seconds, t: await c.getTrackIndex() })));
    return withStart.sort((a, b) => a.s - b.s || a.t - b.t).map((x) => x.c);
  }

  /** Clipe que começa exatamente onde `clip` termina, na mesma faixa (para transição com um clipe só). */
  private async nextOnTrack(sequence: Sequence, clip: ClipItem): Promise<ClipItem | null> {
    const track = await sequence.getVideoTrack(await clip.getTrackIndex());
    const end = (await clip.getEndTime()).seconds;
    const items = (await track.getTrackItems(this.p.Constants.TrackItemType.CLIP, false)) as unknown as ClipItem[];
    for (const it of items) if (Math.abs((await it.getStartTime()).seconds - end) < 0.02) return it;
    return null;
  }

  async apply(project: Project, sequence: Sequence, job: MotionJob, frame: { width: number; height: number; fps: number }): Promise<MotionResult> {
    let clips = await this.selectedVideoClips(sequence);
    if (!clips.length) throw new ApplyError("unsupported", "Selecione um ou mais clipes de vídeo na timeline.");
    const result: MotionResult = { clips: 0, keyframes: 0, warnings: [], undoSteps: 0, details: "" };
    const details = new Set<string>();

    const work: Array<{ clip: ClipItem; motion: ClipMotion }> = [];
    if (job.kind === "each") {
      for (const clip of clips) work.push({ clip, motion: job.build({ duration: (await clip.getDuration()).seconds, fps: frame.fps }) });
    } else {
      if (clips.length === 1) {
        const next = await this.nextOnTrack(sequence, clips[0]!);
        if (!next) throw new ApplyError("unsupported", "Para transição, selecione os dois clipes da emenda (ou um clipe que tenha outro logo depois na mesma faixa).");
        clips = [clips[0]!, next];
      }
      for (let i = 0; i < clips.length; i++) {
        if (i < clips.length - 1) work.push({ clip: clips[i]!, motion: job.a });
        if (i > 0) work.push({ clip: clips[i]!, motion: job.b });
      }
    }

    for (const w of work) {
      const n = await this.applyToClip(project, w.clip, w.motion, frame, job.label, result.warnings, details);
      if (n >= 0) {
        result.keyframes += n;
        result.undoSteps += 2;
      }
    }
    result.clips = new Set(work.map((w) => w.clip)).size;
    result.warnings = [...new Set(result.warnings)];
    result.details = [...details].join(" · ");
    return result;
  }

  private async matchNames(): Promise<Set<string>> {
    if (!this.available) {
      try {
        this.available = new Set(await this.p.VideoFilterFactory.getMatchNames());
      } catch {
        this.available = new Set(Object.values(EFFECT_MATCH));
      }
    }
    return this.available;
  }

  /** Devolve quantos keyframes criou, ou -1 se nada foi feito. */
  private async applyToClip(project: Project, clip: ClipItem, m: ClipMotion, frame: { width: number; height: number }, label: string, warnings: string[], details: Set<string>): Promise<number> {
    if (!m.effects.length) return -1;
    const avail = await this.matchNames();
    const effects = m.effects.filter((e) => {
      if (avail.has(EFFECT_MATCH[e])) return true;
      warnings.push(`O efeito "${EFFECT_LABEL[e]}" não existe neste Premiere; essa parte do movimento foi ignorada.`);
      return false;
    });
    if (!effects.length) return -1;

    // 1) Adiciona os efeitos (uma etapa de Desfazer).
    const chain = await clip.getComponentChain();
    const created: unknown[] = [];
    for (const e of effects) created.push(await this.p.VideoFilterFactory.createComponent(EFFECT_MATCH[e]));
    this.tx(project, () => created.map((c) => chain.createAppendComponentAction(c)), `Motion Hub: efeitos de ${label}`);

    // 2) Localiza os efeitos recém-adicionados (os últimos da pilha, de trás para frente).
    const chain2 = await clip.getComponentChain();
    const comps: Comp[] = [];
    project.lockedAccess(() => {
      for (let i = 0; i < chain2.getComponentCount(); i++) comps.push(chain2.getComponentAtIndex(i));
    });
    const found = new Map<EffectKey, ComponentParam[]>();
    for (let i = comps.length - 1, k = effects.length - 1; i >= 0 && k >= 0; i--) {
      if ((await comps[i]!.getMatchName()) !== EFFECT_MATCH[effects[k]!]) continue;
      const params: ComponentParam[] = [];
      const comp = comps[i]!;
      project.lockedAccess(() => {
        for (let j = 0; j < comp.getParamCount(); j++) params.push(comp.getParam(j));
      });
      found.set(effects[k]!, params);
      k--;
    }
    const param = (key: LookupKey): ComponentParam | null => {
      const list = found.get(key.split(".")[0] as EffectKey);
      if (!list) return null;
      const { names, index } = PARAM_LOOKUP[key];
      return list.find((pp) => names.includes(normalizeName(pp.displayName))) ?? list[index] ?? null;
    };
    for (const e of effects) details.add(found.has(e) ? `${EFFECT_LABEL[e]} ✓` : `${EFFECT_LABEL[e]} não localizado`);

    // 3) Unidades: posição em pixels ou normalizada (0–1)?
    const pointUnits = async (pp: ComponentParam | null): Promise<{ cx: number; cy: number; sx: number; sy: number } | null> => {
      if (!pp) return null;
      const v = await readPoint(pp);
      if (!v) return { cx: 0.5, cy: 0.5, sx: 1, sy: 1 };
      const px = v.x > 2 || v.y > 2;
      details.add(`posição em ${px ? "px" : "0–1"}`);
      return px ? { cx: v.x, cy: v.y, sx: frame.width, sy: frame.height } : { cx: v.x, cy: v.y, sx: 1, sy: 1 };
    };
    const pos = await pointUnits(param("transform.position"));
    const off = await pointUnits(param("offset.shift"));
    const pxScale = Math.min(frame.width, frame.height) / 1080;

    const clipIn = await clip.getInPoint();
    const clipDur = (await clip.getDuration()).seconds;
    const T = (s: number) => this.p.TickTime.createWithSeconds(s);

    const makers: Array<() => Action> = [];
    const setStatic = (key: LookupKey, v: number | boolean) => {
      const pp = param(key);
      if (pp) makers.push(() => pp.createSetValueAction(pp.createKeyframe(v), true));
    };
    if (effects.includes("transform")) {
      setStatic("transform.uniform", true);
      if (m.statics.shutter > 0) {
        setStatic("transform.compShutter", false);
        setStatic("transform.shutter", m.statics.shutter);
      }
    }
    if (effects.includes("gaussian")) setStatic("gaussian.repeat", true);
    if (effects.includes("directional") && m.statics.directionalDir !== undefined) setStatic("directional.direction", m.statics.directionalDir);

    let count = 0;
    const timeVarying = new Set<ComponentParam>();
    for (const seg of m.segments) {
      const base = seg.anchor === "start" ? 0 : Math.max(0, clipDur - seg.duration);
      for (const tr of seg.tracks) {
        if (!effects.includes(EFFECT_OF(tr.param))) continue;
        const pp = param(tr.param);
        if (!pp) {
          warnings.push(`Parâmetro ${tr.param} não encontrado.`);
          continue;
        }
        if (!timeVarying.has(pp)) {
          timeVarying.add(pp);
          makers.push(() => pp.createSetTimeVaryingAction(true));
        }
        tr.times.forEach((t, i) => {
          if (base + t > clipDur + 1e-6) return;
          const raw = tr.values[i]!;
          const value = this.toValue(tr.param, raw, pos, off, pxScale);
          const when = clipIn.add(T(base + t));
          makers.push(() => {
            const kf = pp.createKeyframe(value as never);
            kf.position = when;
            return pp.createAddKeyframeAction(kf);
          });
          count++;
        });
      }
    }
    this.tx(project, () => makers.map((mk) => mk()), `Motion Hub: ${label}`);
    return count;
  }

  private toValue(param: ParamKey, raw: number | [number, number], pos: Units | null, off: Units | null, pxScale: number): unknown {
    if (Array.isArray(raw)) {
      const u = (param === "offset.shift" ? off : pos) ?? { cx: 0.5, cy: 0.5, sx: 1, sy: 1 };
      return new this.p.PointF(u.cx + raw[0] * u.sx, u.cy + raw[1] * u.sy);
    }
    if (param === "gaussian.blurriness" || param === "directional.length") return raw * pxScale;
    return raw;
  }
}

type Units = { cx: number; cy: number; sx: number; sy: number };

async function readPoint(pp: ComponentParam): Promise<{ x: number; y: number } | null> {
  try {
    const k = (await pp.getStartValue()) as unknown as { value?: { value?: unknown } | unknown };
    const v = (k && typeof k === "object" && "value" in k ? (k.value as { value?: unknown }) : null) ?? null;
    const pt = (v && typeof v === "object" && "value" in v ? v.value : v) as { x?: number; y?: number } | null;
    return pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? { x: pt.x!, y: pt.y! } : null;
  } catch {
    return null;
  }
}
