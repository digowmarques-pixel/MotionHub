/**
 * Presets de movimento: animam o PRÓPRIO clipe (keyframes em efeitos nativos do Premiere),
 * em vez de inserir um vídeo por cima. Tudo é gerado por código, sem arquivos externos.
 *
 * Canais (valores "identidade" entre parênteses):
 *   x, y      deslocamento em fração do quadro (0)       → Transformar › Posição
 *   scale     escala em % (100)                          → Transformar › Escala
 *   rot       rotação em graus (0)                       → Transformar › Rotação
 *   opacity   opacidade 0–100 (100)                      → Transformar › Opacidade
 *   blur      desfoque em px a 1080p (0)                 → Desfoque gaussiano
 *   dblur     desfoque direcional em px a 1080p (0)      → Desfoque direcional (dblurDir = direção em graus)
 *   swivel, tilt  giro 3D em graus (0)                   → 3D básico
 *   ox, oy    deslocamento com repetição, fração do quadro (0) → Deslocamento (sem bordas pretas)
 */
import { ease, hashNoise, lerp, smoothNoise, type Ease } from "./easing.js";

export const CHANNELS = ["x", "y", "scale", "rot", "opacity", "blur", "dblur", "dblurDir", "swivel", "tilt", "ox", "oy"] as const;
export type Channel = (typeof CHANNELS)[number];
export type MotionValues = Partial<Record<Channel, number>>;
export const IDENTITY: Record<Channel, number> = { x: 0, y: 0, scale: 100, rot: 0, opacity: 100, blur: 0, dblur: 0, dblurDir: 0, swivel: 0, tilt: 0, ox: 0, oy: 0 };

export const MOTION_CATEGORIES = [
  ["zoom", "Zoom"],
  ["slide", "Deslizar"],
  ["rotate", "Rotação 2D"],
  ["rotate3d", "Rotação 3D"],
  ["blur", "Desfoque"],
  ["soft", "Suave"],
  ["elastic", "Elástico"],
  ["shake", "Tremida"],
  ["glitch", "Glitch e Flicker"],
  ["transition", "Transições"],
] as const;
export type MotionCategory = (typeof MOTION_CATEGORIES)[number][0];

/** f(p, t): p = progresso 0→1 rumo ao estado normal (já com a curva), t = segundos no trecho. */
export type MotionFn = (p: number, t: number) => MotionValues;

interface Base {
  id: string;
  name: string;
  category: MotionCategory;
  /** Duração padrão do trecho, em segundos. */
  duration: number;
  /** Desfoque de movimento (ângulo do obturador do Transformar). */
  shutter?: number;
  keywords?: string[];
}
/** Entrada/saída: f(0) = fora de cena, f(1) = normal. Saída = entrada ao contrário. */
export interface AnimPreset extends Base { kind: "anim"; ease: Ease; f: MotionFn }
/** Efeito contínuo no clipe inteiro (tremida, flicker). */
export interface LoopPreset extends Base { kind: "loop"; f: (t: number, frame: number) => MotionValues }
/** Transição entre dois clipes: saída no fim do clipe A, entrada no começo do clipe B. */
export interface TransitionPreset extends Base { kind: "transition"; a: { ease: Ease; f: MotionFn }; b: { ease: Ease; f: MotionFn } }
export type MotionPreset = AnimPreset | LoopPreset | TransitionPreset;

const inv = (p: number) => 1 - p;
const DIRS = [
  ["esquerda", -1, 0, 90],
  ["direita", 1, 0, 90],
  ["cima", 0, -1, 0],
  ["baixo", 0, 1, 0],
] as const;
const DIR_LABEL: Record<string, string> = { esquerda: "da esquerda", direita: "da direita", cima: "de cima", baixo: "de baixo" };

function anim(id: string, name: string, category: MotionCategory, e: Ease, f: MotionFn, duration = 0.6, shutter = 180, keywords: string[] = []): AnimPreset {
  return { kind: "anim", id, name, category, ease: e, f, duration, shutter, keywords };
}

