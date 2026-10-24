import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "static"), out, { recursive: true });
const common = { bundle: true, logLevel: "warning", sourcemap: false, target: "es2022" };
await Promise.all([
  build({ ...common, entryPoints: [join(root, "src/main/main.ts")], outfile: join(out, "main.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [join(root, "src/main/preload.ts")], outfile: join(out, "preload.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [join(root, "src/renderer/app.ts")], outfile: join(out, "renderer.js"), platform: "browser", format: "iife" }),
]);
console.log("Gerenciador compilado em", out);
