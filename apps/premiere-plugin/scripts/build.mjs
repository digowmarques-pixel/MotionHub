/**
 * Build do plugin UXP.
 *   node scripts/build.mjs                 → dist/ (carregar no UXP Developer Tool)
 *   node scripts/build.mjs --dev --serve   → dev/ no navegador com Premiere simulado
 * MOTIONHUB_API_URL define o domínio liberado no manifest (separe vários por vírgula).
 */
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const out = join(root, dev ? "dev-dist" : "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "plugin"), out, { recursive: true, filter: (p) => !p.endsWith("manifest.template.json") });

const domains = (process.env.MOTIONHUB_API_URL ?? "http://localhost:8080")
  .split(",")
  .map((d) => new URL(d.trim()).origin);
const manifest = readFileSync(join(root, "plugin/manifest.template.json"), "utf8").replace('"__NETWORK_DOMAINS__"', JSON.stringify(domains));
writeFileSync(join(out, "manifest.json"), manifest);

const opts = {
  entryPoints: [join(root, dev ? "dev/main.ts" : "src/main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "iife",
  // UXP: módulos do host são resolvidos em tempo de execução por require().
  external: ["premierepro", "uxp", "os"],
  target: "es2020",
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
};

if (args.has("--watch") || args.has("--serve")) {
  const ctx = await context(opts);
  await ctx.watch();
  if (args.has("--serve")) {
    const { port } = await ctx.serve({ servedir: out, port: 5174 });
    console.log(`Painel em modo navegador: http://localhost:${port}/`);
  }
} else {
  await build(opts);
  console.log(`Plugin gerado em ${out} (domínios liberados: ${domains.join(", ")})`);
}
