/** Curvas de aceleração (p de 0 a 1). Calculadas aqui e gravadas como um keyframe por quadro. */
export type Ease = (p: number) => number;

const c1 = 1.70158;
const c3 = c1 + 1;

export const ease = {
  linear: (p: number) => p,
  outCubic: (p: number) => 1 - (1 - p) ** 3,
  inCubic: (p: number) => p ** 3,
  inOutCubic: (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  outQuint: (p: number) => 1 - (1 - p) ** 5,
  outExpo: (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  inExpo: (p: number) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
  inOutExpo: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
  outBack: (p: number) => 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2,
  outElastic: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (p: number) => {
    const n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  },
} satisfies Record<string, Ease>;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ruído suave determinístico (para tremidas de câmera): soma de senoides com fases fixas. */
export function smoothNoise(t: number, seed: number): number {
  const s = seed * 12.9898;
  return (
    Math.sin(t * 7.3 + s) * 0.5 +
    Math.sin(t * 13.1 + s * 1.7) * 0.3 +
    Math.sin(t * 23.7 + s * 2.3) * 0.2
  );
}

/** Ruído "duro" quadro a quadro (glitch/flicker), determinístico. */
export function hashNoise(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