function build(): MotionPreset[] {
  const out: MotionPreset[] = [];
  const add = (p: MotionPreset) => out.push(p);

  // ---------- Zoom ----------
  add(anim("zoom-pop", "Zoom Pop", "zoom", ease.outExpo, (p) => ({ scale: lerp(0, 100, p) })));
  add(anim("zoom-in-suave", "Zoom In Suave", "zoom", ease.outCubic, (p) => ({ scale: lerp(60, 100, p), opacity: lerp(0, 100, Math.min(1, p * 2)) }), 0.8));
  add(anim("zoom-out-entrada", "Zoom Out de Entrada", "zoom", ease.outExpo, (p) => ({ scale: lerp(180, 100, p) }), 0.7));
  add(anim("zoom-punch", "Zoom Punch", "zoom", ease.outExpo, (p) => ({ scale: lerp(300, 100, p), blur: lerp(40, 0, p) }), 0.5));
  add(anim("zoom-respiro", "Zoom Respiro", "zoom", ease.inOutCubic, (p) => ({ scale: lerp(112, 100, p) }), 1.2, 0));
  add(anim("zoom-desfocado", "Zoom com Desfoque", "zoom", ease.outQuint, (p) => ({ scale: lerp(140, 100, p), blur: lerp(60, 0, p), opacity: lerp(0, 100, Math.min(1, p * 3)) }), 0.7));

  // ---------- Deslizar ----------
  for (const [dir, dx, dy, bdir] of DIRS) {
    add(anim(`slide-${dir}`, `Deslizar ${DIR_LABEL[dir]}`, "slide", ease.outExpo, (p) => ({ x: dx * inv(p), y: dy * inv(p) })));
    add(anim(`slide-${dir}-desfoque`, `Deslizar ${DIR_LABEL[dir]} com Desfoque`, "slide", ease.outExpo, (p) => ({ x: dx * inv(p), y: dy * inv(p), dblur: 120 * inv(p) ** 0.7, dblurDir: bdir })));
    add(anim(`slide-${dir}-curto`, `Deslizar Curto ${DIR_LABEL[dir]}`, "soft", ease.outCubic, (p) => ({ x: dx * 0.15 * inv(p), y: dy * 0.15 * inv(p), opacity: lerp(0, 100, p) }), 0.7, 0));
    add(anim(`slide-${dir}-volta`, `Deslizar ${DIR_LABEL[dir]} com Rebote`, "elastic", ease.outBack, (p) => ({ x: dx * inv(p), y: dy * inv(p) }), 0.7));
    add(anim(`swipe-${dir}`, `Swipe ${DIR_LABEL[dir]} (sem bordas)`, "slide", ease.outExpo, (p) => ({ ox: dx * inv(p), oy: dy * inv(p), dblur: 150 * inv(p) ** 0.6, dblurDir: bdir }), 0.5));
  }

  // ---------- Rotação 2D ----------
  add(anim("giro-90", "Giro 90°", "rotate", ease.outExpo, (p) => ({ rot: lerp(-90, 0, p), scale: lerp(0, 100, p) })));
  add(anim("giro-90-anti", "Giro 90° Anti-horário", "rotate", ease.outExpo, (p) => ({ rot: lerp(90, 0, p), scale: lerp(0, 100, p) })));
  add(anim("giro-180", "Giro 180°", "rotate", ease.outExpo, (p) => ({ rot: lerp(-180, 0, p), scale: lerp(30, 100, p) }), 0.7));
  add(anim("giro-360", "Giro 360°", "rotate", ease.outQuint, (p) => ({ rot: lerp(-360, 0, p), scale: lerp(0, 100, p) }), 0.9));
  add(anim("inclinar-subir", "Inclinar e Subir", "rotate", ease.outBack, (p) => ({ rot: lerp(12, 0, p), y: lerp(0.4, 0, p), opacity: lerp(0, 100, Math.min(1, p * 2)) }), 0.7));
  add(anim("rolar-esquerda", "Rolar da Esquerda", "rotate", ease.outExpo, (p) => ({ x: lerp(-1.1, 0, p), rot: lerp(-120, 0, p) }), 0.8));
  add(anim("rolar-direita", "Rolar da Direita", "rotate", ease.outExpo, (p) => ({ x: lerp(1.1, 0, p), rot: lerp(120, 0, p) }), 0.8));
  add(anim("pendulo", "Pêndulo", "elastic", ease.outElastic, (p) => ({ rot: lerp(25, 0, p) }), 1.2, 90));

  // ---------- Rotação 3D ----------
  add(anim("flip-horizontal", "Virar na Horizontal", "rotate3d", ease.outExpo, (p) => ({ swivel: lerp(90, 0, p) }), 0.7, 0));
  add(anim("flip-horizontal-inv", "Virar na Horizontal (inverso)", "rotate3d", ease.outExpo, (p) => ({ swivel: lerp(-90, 0, p) }), 0.7, 0));
  add(anim("flip-vertical", "Virar na Vertical", "rotate3d", ease.outExpo, (p) => ({ tilt: lerp(90, 0, p) }), 0.7, 0));
  add(anim("flip-vertical-inv", "Virar na Vertical (inverso)", "rotate3d", ease.outExpo, (p) => ({ tilt: lerp(-90, 0, p) }), 0.7, 0));
  add(anim("porta", "Porta Abrindo", "rotate3d", ease.outBack, (p) => ({ swivel: lerp(75, 0, p), opacity: lerp(0, 100, Math.min(1, p * 2)) }), 0.8, 0));
  add(anim("balanco-3d", "Balanço 3D", "elastic", ease.outElastic, (p) => ({ swivel: lerp(60, 0, p) }), 1.2, 0));
  add(anim("cair-3d", "Cair em 3D", "rotate3d", ease.outBounce, (p) => ({ tilt: lerp(-80, 0, p) }), 1, 0));

  // ---------- Desfoque ----------
  add(anim("desfoque-entrada", "Desfoque de Entrada", "blur", ease.outCubic, (p) => ({ blur: lerp(80, 0, p) }), 0.7, 0));
  add(anim("desfoque-fade", "Desfoque com Fade", "blur", ease.outCubic, (p) => ({ blur: lerp(60, 0, p), opacity: lerp(0, 100, p) }), 0.8, 0));
  add(anim("desfoque-zoom", "Desfoque com Zoom", "blur", ease.outExpo, (p) => ({ blur: lerp(70, 0, p), scale: lerp(125, 100, p) }), 0.7, 0));
  add(anim("desfoque-vertical", "Desfoque Vertical", "blur", ease.outExpo, (p) => ({ dblur: lerp(200, 0, p), dblurDir: 0 }), 0.5, 0));
  add(anim("desfoque-horizontal", "Desfoque Horizontal", "blur", ease.outExpo, (p) => ({ dblur: lerp(200, 0, p), dblurDir: 90 }), 0.5, 0));

  // ---------- Suave ----------
  add(anim("fade", "Fade", "soft", ease.inOutCubic, (p) => ({ opacity: lerp(0, 100, p) }), 0.6, 0));
  add(anim("fade-escala", "Fade com Escala", "soft", ease.outCubic, (p) => ({ opacity: lerp(0, 100, p), scale: lerp(92, 100, p) }), 0.8, 0));
  add(anim("fade-subir", "Fade Subindo", "soft", ease.outQuint, (p) => ({ opacity: lerp(0, 100, p), y: lerp(0.08, 0, p) }), 0.8, 0));

  // ---------- Elástico ----------
  add(anim("pop-elastico", "Pop Elástico", "elastic", ease.outElastic, (p) => ({ scale: lerp(0, 100, p) }), 1, 0));
  add(anim("pop-rebote", "Pop com Rebote", "elastic", ease.outBack, (p) => ({ scale: lerp(0, 100, p) }), 0.6));
  add(anim("quicar", "Quicar de Cima", "elastic", ease.outBounce, (p) => ({ y: lerp(-1, 0, p) }), 1));

  // ---------- Tremida (clipe inteiro) ----------
  const shake = (id: string, name: string, amp: number, rot: number, speed: number, extraScale: number): LoopPreset => ({
    kind: "loop", id, name, category: "shake", duration: 0, shutter: 180,
    f: (t) => ({ x: amp * smoothNoise(t * speed, 1), y: amp * smoothNoise(t * speed, 2), rot: rot * smoothNoise(t * speed, 3), scale: 100 + extraScale }),
  });
  add(shake("camera-mao", "Câmera na Mão", 0.006, 0.4, 0.6, 3));
  add(shake("tremida-leve", "Tremida Leve", 0.01, 0.6, 1.2, 4));
  add(shake("tremida-media", "Tremida Média", 0.02, 1.2, 2, 6));
  add(shake("tremida-forte", "Tremida Forte", 0.035, 2.5, 3, 10));
  add(anim("impacto", "Impacto", "shake", ease.linear, (p, t) => {
    const a = (1 - p) ** 2;
    return { x: 0.04 * a * smoothNoise(t * 4, 7), y: 0.04 * a * smoothNoise(t * 4, 8), rot: 3 * a * smoothNoise(t * 4, 9), scale: 100 + 12 * a };
  }, 0.6));
  add(anim("terremoto", "Terremoto", "shake", ease.linear, (p, t) => {
    const a = 1 - p;
    return { x: 0.05 * a * smoothNoise(t * 6, 4), y: 0.05 * a * smoothNoise(t * 6, 5), dblur: 60 * a, dblurDir: 90, scale: 100 + 12 * a };
  }, 1));
  add({ kind: "loop", id: "pulso", name: "Pulso (batida)", category: "shake", duration: 0, shutter: 0,
    f: (t) => ({ scale: 100 + 5 * Math.max(0, 1 - ((t * 2) % 1) * 3) }) });

  // ---------- Glitch e Flicker ----------
  add({ kind: "loop", id: "flicker", name: "Flicker", category: "glitch", duration: 0, shutter: 0,
    f: (_t, i) => ({ opacity: hashNoise(i, 1) > 0.55 ? 35 : 100 }) });
  add({ kind: "loop", id: "glitch-continuo", name: "Glitch Contínuo", category: "glitch", duration: 0, shutter: 0,
    f: (_t, i) => {
      const on = hashNoise(Math.floor(i / 2), 3) > 0.6;
      return on ? { ox: 0.06 * hashNoise(i, 4), oy: 0.02 * hashNoise(i, 5), scale: 100 + 4 * Math.abs(hashNoise(i, 6)) } : { ox: 0, oy: 0, scale: 100 };
    } });
  add(anim("glitch-entrada", "Glitch de Entrada", "glitch", ease.linear, (p, t) => {
    const i = Math.round(t * 30);
    const on = p < 0.85 && hashNoise(i, 11) > -0.3;
    return on ? { ox: 0.15 * (1 - p) * hashNoise(i, 12), oy: 0.05 * (1 - p) * hashNoise(i, 13), opacity: hashNoise(i, 14) > 0.5 ? 60 : 100 } : { ox: 0, oy: 0, opacity: 100 };
  }, 0.5, 0));
  add(anim("flicker-entrada", "Flicker de Entrada", "glitch", ease.linear, (p, t) => ({ opacity: p > 0.9 || hashNoise(Math.round(t * 30), 21) > 0.2 - p ? lerp(30, 100, p) : 0 }), 0.6, 0));

  // ---------- Transições (fim do clipe A + começo do clipe B) ----------
  const tr = (id: string, name: string, duration: number, a: { ease: Ease; f: MotionFn }, b: { ease: Ease; f: MotionFn }, shutter = 180): TransitionPreset =>
    ({ kind: "transition", id, name, category: "transition", duration, shutter, a, b });
  add(tr("tr-zoom-in", "Zoom In", 0.4,
    { ease: ease.inExpo, f: (p) => ({ scale: lerp(100, 300, p), blur: lerp(0, 30, p) }) },
    { ease: ease.outExpo, f: (p) => ({ scale: lerp(300, 100, p), blur: lerp(30, 0, p) }) }));
  add(tr("tr-zoom-in-suave", "Zoom In Suave", 0.7,
    { ease: ease.inCubic, f: (p) => ({ scale: lerp(100, 180, p), blur: lerp(0, 20, p) }) },
    { ease: ease.outCubic, f: (p) => ({ scale: lerp(180, 100, p), blur: lerp(20, 0, p) }) }));
  add(tr("tr-zoom-giro", "Zoom com Giro", 0.5,
    { ease: ease.inExpo, f: (p) => ({ scale: lerp(100, 300, p), rot: lerp(0, 90, p), blur: lerp(0, 25, p) }) },
    { ease: ease.outExpo, f: (p) => ({ scale: lerp(300, 100, p), rot: lerp(-90, 0, p), blur: lerp(25, 0, p) }) }));
  add(tr("tr-giro-360", "Giro 360°", 0.6,
    { ease: ease.inExpo, f: (p) => ({ scale: lerp(100, 220, p), rot: lerp(0, 180, p) }) },
    { ease: ease.outExpo, f: (p) => ({ scale: lerp(220, 100, p), rot: lerp(-180, 0, p) }) }));
  for (const [dir, dx, dy, bdir] of DIRS) {
    add(tr(`tr-whip-${dir}`, `Whip para ${dir === "esquerda" ? "a Esquerda" : dir === "direita" ? "a Direita" : dir === "cima" ? "Cima" : "Baixo"}`, 0.3,
      { ease: ease.inExpo, f: (p) => ({ ox: -dx * 0.5 * p, oy: -dy * 0.5 * p, dblur: 220 * p, dblurDir: bdir }) },
      { ease: ease.outExpo, f: (p) => ({ ox: dx * 0.5 * inv(p), oy: dy * 0.5 * inv(p), dblur: 220 * inv(p), dblurDir: bdir }) }, 0));
  }
  add(tr("tr-desfoque", "Desfoque", 0.5,
    { ease: ease.inCubic, f: (p) => ({ blur: lerp(0, 90, p) }) },
    { ease: ease.outCubic, f: (p) => ({ blur: lerp(90, 0, p) }) }, 0));
  add(tr("tr-flip-3d", "Virar em 3D", 0.5,
    { ease: ease.inCubic, f: (p) => ({ swivel: lerp(0, 90, p) }) },
    { ease: ease.outCubic, f: (p) => ({ swivel: lerp(-90, 0, p) }) }, 0));
  add(tr("tr-impacto", "Corte com Impacto", 0.5,
    { ease: ease.inExpo, f: (p) => ({ scale: lerp(100, 115, p) }) },
    { ease: ease.linear, f: (p, t) => { const a = (1 - p) ** 2; return { x: 0.04 * a * smoothNoise(t * 4, 7), y: 0.04 * a * smoothNoise(t * 4, 8), rot: 2 * a * smoothNoise(t * 4, 9), scale: 100 + 15 * a }; } }));
  add(tr("tr-glitch", "Glitch", 0.3,
    { ease: ease.linear, f: (p, t) => { const i = Math.round(t * 30); return { ox: 0.12 * p * hashNoise(i, 31), oy: 0.04 * p * hashNoise(i, 32) }; } },
    { ease: ease.linear, f: (p, t) => { const i = Math.round(t * 30); return { ox: 0.12 * inv(p) * hashNoise(i, 33), oy: 0.04 * inv(p) * hashNoise(i, 34) }; } }, 0));
  return out;
}

export const MOTION_PRESETS: MotionPreset[] = build();
export const getMotionPreset = (id: string) => MOTION_PRESETS.find((p) => p.id === id);
