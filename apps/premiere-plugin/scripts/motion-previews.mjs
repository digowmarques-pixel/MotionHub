/**
 * Gera as prévias animadas da aba Movimento (plugin/motion-previews/<id>.jpg).
 * Calcula os mesmos valores que vão para o Premiere (src/core/motion) e chama o
 * renderizador em Python (tools/motion-previews/render.py), que desenha os quadros.
 *
 *   node scripts/motion-previews.mjs
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "mh-motion-"));
const bundle = join(tmp, "presets.mjs");
await build({ entryPoints: [join(root, "src/core/motion/presets.ts")], bundle: true, format: "esm", outfile: bundle, logLevel: "error" });
const { MOTION_PRESETS } = await import(pathToFileURL(bundle).href);

const FRAMES = 12;
const FPS = 30;
/** Três subquadros por quadro para simular o desfoque de movimento (obturador). */
const subs = (fn, t, shutter) => (shutter > 0 ? [0, 0.5, 1].map((k) => fn(Math.max(0, t - (k * shutter) / 360 / FPS))) : [fn(t)]);

const out = [];
for (const p of MOTION_PRESETS) {
  const frames = [];
  if (p.kind === "anim") {
    const D = p.duration;
    for (let i = 0; i < FRAMES; i++) {
      const t = Math.min(D, (i / (FRAMES - 3)) * D);
      frames.push({ img: "a", subs: subs((tt) => p.f(p.ease(Math.min(1, tt / D)), tt), t, p.shutter ?? 0) });
    }
  } else if (p.kind === "loop") {
    for (let i = 0; i < FRAMES; i++) {
      const t = (i / FRAMES) * 1.2;
      frames.push({ img: "a", subs: subs((tt) => p.f(tt, Math.round(tt * FPS)), t, p.shutter ?? 0) });
    }
  } else {
    const D = p.duration, half = FRAMES / 2;
    for (let i = 0; i < FRAMES; i++) {
      const side = i < half ? p.a : p.b;
      const t = ((i < half ? i + 1 : i - half) / half) * D;
      frames.push({ img: i < half ? "a" : "b", subs: subs((tt) => side.f(side.ease(Math.min(1, tt / D)), tt), t, p.shutter ?? 0) });
    }
  }
  out.push({ id: p.id, frames });
}
const json = join(tmp, "frames.json");
writeFileSync(json, JSON.stringify(out));
const dest = join(root, "plugin/motion-previews");
execFileSync("python3", [join(root, "../../tools/motion-previews/render.py"), json, dest], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
console.log(`${out.length} prévias em ${dest}`);
